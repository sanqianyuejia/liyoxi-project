// 还没实现的页面：菜单登记表里有、页面包还没合并。页面包合并后由真实路由接管，这一页不再出现。
import type { AdminPage } from "../lib/menu";

import { PageHeader } from "./PageHeader";
import { FullPageNotice } from "./StateBlock";

export function UnbuiltPage({ page }: { page: AdminPage }) {
  const owner =
    page.milestone === "V1.1"
      ? "V1.1 的页面，V1.0 只登记菜单"
      : `排在里程碑 ${page.milestone}（${page.workPackage}）`;
  return (
    <>
      <PageHeader title={page.title} />
      <section className="lyx-card">
        <FullPageNotice title="页面建设中" description={`${page.title}：${owner}。`} />
      </section>
    </>
  );
}
