// W0-03 的门禁：依赖审计（pnpm audit --prod，高危阻断）。
// 在临时目录里造一个只依赖已知有漏洞的老版本的工程；清单与锁文件都在这里拼出来，不入库。
// 要能连 registry.npmjs.org：漏洞库在那里。连不上时这一例会红（失败原因对不上），不会被跳过。
const PACKAGE = "minimist";
const VERSION = "0.0.8"; // GHSA-xvch-5gv4-984h：原型污染，严重级别 critical，修复于 0.2.4

const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      ${PACKAGE}:
        specifier: ${VERSION}
        version: ${VERSION}

packages:

  ${PACKAGE}@${VERSION}:
    resolution: {integrity: sha512-lyxSelftestPlaceholder==}

snapshots:

  ${PACKAGE}@${VERSION}: {}
`;

export default {
  gate: "依赖审计（pnpm audit）",
  mutation: `生产依赖里有已知严重漏洞的 ${PACKAGE}@${VERSION}`,
  reason: /critical[\s\S]*minimist[\s\S]*vulnerabilit(?:y|ies) found/,
  run(ctx) {
    const dir = ctx.tempDir();
    const manifest = {
      name: "lyx-audit-fixture",
      version: "0.0.0",
      private: true,
      dependencies: { [PACKAGE]: VERSION },
    };
    ctx.writeFiles(dir, {
      "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "pnpm-lock.yaml": LOCKFILE,
    });
    return ctx.run(
      "pnpm",
      ["audit", "--prod", "--audit-level", "high", "--registry", "https://registry.npmjs.org/"],
      { cwd: dir },
    );
  },
};
