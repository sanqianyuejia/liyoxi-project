// W0-01 的门禁：类型检查的严格度（packages/config/tsconfig 下的预设）。
// 在仓库外的临时目录里放一个违反严格模式的文件，逐个预设跑 tsc：每个预设都必须报出这两处。
// 预设里把 strict、noImplicitAny、strictNullChecks 关掉（或加一行同名键顶替）时这一例会红；
// pnpm typecheck 自己不会红，因为仓库里没有靠这几个开关才报错的代码。
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = [
  "export function pick(value) {", // TS7006：参数隐式 any
  "  return value;",
  "}",
  "",
  "export function size(text: string | null): number {",
  "  return text.length;", // TS18047：可能为 null
  "}",
  "",
].join("\n");
const EXPECTED = /error TS7006[\s\S]*error TS18047/;

export default {
  gate: "类型检查（tsconfig 预设的严格度）",
  mutation: "源码里有隐式 any 的参数、对可能为 null 的值取属性",
  reason: EXPECTED,
  run(ctx) {
    const presetsDir = join(ctx.repoRoot, "packages/config/tsconfig");
    const presets = readdirSync(presetsDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (presets.length === 0) throw new Error(`${presetsDir} 下没有预设`);
    const outputs = [];
    for (const preset of presets) {
      const dir = ctx.tempDir();
      ctx.writeFiles(dir, {
        // 与仓库一致：按 ES 模块解析。types 置空：临时目录里找不到 @types/node
        "package.json": '{ "type": "module" }\n',
        "tsconfig.json": `${JSON.stringify({ extends: join(presetsDir, preset), compilerOptions: { types: [] } })}\n`,
        "src/strict.ts": SOURCE,
      });
      const result = ctx.node("node_modules/typescript/bin/tsc", ["--noEmit", "-p", dir]);
      const output = `[预设 ${preset}] 退出码 ${result.status}\n${result.output.trim()}\n`;
      // 有一个预设没报全，就把它的结果原样交出去：框架会判“检查没有失败”或“原因对不上”
      if (result.status === 0 || !EXPECTED.test(result.output)) {
        return { status: result.status, output };
      }
      outputs.push(output);
    }
    return { status: 1, output: outputs.join("\n") };
  },
};
