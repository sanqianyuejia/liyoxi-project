// 403 占位页：没有访问权限的整页说明（规范 第 12 节“无权限”）。真实页面在 W1-02。
import { Button } from "antd";
import { createRoute, useRouter } from "@tanstack/react-router";

import { FullPageNotice } from "../components/StateBlock";
import { FORBIDDEN_PATH } from "../lib/guard";

import { rootRoute } from "./__root";

function ForbiddenPage() {
  const router = useRouter();
  return (
    <FullPageNotice
      title="没有访问权限"
      description="你的账号没有这个页面的权限，需要的话请联系管理员开通。"
      action={<Button onClick={() => router.history.push("/")}>返回工作台</Button>}
    />
  );
}

export const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FORBIDDEN_PATH,
  staticData: { pageKey: "base.forbidden" },
  component: ForbiddenPage,
});
