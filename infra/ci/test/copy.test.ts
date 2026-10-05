import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempDir, makeTempRepo, repoRoot, run, writeFiles } from "./helpers.js";

// 文案约束扫描的用例（W1-05 任务书 第 7 节第 1–3 项）。在仓库外的临时目录里摆页面、页面清单、契约与规则表，
// 对它跑检查。口径的用例用自己的小规则表；“真的规则表”一组从仓库里的那一份现取规则、路径与说法，
// 页面包往表里加规则时这里不用改。

const script = join(repoRoot, "infra/ci/check-copy.mjs");
const classifier = join(repoRoot, "infra/ci/classify-gate-changes.mjs");
const RULES_FILE = "infra/ci/copy-rules.json";
const PAGES_FILE = "apps/weapp/src/pages.ts";
const ERRORS_DIR = "packages/contract/src/errors";
const LOGIN = "apps/weapp/src/pages/login/";

interface Rule {
  id: string;
  word: string;
  paths?: string[];
  errors?: string[];
  source: string;
}
interface Table {
  rules: Rule[];
  phrases: Array<{ rule: string; allow: string }>;
}

const RULE: Rule = {
  id: "login-no-wechat",
  word: "微信",
  paths: [LOGIN],
  errors: ["LOGIN_DOWN"],
  source: "规范 第 11 节",
};
const TABLE: Table = {
  rules: [RULE],
  phrases: [
    { rule: RULE.id, allow: "添加企业微信" },
    { rule: RULE.id, allow: "微信支付" },
  ],
};
const page = (route: string, title: string) => `  { route: "${route}", title: "${title}" },\n`;
const pagesFile = (loginTitle: string) =>
  `export const WEAPP_PAGES = [\n${page("pages/login/index", loginTitle)}${page("pages/mine/index", "我的")}];\n`;
const errorsFile = (message: string) =>
  [
    "export const errors = {",
    `  LOGIN_DOWN: def(41001, 503, true, "${message}"),`,
    '  OTHER: def(41002, 400, false, "新绑定的微信 7 天内不能移除其他微信"),',
    "};",
    "",
  ].join("\n");
const BASE = {
  [PAGES_FILE]: pagesFile("登录"),
  [`${ERRORS_DIR}/domain/login.ts`]: errorsFile("手机号验证服务暂不可用"),
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 在临时目录里放一批文件（盖在 BASE 之上）与一份规则表，对它跑检查 */
function check(files: Record<string, string>, table: unknown = TABLE) {
  const temp = makeTempDir("lyx-copy-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, { ...BASE, ...files, "rules.json": JSON.stringify(table) });
  return run(
    "node",
    [script, "--root", temp.dir, "--rules", join(temp.dir, "rules.json")],
    repoRoot,
  );
}

describe("取哪些文本", () => {
  const source = [
    "// 行注释里的微信不算",
    "/* 块注释里的微信也不算 */",
    "export default function Login() {",
    "  const hint = `请用${1}微信登录`;",
    "  return (",
    '    <View title="微信授权">',
    "      {/* JSX 注释：微信 */}",
    "      <Button>微信手机号快捷登录</Button>",
    '      <Text>{"\\u5fae\\u4fe1转义写法"}</Text>',
    "    </View>",
    "  );",
    "}",
    "",
  ].join("\n");
  const result = check({ [`${LOGIN}index.tsx`]: source });

  it("检查失败，输出规则与出处", () => {
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("文案约束检查未通过，共 4 处");
    expect(result.stderr).toContain("规则 login-no-wechat：出现“微信”");
    expect(result.stderr).toContain("（规范 第 11 节）");
  });

  it.each([
    ["模板字符串", "index.tsx:4:23"],
    ["JSX 属性里的字符串", "index.tsx:6:18"],
    ["JSX 文本", "index.tsx:8:15"],
    ["转义写法的字符串（原文里数不到词，指到字符串开头）", "index.tsx:9:14"],
  ])("%s：指出文件、行、列", (_label, located) => {
    expect(result.stderr).toContain(`${LOGIN}${located}: `);
  });

  it("注释不算：行注释、块注释、JSX 注释所在的行都不报", () => {
    expect(result.stderr).not.toMatch(/index\.tsx:(?:1|2|7):/);
  });

  it("用例文件与规则范围之外的文件不扫", () => {
    const outside = check({
      [`${LOGIN}index.test.tsx`]: 'expect(text).not.toContain("微信");\n',
      "apps/weapp/src/pages/mine/index.tsx": "export const label = '已登录的微信';\n",
    });
    expect(outside.status).toBe(0);
    expect(outside.stdout).toContain("扫了源码 0 个文件");
  });

  it("页面标题：范围内的路由在页面清单里的标题带词即失败", () => {
    const titled = check({ [PAGES_FILE]: pagesFile("微信登录") });
    expect(titled.status).toBe(1);
    expect(titled.stderr).toContain(
      `${PAGES_FILE}:2:12: 规则 login-no-wechat：路由 pages/login/index 的页面标题里出现“微信”`,
    );
  });
});

describe("登记的说法", () => {
  it("词整个落在登记的说法里不算；同一段里落在外面的照报，只报那一处", () => {
    const result = check({
      [`${LOGIN}index.tsx`]: [
        "export const a = '有问题可以添加企业微信';",
        "export const b = '支持微信支付，也可以微信登录';",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("共 1 处");
    expect(result.stderr).toContain(`${LOGIN}index.tsx:2:29: `);
  });

  it("说法只对它登记的那条规则有效", () => {
    const other: Rule = { id: "join-no-wechat", word: "微信", paths: [LOGIN], source: "规范" };
    const result = check(
      { [`${LOGIN}index.tsx`]: "export const a = '添加企业微信';\n" },
      { ...TABLE, rules: [RULE, other] },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("共 1 处");
    expect(result.stderr).toContain("规则 join-no-wechat：");
  });
});

describe("错误码的默认文案", () => {
  it("登记的错误码默认文案带词：失败，指出错误码与定义所在的文件、行", () => {
    const result = check({ [`${ERRORS_DIR}/domain/login.ts`]: errorsFile("微信服务暂不可用") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("共 1 处");
    expect(result.stderr).toContain(
      `${ERRORS_DIR}/domain/login.ts:2:38: 规则 login-no-wechat：错误码 LOGIN_DOWN 的默认文案里出现“微信”`,
    );
  });

  it("没登记的错误码不管；基线通过并报出扫了什么", () => {
    const result = check({});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("页面标题 1 个、错误码的默认文案 1 个");
    expect(result.stdout).toContain(`登记了、还没建的路径 1 个（建了以后自动扫）：${LOGIN}`);
  });

  it("登记的错误码找不到：按失败算，不当成通过", () => {
    const result = check({}, { ...TABLE, rules: [{ ...RULE, errors: ["LOGIN_GONE"] }] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("登记的错误码 LOGIN_GONE 找不到它的默认文案");
  });
});

describe("规则表写错即报错退出，不带病跑", () => {
  const phrase = TABLE.phrases[0];
  it.each<[string, unknown, string]>([
    ["最外层多一个键", { ...TABLE, disabled: true }, "不认识的键 disabled"],
    ["规则里多一个键", { ...TABLE, rules: [{ ...RULE, level: "warn" }] }, "不认识的键 level"],
    ["规则一条都没有", { ...TABLE, rules: [], phrases: [] }, "rules 要是非空数组"],
    ["规则 id 重复", { ...TABLE, rules: [RULE, RULE] }, "重复"],
    ["规则没有范围", { rules: [{ ...RULE, paths: [], errors: [] }], phrases: [] }, "没有范围"],
    ["路径带通配符", { ...TABLE, rules: [{ ...RULE, paths: ["apps/**"] }] }, "不带通配符"],
    ["说法不含那个词", { ...TABLE, phrases: [{ ...phrase, allow: "手机号" }] }, "要含“微信”"],
    ["说法就是那个词", { ...TABLE, phrases: [{ ...phrase, allow: "微信" }] }, "等于关掉规则"],
    ["说法指的规则不存在", { ...TABLE, phrases: [{ ...phrase, rule: "nope" }] }, "不存在"],
    ["说法多一个键", { ...TABLE, phrases: [{ ...phrase, paths: [LOGIN] }] }, "只写 rule、allow"],
    [
      "路径不存在，也对不上页面清单里的路由",
      { ...TABLE, rules: [{ ...RULE, paths: ["apps/weapp/src/pages/logon/"] }] },
      "对不上小程序页面清单",
    ],
  ])("%s", (_label, table, message) => {
    const result = check({}, table);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it("目录没写结尾的斜杠", () => {
    const result = check(
      { [`${LOGIN}index.tsx`]: "export const a = 1;\n" },
      { ...TABLE, rules: [{ ...RULE, paths: [LOGIN.slice(0, -1)] }] },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("目录要以 / 结尾");
  });
});

describe("真的规则表", () => {
  const raw = readFileSync(join(repoRoot, RULES_FILE), "utf8");
  const table = JSON.parse(raw) as Table;

  /** 仓库外的一棵树：真的页面清单与错误码定义，外加给定的文件；用真的规则表跑 */
  function checkReal(files: Record<string, string>) {
    const temp = makeTempDir("lyx-copy-real-");
    cleanups.push(temp.cleanup);
    cpSync(join(repoRoot, ERRORS_DIR), join(temp.dir, ERRORS_DIR), { recursive: true });
    writeFiles(temp.dir, { [PAGES_FILE]: readFileSync(join(repoRoot, PAGES_FILE), "utf8") });
    writeFiles(temp.dir, files);
    return run("node", [script, "--root", temp.dir], repoRoot);
  }
  /** 每条规则在它的第一个路径下放一个文件，内容由 textOf 给出（一行一个字符串） */
  const filesFor = (textOf: (rule: Rule) => string[]) =>
    Object.fromEntries(
      table.rules
        .filter((rule) => (rule.paths ?? []).length > 0)
        .map((rule) => {
          const path = (rule.paths ?? [])[0] ?? "";
          const lines = textOf(rule).map(
            (text, n) => `export const t${n} = ${JSON.stringify(text)};`,
          );
          return [path.endsWith("/") ? `${path}${rule.id}.ts` : path, `${lines.join("\n")}\n`];
        }),
    );

  it("本仓库通过", () => {
    expect(run("node", [script], repoRoot).status).toBe(0);
  });

  it("每条带路径的规则都拦得住：在它管的路径下写那个词即失败，并点到规则", () => {
    const result = checkReal(filesFor((rule) => [`这里写了${rule.word}`]));
    expect(result.status).toBe(1);
    for (const rule of table.rules.filter((item) => (item.paths ?? []).length > 0)) {
      expect(result.stderr).toContain(`规则 ${rule.id}：出现“${rule.word}”`);
    }
  });

  it("登记的说法逐条写进各自规则管的路径：不报", () => {
    const allowed = (rule: Rule) =>
      table.phrases.filter((item) => item.rule === rule.id).map((item) => item.allow);
    const result = checkReal(filesFor(allowed));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("登录相关文案不出现“微信”这一条在表里，管着登录、加入、邀请三页与登录页会显示的错误码", () => {
    const rule = table.rules.find((item) => item.word === "微信");
    expect(rule?.paths).toEqual(
      expect.arrayContaining([
        LOGIN,
        "apps/weapp/src/sub/member/join/",
        "apps/weapp/src/sub/member/invite/",
      ]),
    );
    expect(rule?.errors).toEqual(
      expect.arrayContaining([
        "WECHAT_UNAVAILABLE",
        "WECHAT_CODE_INVALID",
        "PHONE_REGION_UNSUPPORTED",
        "ACCOUNT_DISABLED",
        "REVERIFY_REQUIRED",
      ]),
    );
  });

  describe("门禁改动分类：加规则是只增，加一条登记的说法是放松", () => {
    /** 规则表从 before 改成 after，让分类脚本用仓库里真的门禁文件清单来判 */
    function classify(after: string) {
      const temp = makeTempRepo("lyx-copy-gate-", { [RULES_FILE]: raw });
      cleanups.push(temp.cleanup);
      git(temp.dir, "commit", "-q", "-m", "base");
      writeFiles(temp.dir, { [RULES_FILE]: after });
      git(temp.dir, "add", "-A");
      git(temp.dir, "commit", "-q", "-m", "head");
      return run("node", [classifier, "--base", "HEAD~1"], temp.dir);
    }
    const replaceOnce = (from: string, to: string) => {
      if (raw.split(from).length !== 2) throw new Error(`规则表里要恰好有一处：${from}`);
      return raw.replace(from, to);
    };

    it("规则表登记在门禁文件清单里", () => {
      const registry = JSON.parse(
        readFileSync(join(repoRoot, "infra/ci/gate-files.json"), "utf8"),
      ) as { files: Array<{ pattern: string; kind: string }> };
      expect(registry.files).toContainEqual(
        expect.objectContaining({ pattern: RULES_FILE, kind: "append" }),
      );
    });

    it("照“说明”在 rules 末尾加一条多行的规则：只增，且加完的表脚本认", () => {
      const added = [
        "    },",
        "    {",
        '      "id": "copy-test-added-rule",',
        '      "word": "文案约束用例里的占位词",',
        `      "paths": ["${LOGIN}"],`,
        '      "source": "用例"',
        "    }",
        "  ],",
        '  "phrases": [',
      ].join("\n");
      const after = replaceOnce('    }\n  ],\n  "phrases": [', added);
      const result = classify(after);
      expect(result.output).toContain("判定：只增");
      expect(result.status).toBe(0);

      const temp = makeTempDir("lyx-copy-added-");
      cleanups.push(temp.cleanup);
      writeFiles(temp.dir, { "rules.json": after });
      const checked = run("node", [script, "--rules", join(temp.dir, "rules.json")], repoRoot);
      expect(checked.status).toBe(0);
      expect(checked.stdout).toContain(`规则 ${table.rules.length + 1} 条`);
    });

    it("往 phrases 里加一行：按放松算", () => {
      const rule = table.rules[0];
      const line = `    { "rule": "${rule?.id}", "allow": "${rule?.word}登录" },\n`;
      const result = classify(replaceOnce('  "phrases": [\n', `  "phrases": [\n${line}`));
      expect(result.status).toBe(1);
      expect(result.output).toContain("加的行像是忽略、豁免或白名单");
    });
  });
});
