// Live 项目只读起栈脚本生成的假凭据/造数输出，后续 live-*.spec.ts 可复用。
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export interface LiveContext {
  origin: string;
  name: string;
  phone: string;
  password: string;
  activationCode: string;
  storageState: string;
  fixtures: unknown;
  /** 仅本轮假管理员的一次再验证交接，不进截图或追踪。 */
  stepUpRecoveryCode?: string;
}
export function liveContext(): LiveContext {
  const file = process.env.LYX_ADMIN_LIVE_CONTEXT;
  if (!file) throw new Error("live 用例需要 pnpm admin:e2e:live 起真实隔离环境");
  return JSON.parse(readFileSync(file, "utf8")) as LiveContext;
}
export function recordErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
export async function noHorizontalScroll(page: Page, state: string) {
  expect(page.viewportSize()).toEqual({ width: 1366, height: 768 });
  const widths = await page.evaluate(() => {
    const root = document.documentElement;
    const content = document.querySelector('[data-testid="shell-content"]');
    return {
      root: [root.scrollWidth, root.clientWidth],
      content: content ? [content.scrollWidth, content.clientWidth] : null,
    };
  });
  expect(widths.root[0], `${state}：整页横向溢出`).toBeLessThanOrEqual(widths.root[1]!);
  if (widths.content)
    expect(widths.content[0], `${state}：内容区横向溢出`).toBeLessThanOrEqual(widths.content[1]!);
}
