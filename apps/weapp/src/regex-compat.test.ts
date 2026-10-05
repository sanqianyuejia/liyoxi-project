import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

// 随包发出去的源码不用正则的后行断言 (?<=…)、(?<!…)。
// iOS 上小程序的逻辑层跑在系统的 JavaScriptCore 里，16.4 之前不认这个写法：正则字面量在解析时就报
// SyntaxError，所在的文件整个起不来（写在 app.js 里就是启动白屏）。Node 与 Chromium 都认，
// 别的用例和截图都测不出来，所以这里按源码文本查。左边界改用前缀捕获组，写法见 lib/errors.ts。
// 只查本目录的源码；依赖带进产物的正则不在这里查。

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const LOOKBEHIND = /\(\?<[!=]/;

function shippedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return shippedSources(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

it("源码里没有正则的后行断言（整行注释不算）", () => {
  const hits = shippedSources(srcRoot).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        !line.trimStart().startsWith("//") && LOOKBEHIND.test(line)
          ? [`${path.relative(srcRoot, file)}:${index + 1}`]
          : [],
      ),
  );
  expect(hits).toEqual([]);
});
