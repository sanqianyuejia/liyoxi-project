// 陈列页的前三组：颜色、文字、间距圆角描边阴影（规范 第 1–3 节）。
// 色块、字号、圆角、阴影都由设计变量取（var(--lyx-…)），旁边的取值是从变量数据里读出来的字，这里不写色值。
import { adminTokens, sharedTokens } from "@liyoxi/shared/design/tokens";

import { Demo, Remark } from "./parts";

/** 后台用得到的全部颜色变量：共用的加后台专有的，同名时取后台的（与 theme/css-vars.ts 一致） */
export const ADMIN_COLORS: Readonly<Record<string, string>> = {
  ...sharedTokens.color,
  ...adminTokens.color,
};

/** 规范 第 1.1–1.5 节的分组：每组列哪些变量 */
const COLOR_GROUPS: readonly { title: string; names: readonly string[] }[] = [
  {
    title: "1.1 品牌色",
    names: ["primary", "primary-text", "primary-bg", "primary-bg-subtle"],
  },
  {
    title: "1.2 文字色",
    names: ["text-primary", "text-regular", "text-secondary", "text-disabled", "text-inverse"],
  },
  {
    title: "1.3 底色与描边",
    names: [
      "bg-page",
      "bg-card",
      "bg-subtle",
      "bg-inverse",
      "fill-neutral",
      "fill-disabled",
      "border",
      "border-light",
      "divider",
      "border-strong",
      "mask",
    ],
  },
  {
    title: "1.4 状态色（文字色与浅底成对；紫色仅后台）",
    names: [
      "success",
      "success-bg",
      "info",
      "info-bg",
      "warning",
      "warning-bg",
      "danger",
      "danger-bg",
      "neutral",
      "neutral-bg",
      "purple",
      "purple-bg",
      "danger-border",
    ],
  },
  {
    title: "1.5 后台专有：侧栏、强调块、开关",
    names: [
      "sidebar-bg",
      "sidebar-text",
      "sidebar-text-muted",
      "sidebar-divider",
      "sidebar-tag-border",
      "sidebar-active-bg",
      "sidebar-badge-bg",
      "sidebar-badge-text",
      "danger-bg-subtle",
      "warning-border",
      "success-border",
      "success-bg-subtle",
      "toast-icon",
      "switch-on",
    ],
  },
];

/** 色板的分组；上面没列到的变量（图表色等）归到最后一组，加了新变量不会漏 */
export function colorGroups(): { title: string; names: string[] }[] {
  const listed = new Set(COLOR_GROUPS.flatMap((group) => group.names));
  const rest = Object.keys(ADMIN_COLORS).filter((name) => !listed.has(name));
  const groups = COLOR_GROUPS.map((group) => ({
    title: group.title,
    names: group.names.filter((name) => name in ADMIN_COLORS),
  }));
  return rest.length > 0
    ? [...groups, { title: "1.5 后台专有：图表色与其余", names: rest }]
    : groups;
}

export function ColorsBody() {
  return (
    <>
      {colorGroups().map((group) => (
        <Demo key={group.title} title={group.title}>
          <div className="lyx-showcase-swatches">
            {group.names.map((name) => (
              <div key={name} className="lyx-showcase-swatch">
                <span
                  className="lyx-showcase-swatch__chip"
                  style={{ background: `var(--lyx-color-${name})` }}
                />
                <span className="lyx-showcase-swatch__name">{name}</span>
                <span className="lyx-showcase-swatch__value">{ADMIN_COLORS[name]}</span>
              </div>
            ))}
          </div>
        </Demo>
      ))}
    </>
  );
}

/** 规范 第 2.3 节的表：变量名、规格、样例、字重与字体 */
const TYPE_ROWS: readonly {
  name: keyof (typeof adminTokens)["font-size"];
  spec: string;
  sample: string;
  weight?: "semibold" | "bold";
  serif?: boolean;
}[] = [
  {
    name: "h1",
    spec: "24px / 700，衬线，行高 1.3",
    sample: "商家管理",
    weight: "bold",
    serif: true,
  },
  { name: "title-lg", spec: "18px / 600", sample: "弹窗标题、详情面板标题", weight: "semibold" },
  { name: "title-md", spec: "15px / 600", sample: "卡片标题、图表卡标题", weight: "semibold" },
  { name: "title-sm", spec: "14px / 600", sample: "卡片内的分区标题", weight: "semibold" },
  { name: "base", spec: "14px", sample: "根字号：按钮、页签、一级菜单" },
  { name: "body", spec: "13px", sample: "表格、输入框、下拉、说明、二级菜单、面包屑" },
  { name: "caption", spec: "12px", sample: "表头、状态标签、辅助说明" },
  { name: "mini", spec: "11px", sample: "V1.1 小标记、图表刻度" },
  { name: "stat", spec: "24px，衬线 700", sample: "1,286", weight: "bold", serif: true },
  { name: "stat-lg", spec: "28px，衬线 700", sample: "¥128,600.00", weight: "bold", serif: true },
  { name: "stat-inline", spec: "16px / 700", sample: "¥3,000.00", weight: "bold" },
];

export function TypographyBody() {
  return (
    <>
      <Demo title="2.3 后台字号">
        {TYPE_ROWS.map((row) => (
          <div key={row.name} className="lyx-showcase-type">
            <div className="lyx-showcase-type__meta">
              <span>{row.name}</span>
              <span className="lyx-showcase-type__spec">{row.spec}</span>
            </div>
            <div
              className={[
                "lyx-showcase-type__sample",
                row.weight ? `lyx-showcase-type__sample--${row.weight}` : "",
                row.serif ? "lyx-showcase-type__sample--serif" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ fontSize: `var(--lyx-font-size-${row.name})` }}
            >
              {row.sample}
            </div>
          </div>
        ))}
      </Demo>
      <Demo title="2.1 三种字体">
        <div className="lyx-showcase-type__sample">界面文字：狸有戏运营管理后台 0123456789</div>
        <div className="lyx-showcase-type__sample lyx-showcase-type__sample--serif lyx-showcase-type__sample--bold">
          衬线：页面标题与指标数字 0123456789
        </div>
        <div className="lyx-showcase-type__sample lyx-showcase-type__sample--mono">
          等宽：编码字段 LYX2026081400006
        </div>
        <Remark>
          衬线字体没有带字体文件，现在按字体栈回落到系统的宋体（W0-28 偏差第 20 条，见看样清单）。
        </Remark>
      </Demo>
      <Demo title="2.3 段落行高 1.6；2.4 数字等宽">
        <p className="lyx-showcase-paragraph">
          主体信息照营业执照填写，保存后由运营核对；与证照对不上的会退回补正。退回时写明原因与下一步，商家补充后可以重新提交，运营在
          1 个工作日内再次核对。
        </p>
        <div className="lyx-showcase-numbers">
          <span>¥1,111,111.11</span>
          <span>¥9,888,888.88</span>
        </div>
      </Demo>
    </>
  );
}

const SPACES = Object.keys(sharedTokens.space);

const RADII: readonly { name: string; label: string }[] = [
  { name: "xs", label: "2 进度条" },
  { name: "sm", label: "4 小标记" },
  { name: "icon-button", label: "6 行内小按钮" },
  { name: "control", label: "8 控件" },
  { name: "inner", label: "10 队列项、子卡" },
  { name: "card", label: "12 卡片" },
  { name: "modal", label: "14 弹窗" },
  { name: "pill", label: "胶囊" },
];

const SHADOWS: readonly { name: keyof (typeof adminTokens)["shadow"]; label: string }[] = [
  { name: "toast", label: "toast：轻提示、下拉等浮层" },
  { name: "modal", label: "modal：弹窗" },
  { name: "drawer", label: "drawer：右侧抽屉" },
  { name: "knob", label: "knob：开关滑块" },
  { name: "row-selected", label: "row-selected：可点行选中的左侧色条" },
  { name: "focus-ring-input", label: "focus-ring-input：输入框聚焦的浅色光晕" },
  { name: "focus-ring", label: "focus-ring：键盘聚焦的主色环" },
];

export function SpacingBody() {
  return (
    <>
      <Demo title="间距阶梯（px）">
        {SPACES.map((space) => (
          <div key={space} className="lyx-showcase-space">
            <span className="lyx-showcase-space__label">{space}</span>
            <span
              className="lyx-showcase-space__bar"
              style={{ width: `var(--lyx-space-${space})` }}
            />
          </div>
        ))}
        <Remark>
          内容区内边距 20px 24px 24px，区块间距 16；卡片内边距 16，队列详情卡与页签面板
          20；表单字段之间 14，标签与控件之间 6。
        </Remark>
      </Demo>
      <Demo title="圆角" row>
        {RADII.map((radius) => (
          <div key={radius.name} className="lyx-showcase-radius">
            <span
              className="lyx-showcase-radius__box"
              style={{ borderRadius: `var(--lyx-radius-${radius.name})` }}
            />
            <span className="lyx-showcase-radius__label">{radius.label}</span>
          </div>
        ))}
      </Demo>
      <Demo title="描边：默认 1px 实线；2px 用于页签下划线与选中描边；虚线只用于上传与添加占位" row>
        <span className="lyx-showcase-border lyx-showcase-border--default">1px</span>
        <span className="lyx-showcase-border lyx-showcase-border--strong">2px 选中</span>
        <span className="lyx-showcase-border lyx-showcase-border--dashed">虚线</span>
      </Demo>
      <Demo title="阴影：只有浮层有" row>
        {SHADOWS.map((shadow) => (
          <div key={shadow.name} className="lyx-showcase-shadow">
            <span
              className="lyx-showcase-shadow__box"
              style={{ boxShadow: `var(--lyx-shadow-${shadow.name})` }}
            />
            <span className="lyx-showcase-radius__label">{shadow.label}</span>
          </div>
        ))}
      </Demo>
    </>
  );
}
