import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { RoleReplaceBody } from "@liyoxi/contract";
import { createActor } from "../kernel/index.js";
import { createTestStaffAuth, signInAsStaff, useSeededDatabase } from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { staffContextOf } from "./me.js";
import { createRoleManagement, roleDefaults } from "./role-management.js";

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let harness: TestStaffAuth;
beforeAll(async () => {
  prisma = await db.prisma();
  harness = createTestStaffAuth(prisma);
}, 20_000);
const meta = {
  requestId: "role-test",
  ip: "127.0.0.1",
  userAgent: "role-test",
  authMethod: "password+totp" as const,
  sessionId: null,
};
async function operator(roleKey: "super_admin" | "editor" = "super_admin") {
  const signed = await signInAsStaff(prisma, { roleKey, now: harness.clock.now() });
  return {
    ctx: staffContextOf(await harness.staff.authenticate(signed.sessionToken)),
    actor: createActor({ type: "staff", id: signed.staff.id, client: "admin" }),
    signed,
  };
}
const service = () =>
  createRoleManagement({
    db: prisma,
    tx: harness.tx,
    clock: harness.clock,
    roles: harness.staff.roles,
  });
const body = (key: string, lockVersion: number): RoleReplaceBody => {
  const { roleKey: _, ...config } = roleDefaults(key);
  return { ...config, lockVersion };
};

describe("W2-04 角色持久化与既有授权", () => {
  it("默认值不读数据库、未知键404，查看范围与旧权限保持", async () => {
    const admin = await operator();
    expect(service().defaults(admin.ctx, "editor")).toEqual(roleDefaults("editor"));
    expect(() => service().defaults(admin.ctx, "other")).toThrowError(
      expect.objectContaining({ error: "NOT_FOUND" }),
    );
    const editor = await operator("editor");
    expect(() => service().get(editor.ctx, "editor")).toThrowError(
      expect.objectContaining({ error: "PERMISSION_DENIED" }),
    );
  });
  it("角色保存、审计同TX，提交后缓存立即失效，旧版本冲突", async () => {
    const admin = await operator();
    const before = await service().get(admin.ctx, "editor");
    const cached = await harness.staff.roles.role("editor");
    const input = { ...body("editor", before.lockVersion), dataScope: "all" as const };
    const after = await service().replace(admin.ctx, admin.actor, meta, "editor", input);
    expect(after).toMatchObject({
      lockVersion: before.lockVersion + 1,
      dataScope: "all",
      isDefault: false,
    });
    expect(await harness.staff.roles.role("editor")).not.toBe(cached);
    expect(
      await prisma.auditLog.findFirst({
        where: { targetKey: "editor", action: "sys.role.edit" },
        orderBy: { seq: "desc" },
      }),
    ).toMatchObject({ stream: "ops", before: { dataScope: "own" }, after: { dataScope: "all" } });
    await expect(
      service().replace(admin.ctx, admin.actor, meta, "editor", input),
    ).rejects.toMatchObject({ error: "VERSION_CONFLICT" });
  });
  it("同版本两个独立事务只能成功一个，无覆盖或多余审计", async () => {
    const admin = await operator();
    const before = await service().get(admin.ctx, "publisher");
    const count = await prisma.auditLog.count({
      where: { targetKey: "publisher", action: "sys.role.edit" },
    });
    const results = await Promise.allSettled([
      service().replace(admin.ctx, admin.actor, meta, "publisher", {
        ...body("publisher", before.lockVersion),
        dataScope: "group",
      }),
      service().replace(admin.ctx, admin.actor, meta, "publisher", {
        ...body("publisher", before.lockVersion),
        dataScope: "all",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { error: "VERSION_CONFLICT" },
    });
    expect(
      await prisma.auditLog.count({ where: { targetKey: "publisher", action: "sys.role.edit" } }),
    ).toBe(count + 1);
  });
  it("超级管理员锁定，非法o/action/leadOnly/缺模块拒绝且无写入", async () => {
    const admin = await operator();
    const before = await service().get(admin.ctx, "super_admin");
    await expect(
      service().replace(
        admin.ctx,
        admin.actor,
        meta,
        "super_admin",
        body("super_admin", before.lockVersion),
      ),
    ).rejects.toMatchObject({ error: "ROLE_LOCKED" });
    const input = body("content_ops", 0);
    const { workbench: _, ...missing } = input.moduleLevels;
    for (const broken of [
      { ...input, moduleLevels: { ...input.moduleLevels, system: "o" } },
      { ...input, moduleLevels: missing },
      { ...input, actions: { "sys.role.edit": { on: true, leadOnly: false } } },
      { ...input, actions: { "drama.edit": { on: true, leadOnly: true } } },
    ]) {
      await expect(
        service().replace(admin.ctx, admin.actor, meta, "content_ops", broken as RoleReplaceBody),
      ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    }
    expect(
      (await prisma.staffRole.findUniqueOrThrow({ where: { key: "super_admin" } })).lockVersion,
    ).toBe(before.lockVersion);
  });
});
