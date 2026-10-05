// 后台的陈列页（看样页，W0-29）：把 W0-28 交的外壳、三种页面骨架里的构件、主题套好的 Ant Design 控件，
// 连同设计变量、状态取色、图标，照设计规范的章节先后逐组摆出来；每组标着规范的节号与对照的要点。
// 业主对着规范逐组看，结论填进 docs/plan/sample-review/W0-29.md。
// 只进带夹具的构建（开发、e2e 两种模式）：路由在 src/routes/_dev/index.tsx，生产构建里访问即“页面不存在”。
// 本页只摆不改：构件有出入的记进看样清单，走单独的构件 PR（CLAUDE.md 硬性规则 27）。
import type { ComponentType } from "react";

import { PageHeader } from "../../components/PageHeader";
import { DEV_FIXTURE_MARK } from "../mark";

import { ButtonsBody, FormsBody, OverlaysBody } from "./controls";
import { ColorsBody, SpacingBody, TypographyBody } from "./foundations";
import { FrameBody, PagesBody } from "./pages";
import { SHOWCASE_SECTIONS, type ShowcaseSectionId } from "./sections";
import { CustomBody, IconsBody, StatesBody, StatusBody } from "./status";

import "./showcase.css";

/** 每组的内容。键与 sections.ts 的登记一一对应，多了少了类型检查都过不去 */
const BODIES: Record<ShowcaseSectionId, ComponentType> = {
  colors: ColorsBody,
  typography: TypographyBody,
  spacing: SpacingBody,
  frame: FrameBody,
  pages: PagesBody,
  buttons: ButtonsBody,
  forms: FormsBody,
  overlays: OverlaysBody,
  custom: CustomBody,
  status: StatusBody,
  icons: IconsBody,
  states: StatesBody,
};

export function Showcase() {
  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <PageHeader
        title="组件陈列"
        subtitle="看样页：对照设计规范（design/design-spec.md）逐组看。每组右上角是规范的节号，下面几行是要对的要点。数据都是夹具。"
      />
      <nav className="lyx-card lyx-showcase-toc" aria-label="陈列的分组">
        {SHOWCASE_SECTIONS.map((section) => (
          <a key={section.id} className="lyx-link" href={`#spec-${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>
      {SHOWCASE_SECTIONS.map((section) => {
        const Body = BODIES[section.id];
        return (
          <section
            key={section.id}
            id={`spec-${section.id}`}
            className="lyx-card lyx-showcase-section"
            data-testid={`showcase-${section.id}`}
            aria-labelledby={`spec-${section.id}-title`}
          >
            <header className="lyx-showcase-section__head">
              <h2 id={`spec-${section.id}-title`} className="lyx-section-title">
                {section.title}
              </h2>
              <span className="lyx-pill">规范 {section.spec}</span>
            </header>
            <ul className="lyx-showcase-section__points">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <div className="lyx-showcase-section__body">
              <Body />
            </div>
          </section>
        );
      })}
    </div>
  );
}
