// 权限数据的夹具来源（任务书 第 11 节第 1 项）：M0 没有登录与 admin.auth.me.get，开发与测试构建用它。
// 真实来源由 W1-02 接上。两个本地开关方便看样：
//   localStorage["lyx.dev.role"] = "service"            换成客服的权限（看不到财务、系统等菜单）
//   localStorage["lyx.dev.releases"] = "release.partner" 打开 V1.1 的开关（逗号分隔多个）
import { ADMIN_MODULES } from "../lib/menu";
import type { AccessSnapshot, AccessSource } from "../lib/permissions";

import { DEV_FIXTURE_MARK } from "./mark";

const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const releases = (): Record<string, boolean> =>
  Object.fromEntries(
    (read("lyx.dev.releases") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => [key, true]),
  );

const superAdmin = (): AccessSnapshot => ({
  staff: { id: DEV_FIXTURE_MARK, name: "周航", roleKey: "super_admin", roleName: "超级管理员" },
  isLead: true,
  moduleLevels: Object.fromEntries(ADMIN_MODULES.map((module) => [module.key, "e"])),
  actions: ["merchant.qualification.review", "merchant.user.disable"],
  dataScope: "all",
  releases: releases(),
});

const service = (): AccessSnapshot => ({
  staff: { id: DEV_FIXTURE_MARK, name: "陈雨", roleKey: "service", roleName: "客服" },
  isLead: false,
  moduleLevels: { workbench: "v", merchant: "e", order: "v", delivery: "v", service: "e" },
  actions: ["merchant.qualification.review"],
  dataScope: "group",
  releases: releases(),
});

export function fixtureAccessSource(): AccessSource {
  return {
    load: () => Promise.resolve(read("lyx.dev.role") === "service" ? service() : superAdmin()),
  };
}
