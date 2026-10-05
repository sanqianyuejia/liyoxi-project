// 陈列页的用例（任务书 W0-29 第 7 节第 1 项）。不装 DOM 测试库：用 react-dom/server 渲染后断言结构；
// 打得开、每组看得见、弹层点得开由冒烟（test/e2e/showcase.spec.ts）覆盖。
// 组数、状态数、图标数不写在这里：登记、状态字典、图标集里有什么就要求什么。
import { ICON_NAMES } from "@liyoxi/shared/design/icons";
import { STATUS_TONE_GROUPS } from "@liyoxi/shared/design/status-tone";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { cssVariables } from "../../theme/css-vars";
import { DEV_FIXTURE_MARK } from "../mark";

import { ADMIN_COLORS, colorGroups } from "./foundations";
import { PAGE_KINDS } from "./pages";
import { firstSpecNumber, SHOWCASE_PATH, SHOWCASE_SECTIONS } from "./sections";
import { Showcase } from "./Showcase";
import { adminToneRows } from "./status";

const html = renderToStaticMarkup(
  <ConfigProvider locale={zhCN}>
    <Showcase />
  </ConfigProvider>,
);

/** 渲染结果里的文字（去掉标签）：断言“某句话出现在页面上”用 */
const text = html.replace(/<[^>]+>/g, " ");

describe("陈列页的分组登记", () => {
  it("每组有规范的节号、标题与要点；id 不重复、只用小写字母与连字符", () => {
    const ids: string[] = SHOWCASE_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of SHOWCASE_SECTIONS) {
      expect(section.id, section.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(section.spec, section.id).toMatch(/^第 \d+(?:\.\d+)?(?:、\d+(?:\.\d+)?)* 节/);
      expect(section.title.trim(), section.id).not.toBe("");
      expect(section.points.length, section.id).toBeGreaterThan(0);
    }
  });

  it("各组照规范的节号先后排", () => {
    const numbers = SHOWCASE_SECTIONS.map((section) => firstSpecNumber(section.spec));
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});

describe("陈列页渲染出来的内容", () => {
  it("每组都在页面上：带节号、要点，目录里有它的链接", () => {
    for (const section of SHOWCASE_SECTIONS) {
      expect(html, section.id).toContain(`data-testid="showcase-${section.id}"`);
      expect(html, section.id).toContain(`href="#spec-${section.id}"`);
      expect(text, section.id).toContain(`规范 ${section.spec}`);
      for (const point of section.points) expect(text, section.id).toContain(point);
    }
  });

  it("带着夹具的标记：生产构建的产物检查据此认出它没有被带进去", () => {
    expect(html).toContain(`data-fixture="${DEV_FIXTURE_MARK}"`);
    expect(SHOWCASE_PATH).toBe("/dev/showcase");
  });

  it("色板：后台用得到的颜色变量一个不漏，每个都是铺出来的样式变量", () => {
    const listed = colorGroups().flatMap((group) => group.names);
    expect([...listed].sort()).toEqual(Object.keys(ADMIN_COLORS).sort());
    const variables = cssVariables();
    for (const name of listed) {
      expect(variables, name).toHaveProperty(`--lyx-color-${name}`);
      expect(html, name).toContain(`background:var(--lyx-color-${name})`);
    }
  });

  it("状态取色：状态字典里后台出现的状态全部在列，色调与叫法取自字典", () => {
    const expected = STATUS_TONE_GROUPS.flatMap((group) =>
      group.entries.flatMap((entry) => (entry.admin ? [`${group.key}/${entry.state}`] : [])),
    );
    const rows = adminToneRows();
    expect(
      rows.flatMap((group) => group.states.map((item) => `${group.key}/${item.state}`)),
    ).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    for (const group of rows) {
      expect(text, group.key).toContain(group.object);
      for (const item of group.states) {
        expect(html, `${group.key}/${item.state}`).toContain(
          `<span class="lyx-tag lyx-tag--${item.tone}">${item.label}</span>`,
        );
      }
    }
  });

  it("图标：图标集里的每一个都画出来并标了名字", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    for (const name of ICON_NAMES) expect(html, name).toContain(`<span>${name}</span>`);
  });

  it("五类页面：有构件的给出样例页的链接，样例页的地址都是样例路由", () => {
    const linked = PAGE_KINDS.filter((item) => item.href !== null);
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) {
      expect(item.href, item.kind).toMatch(/^\/dev\//);
      expect(html, item.kind).toContain(`href="${item.href}"`);
    }
  });
});
