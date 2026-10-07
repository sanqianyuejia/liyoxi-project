import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "./helpers.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lyx-browser-apt-"));
  roots.push(root);
  mkdirSync(join(root, "sources.list.d"));
  return root;
}
function run(args: string[]) {
  return spawnSync(
    process.execPath,
    [join(repoRoot, "infra/ci/normalize-browser-apt-source.mjs"), ...args],
    {
      encoding: "utf8",
    },
  );
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("临时 runner 浏览器的 Ubuntu 软件源", () => {
  for (const deb822 of [true, false]) {
    it(`实际 runner 的 ${deb822 ? "deb822" : "legacy"} mirrorlist 入口会修复优先镜像并保留原优先级与回退`, () => {
      const root = fixture();
      const source = deb822
        ? "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        : "deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:/etc/apt/apt-mirrors.txt noble main\n";
      const path = join(root, deb822 ? "sources.list.d/ubuntu.sources" : "sources.list");
      writeFileSync(path, source);
      const mirrors =
        "# http://azure.archive.ubuntu.com/ubuntu/\n" +
        "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
        "https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
        "https://security.ubuntu.com/ubuntu/\tpriority:3\n";
      const mirrorPath = join(root, "apt-mirrors.txt");
      writeFileSync(mirrorPath, mirrors);
      expect(run(["--root", root]).status).toBe(0);
      expect(readFileSync(path, "utf8")).toBe(source);
      const expected = mirrors.replace(
        "http://azure.archive.ubuntu.com/ubuntu/\t",
        "https://archive.ubuntu.com/ubuntu\t",
      );
      expect(readFileSync(mirrorPath, "utf8")).toBe(expected);
      const repeated = run(["--root", root]);
      expect(repeated.status).toBe(0);
      expect(repeated.stdout).toContain("0 file(s)");
      expect(readFileSync(mirrorPath, "utf8")).toBe(expected);
    });
  }

  it("两处源准备与原安装步骤沿用相同条件，并紧邻原安装命令", () => {
    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    for (const [condition, install] of [
      ["admin-e2e", "pnpm --filter @liyoxi/admin exec playwright install --with-deps chromium"],
      ["weapp-shots", "pnpm --filter @liyoxi/weapp exec playwright install --with-deps chromium"],
    ]) {
      expect(ci).toMatch(
        new RegExp(
          `if: steps\\.${condition}\\.outputs\\.run == 'true'\\n` +
            '        run: sudo env "PATH=\\$PATH" node infra/ci/normalize-browser-apt-source\\.mjs\\n' +
            "      - name: [^\\n]+\\n" +
            `        if: steps\\.${condition}\\.outputs\\.run == 'true'\\n` +
            `        run: ${install}\\n`,
        ),
      );
    }
  });

  it("兼容 legacy 源与选项，仅改精确 Azure URI，保留套件、注释与其他源，重复执行不改字节", () => {
    const root = fixture();
    const source = [
      "# deb http://azure.archive.ubuntu.com/ubuntu noble main",
      "deb [arch=amd64 signed-by=/etc/apt/keyrings/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble main restricted # keep",
      "deb-src https://azure.archive.ubuntu.com/ubuntu noble-updates universe",
      "deb http://azure.archive.ubuntu.com/ubuntu-extra noble main",
      "deb https://private.example/ubuntu noble main",
      "",
    ].join("\n");
    writeFileSync(join(root, "sources.list"), source);
    const extra = "deb https://security.ubuntu.com/ubuntu noble-security main\n";
    writeFileSync(join(root, "sources.list.d/security.list"), extra);
    expect(run(["--root", root]).status).toBe(0);
    const expected = source
      .replace(
        "http://azure.archive.ubuntu.com/ubuntu/ noble",
        "https://archive.ubuntu.com/ubuntu noble",
      )
      .replace(
        "deb-src https://azure.archive.ubuntu.com/ubuntu",
        "deb-src https://archive.ubuntu.com/ubuntu",
      );
    expect(readFileSync(join(root, "sources.list"), "utf8")).toBe(expected);
    expect(readFileSync(join(root, "sources.list.d/security.list"), "utf8")).toBe(extra);
    const repeated = run(["--root", root]);
    expect(repeated.status).toBe(0);
    expect(repeated.stdout).toContain("0 file(s)");
    expect(readFileSync(join(root, "sources.list"), "utf8")).toBe(expected);
  });

  it("兼容 Ubuntu 24.04 deb822 多 URI 与续行，逐字保留签名、套件和禁用配置", () => {
    const root = fixture();
    const source = [
      "Types: deb deb-src",
      "URIs: http://azure.archive.ubuntu.com/ubuntu https://security.ubuntu.com/ubuntu",
      " https://azure.archive.ubuntu.com/ubuntu/",
      "Suites: noble noble-updates noble-backports",
      "Components: main universe restricted multiverse",
      "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
      "Enabled: no",
      "# http://azure.archive.ubuntu.com/ubuntu",
      "",
      "Types: deb",
      "URIs: https://another.example/repo",
      "Suites: stable",
      "X-Comment: http://azure.archive.ubuntu.com/ubuntu",
      "",
    ].join("\r\n");
    const path = join(root, "sources.list.d/ubuntu.sources");
    writeFileSync(path, source);
    expect(run(["--root", root]).status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(
      source
        .replace(
          "URIs: http://azure.archive.ubuntu.com/ubuntu",
          "URIs: https://archive.ubuntu.com/ubuntu",
        )
        .replace(
          " https://azure.archive.ubuntu.com/ubuntu/\r",
          " https://archive.ubuntu.com/ubuntu\r",
        ),
    );
  });

  it("拒绝参数、空源和根目录软链接，且不输出第三方源内容", () => {
    const root = fixture();
    const path = join(root, "sources.list");
    const source =
      "deb http://azure.archive.ubuntu.com/ubuntu noble main\n# PRIVATE_SOURCE_SENTINEL\n";
    writeFileSync(path, source);
    for (const args of [["--root", root, "--skip"], ["--root"], ["--unknown", root]]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).not.toContain("PRIVATE_SOURCE_SENTINEL");
      expect(readFileSync(path, "utf8")).toBe(source);
    }
    expect(run(["--root", fixture()]).status).toBe(1);
    const link = join(fixture(), "linked-root");
    symlinkSync(root, link, "dir");
    expect(run(["--root", link]).status).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it("候选文件或源目录含软链接时，在写入任何源之前失败", () => {
    const root = fixture();
    const path = join(root, "sources.list");
    const source = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n";
    writeFileSync(path, source);
    symlinkSync(path, join(root, "sources.list.d/linked.sources"));
    expect(run(["--root", root]).status).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(source);
    rmSync(join(root, "sources.list.d/linked.sources"));
    symlinkSync(path, join(root, "apt-mirrors.txt"));
    expect(run(["--root", root]).status).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(source);
    rmSync(join(root, "apt-mirrors.txt"));
    rmSync(join(root, "sources.list.d"), { recursive: true });
    symlinkSync(join(fixture(), "sources.list.d"), join(root, "sources.list.d"), "dir");
    expect(run(["--root", root]).status).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(source);
  });
});
