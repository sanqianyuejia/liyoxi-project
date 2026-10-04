// W0-03 的门禁：门禁改动分类，锁文件 snapshots 段。
// 把已有条目的一个依赖版本改掉（实际装上的就是改后的版本），另加一份同名、peer 解析不同的条目留着旧版本。
// 把同名的几份并在一起比的话，旧版本还在，就看不出改动；要按完整的键逐个比。没有 gate-change 标签必须失败。
const lock = (snapshots) =>
  [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    devDependencies:",
    "      debug:",
    "        specifier: 4.4.3",
    "        version: 4.4.3",
    "",
    "packages:",
    "",
    "  debug@4.4.3:",
    "    resolution: {integrity: sha512-ddd}",
    "",
    "  ms@2.1.3:",
    "    resolution: {integrity: sha512-mmm}",
    "",
    "snapshots:",
    "",
    ...snapshots,
    "  ms@2.1.3: {}",
    "",
  ].join("\n");
const BASE = lock(["  debug@4.4.3:", "    dependencies:", "      ms: 2.1.3", ""]);
const HEAD = lock([
  "  debug@4.4.3:",
  "    dependencies:",
  "      ms: 2.1.2",
  "",
  "  debug@4.4.3(decoy@1.0.0):",
  "    dependencies:",
  "      ms: 2.1.3",
  "",
]);

export default {
  gate: "门禁改动分类（锁文件里已有条目的依赖版本）",
  mutation: "改掉已有条目的依赖版本，另加一份同名条目留着旧版本，没有 gate-change 标签",
  reason: /debug@4\.4\.3 的 ms 由 2\.1\.3 改成 2\.1\.2[\s\S]*没有 gate-change 标签/,
  run(ctx) {
    const dir = ctx.gitRepo({ "pnpm-lock.yaml": BASE });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.writeFiles(dir, { "pnpm-lock.yaml": HEAD });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "head");
    return ctx.node("infra/ci/classify-gate-changes.mjs", ["--base", "HEAD~1"], { cwd: dir });
  },
};
