import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempDir, makeTempRepo, repoRoot, writeFiles } from "./helpers.js";

// 真 gitleaks、无网络、六个固定向量；只扫描现场构造的最小 git 历史。
// 合成反例在运行时生成，不把新的形似密钥的字面量写进仓库。
const IMAGE = "ghcr.io/gitleaks/gitleaks:v8.30.1";
const paths = {
  env: "packages/services/src/kernel/env-asr-callback.test.ts",
  provider: "packages/services/src/providers/asr/callback.test.ts",
  send: "packages/services/src/ops/asr-callback-send.test.ts",
  admin: "apps/admin/test/e2e/w216-agreements-readonly.ts",
};
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

function tempDir(): string {
  const temp = makeTempDir("lyx-secret-fixtures-");
  cleanup.push(temp.cleanup);
  return temp.dir;
}

function capture(source: string, pattern: RegExp): string {
  const value = pattern.exec(source)?.[1];
  if (!value) throw new Error("公开固定夹具已变更，须重新核验窄放行");
  return value;
}

function vectors() {
  const env = readFileSync(join(repoRoot, paths.env), "utf8");
  return {
    key: capture(env, /^const key = "([^"\\]+)";/m),
    signature: capture(env, /^\s*\["[^"\\]+", key, "([^"\\]+)"\],/m),
    password: capture(
      readFileSync(join(repoRoot, paths.admin), "utf8"),
      /\bpassword = "([^"\\]+)";/,
    ),
  };
}

function history(files: Record<string, string>, removeAtHead = false): string {
  const temp = makeTempRepo("lyx-secret-fixtures-git-", files);
  cleanup.push(temp.cleanup);
  git(temp.dir, "commit", "-qm", "公开测试向量");
  if (removeAtHead) {
    writeFiles(
      temp.dir,
      Object.fromEntries(Object.keys(files).map((path) => [path, "// removed\n"])),
    );
    git(temp.dir, "add", "-A");
    git(temp.dir, "commit", "-qm", "移除当前快照中的向量");
  }
  return temp.dir;
}

interface Finding {
  rule: string;
  file: string;
  line: number;
}

// 丢弃 Secret/Match 等内容字段；断言失败也只显示规则、相对路径、行号。
function metadata(report: string): Finding[] {
  const values: unknown = JSON.parse(report);
  if (!Array.isArray(values)) throw new Error("密钥扫描报告不是数组");
  return values.map((value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("RuleID" in value) ||
      typeof value.RuleID !== "string" ||
      !("File" in value) ||
      typeof value.File !== "string" ||
      !("StartLine" in value) ||
      typeof value.StartLine !== "number"
    )
      throw new Error("密钥扫描报告元数据不完整");
    return { rule: value.RuleID, file: value.File, line: value.StartLine };
  });
}

function scan(repository: string, config: string): { status: number; findings: Finding[] } {
  const output = tempDir();
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "--network",
      "none",
      "-v",
      `${repository}:/scan:ro`,
      "-v",
      `${config}:/gitleaks.toml:ro`,
      "-v",
      `${output}:/report`,
      IMAGE,
      "git",
      "/scan",
      "--log-opts",
      "--full-history --diff-merges=first-parent --text HEAD",
      "--config",
      "/gitleaks.toml",
      "--ignore-gitleaks-allow",
      "--redact",
      "--no-banner",
      "--no-color",
      "--exit-code",
      "3",
      "--report-format",
      "json",
      "--report-path",
      "/report/findings.json",
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  if (result.error || (result.status !== 0 && result.status !== 3))
    throw new Error("固定 gitleaks 未正常完成；须有 Docker 与已缓存的正式镜像，不算扫描通过");
  const report = join(output, "findings.json");
  if (!existsSync(report)) throw new Error("固定 gitleaks 未生成报告，不算扫描通过");
  return { status: result.status, findings: metadata(readFileSync(report, "utf8")) };
}

describe("固定测试向量的精确密钥扫描放行", () => {
  it("默认规则命中历史六向量，路径与完整固定值同时匹配才放行", () => {
    const value = vectors();
    const key = `const key = ${JSON.stringify(value.key)};\n`;
    const signature = `const vector = ["visible", key, ${JSON.stringify(value.signature)}];\n`;
    const repository = history(
      {
        [paths.env]: key + signature,
        [paths.provider]: key + signature,
        [paths.send]: key,
        [paths.admin]: `const password = ${JSON.stringify(value.password)};\n`,
      },
      true,
    );
    const defaults = join(tempDir(), "defaults.toml");
    writeFileSync(defaults, "[extend]\nuseDefault = true\n");
    const original = scan(repository, defaults);
    expect(original.status).toBe(3);
    expect(original.findings).toHaveLength(6);
    expect(original.findings.every((one) => one.rule === "generic-api-key")).toBe(true);
    expect(scan(repository, join(repoRoot, ".gitleaks.toml"))).toEqual({ status: 0, findings: [] });
  });

  it("同路径其他值、同一行其他密钥、额外路径与其他规则仍失败", () => {
    const value = vectors();
    // 默认规则会过滤纯字母符号与 stopwords；反例须稳定满足真实规则的熵和字符要求。
    // 运行时构造均匀十六进制向量，不把新的形似密钥字面量写入仓库。
    const synthetic = Array.from({ length: 16 }, (_, digit) => (15 - digit).toString(16))
      .join("")
      .repeat(4);
    const sameLine = `const key = ${JSON.stringify(value.key)}, apiKey = ${JSON.stringify(synthetic)};\n`;
    const privateKey = [
      ["-----", "BEGIN", " RSA PRIVATE ", "KEY-----"].join(""),
      randomBytes(360)
        .toString("base64")
        .match(/.{1,64}/g)
        ?.join("\n"),
      ["-----", "END", " RSA PRIVATE ", "KEY-----"].join(""),
    ].join("\n");
    const repository = history({
      [paths.env]: sameLine + privateKey,
      [paths.provider]: `const key = ${JSON.stringify(synthetic)};\n`,
      [paths.send]: `const key = ${JSON.stringify(value.signature)};\n`,
      [paths.admin]: `const password = ${JSON.stringify(synthetic)};\n`,
      [`${paths.env}.extra`]: `const key = ${JSON.stringify(value.key)};\n`,
      [paths.env.replace(".test.ts", ".ts")]: `const key = ${JSON.stringify(value.key)};\n`,
    });
    const result = scan(repository, join(repoRoot, ".gitleaks.toml"));
    expect(result.status).toBe(3);
    for (const file of [
      ...Object.values(paths),
      `${paths.env}.extra`,
      paths.env.replace(".test.ts", ".ts"),
    ])
      expect(
        result.findings.filter((one) => one.rule === "generic-api-key").map((one) => one.file),
      ).toContain(file);
    expect(result.findings).toContainEqual({ rule: "private-key", file: paths.env, line: 2 });
  });
});
