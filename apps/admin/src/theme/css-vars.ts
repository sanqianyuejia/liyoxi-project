// 样式变量：把 @liyoxi/shared 的设计变量铺成 CSS 自定义属性，样式文件里只写 var(--lyx-…)，不写色值。
// 变量名与 scss 版同一拼法：--lyx-<组>-<名>，组与名是 design/tokens.json 的第二、三层键；
// shared 与 admin 两段同名时取 admin 的（与 admin.scss 一致）。
// 没有用 @liyoxi/shared/design/admin.scss：那要装 sass，不在本包允许新增的依赖里。
import { adminTokens, sharedTokens } from "@liyoxi/shared/design/tokens";

type TokenGroup = Readonly<Record<string, string | number>>;
type TokenSet = Readonly<Record<string, TokenGroup>>;

const STYLE_ELEMENT_ID = "lyx-css-vars";

/** 变量名 → 取值，按 tokens 的书写顺序 */
export function cssVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const set of [sharedTokens, adminTokens] as readonly TokenSet[]) {
    for (const [group, entries] of Object.entries(set)) {
      for (const [name, value] of Object.entries(entries)) {
        variables[`--lyx-${group}-${name}`] = String(value);
      }
    }
  }
  return variables;
}

/** 一段 :root 规则，可直接放进 <style> */
export function cssVariablesText(selector = ":root"): string {
  const lines = Object.entries(cssVariables()).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/** 启动时调一次；重复调用只留一份 */
export function installCssVariables(doc: Document): void {
  let style = doc.getElementById(STYLE_ELEMENT_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(style);
  }
  style.textContent = cssVariablesText();
}
