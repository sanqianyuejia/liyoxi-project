import { AuditLogListQuerySchema, defaultRoleActions, staffRoleDefault } from "@liyoxi/contract";
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStaffContext, normalizeRoleConfig } from "../authz/index.js";
import { createActor, uuidv7 } from "../kernel/index.js";
import {
  createTestStaffAuth,
  sampleStaffContext,
  signInAsStaff,
  useSeededDatabase,
} from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { record } from "./record.js";
import { createAuditRead } from "./read.js";

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let t: TestStaffAuth;
beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
}, 30_000);
async function operator(roleKey: "super_admin" | "cs" | "editor" = "super_admin") {
  const signed = await signInAsStaff(prisma, { roleKey, now: t.clock.now() });
  return {
    signed,
    ctx: await sampleStaffContext(prisma, signed.staff.id, { stepUpAt: t.clock.now() }),
    actor: createActor({ type: "staff", id: signed.staff.id, client: "admin" }),
  };
}
const meta = {
  requestId: "audit-read-test",
  ip: "198.19.35.77",
  userAgent: "test",
  sessionId: null,
  authMethod: "password+totp" as const,
};
const query = (input: object = {}) => AuditLogListQuerySchema.parse(input);

describe("W2-04 脱敏审计只读查询", () => {
  it("稳定游标、分类/操作人/目标/编号/标题过滤和北京时间含端点，不写新审计", async () => {
    const admin = await operator();
    const rows = [];
    for (let n = 0; n < 3; n++)
      rows.push(
        await t.tx.run((tx) =>
          record(tx, admin.actor, meta, {
            stream: "ops",
            category: "staff_authz",
            action: "sys.role.edit",
            summary: `分页测试${n}`,
            target: { type: "staff_role", id: "editor" },
          }),
        ),
      );
    const service = createAuditRead(prisma);
    const first = await service.list(
      admin.ctx,
      query({
        q: "分页测试",
        limit: 2,
        category: "staff_authz,account_security",
        actorId: admin.signed.staff.id,
        targetType: "staff_role",
        targetKey: "editor",
      }),
    );
    expect(first).toMatchObject({
      hasMore: true,
      totalApprox: 3,
      items: [{ auditLogId: rows[2]!.id }, { auditLogId: rows[1]!.id }],
    });
    const last = await service.list(
      admin.ctx,
      query({ q: "分页测试", limit: 2, cursor: first.nextCursor }),
    );
    expect(last).toMatchObject({
      hasMore: false,
      nextCursor: null,
      totalApprox: 3,
      items: [{ auditLogId: rows[0]!.id }],
    });
    const date = new Date(new Date(first.items[0]!.createdAt).getTime() + 8 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    expect(
      (
        await service.list(
          admin.ctx,
          query({ q: rows[0]!.logNo, createdFrom: date, createdTo: date }),
        )
      ).items,
    ).toHaveLength(1);
    await expect(service.list(admin.ctx, query({ cursor: "broken_cursor" }))).rejects.toMatchObject(
      { error: "VALIDATION_FAILED" },
    );
    expect(await prisma.auditLog.count({ where: { summary: { startsWith: "分页测试" } } })).toBe(3);
  });
  it("access仅super_admin、ops需system查看；activity及越权详情404", async () => {
    const admin = await operator();
    const ops = await operator("cs");
    const editor = await operator("editor");
    const access = await t.tx.run((tx) =>
      record(tx, admin.actor, meta, {
        stream: "access",
        category: "pii_reveal",
        action: "pii.phone.reveal",
        summary: "访问字段",
        target: { type: "staff", id: admin.signed.staff.id },
      }),
    );
    const activity = await t.tx.run((tx) =>
      record(tx, admin.actor, meta, {
        stream: "activity",
        category: "staff_authz",
        action: "sys.role.edit",
        summary: "活动流",
      }),
    );
    const service = createAuditRead(prisma);
    await expect(service.list(ops.ctx, query({ stream: "access" }))).rejects.toMatchObject({
      error: "PERMISSION_DENIED",
    });
    await expect(service.list(editor.ctx, query())).rejects.toMatchObject({
      error: "PERMISSION_DENIED",
    });
    await expect(service.get(ops.ctx, access.id)).rejects.toMatchObject({ error: "NOT_FOUND" });
    await expect(service.get(admin.ctx, activity.id)).rejects.toMatchObject({ error: "NOT_FOUND" });
    await expect(service.get(admin.ctx, uuidv7())).rejects.toMatchObject({ error: "NOT_FOUND" });
    expect((await service.get(admin.ctx, access.id)).link).toMatchObject({
      route: "system.staff",
      params: { staffId: admin.signed.staff.id },
    });
  });
  it("非all范围由真实员工操作人事实裁剪；筛选不能覆盖scope，未知归属不扩大", async () => {
    const a = await operator("cs");
    const b = await operator("cs");
    const base = staffRoleDefault("cs")!;
    const ctx = buildStaffContext({
      staff: a.ctx.staff,
      role: normalizeRoleConfig("cs", {
        moduleLevels: { ...base.moduleLevels, system: "v" },
        actions: defaultRoleActions("cs"),
        dataScope: "own",
      }),
      groupStaffIds: [],
      stepUpAt: t.clock.now(),
    });
    const mine = await t.tx.run((tx) =>
      record(tx, a.actor, meta, {
        stream: "ops",
        category: "staff_authz",
        action: "sys.role.edit",
        summary: "范围测试本人",
      }),
    );
    const other = await t.tx.run((tx) =>
      record(tx, b.actor, meta, {
        stream: "ops",
        category: "staff_authz",
        action: "sys.role.edit",
        summary: "范围测试别人",
      }),
    );
    const service = createAuditRead(prisma);
    expect(
      (await service.list(ctx, query({ q: "范围测试" }))).items.map((v) => v.auditLogId),
    ).toEqual([mine.id]);
    expect(
      (await service.list(ctx, query({ actorId: b.signed.staff.id, q: "范围测试" }))).items,
    ).toEqual([]);
    await expect(service.get(ctx, other.id)).rejects.toMatchObject({ error: "NOT_FOUND" });
  });
  it("历史详情再次去凭据、电话脱敏、IP隐藏，JSON超16KB返回摘要", async () => {
    const admin = await operator();
    // 模拟历史旧写侧资料，只在隔离库INSERT；生产写侧仍使用record清洗。
    const row = await prisma.auditLog.create({
      data: {
        id: uuidv7(),
        stream: "ops",
        category: "staff_authz",
        action: "sys.role.edit",
        actorType: "staff",
        actorId: admin.signed.staff.id,
        actorName: "员工",
        actorRole: "管理员",
        client: "admin",
        ip: meta.ip,
        summary: "历史脱敏",
        before: { phone: "13900000123", passwordHash: "secret-hash" },
        after: { memo: "x".repeat(17_000) },
        meta: { token: "raw-token", nested: { phone: "13900000123" } },
      },
    });
    const result = await createAuditRead(prisma).get(admin.ctx, row.id);
    const text = JSON.stringify(result);
    for (const raw of ["13900000123", "secret-hash", "raw-token"]) expect(text).not.toContain(raw);
    expect(result.ipMask).not.toBe(meta.ip);
    expect(result.after).toMatchObject({ keys: ["memo"], sha256: expect.any(String) });
    expect(result.link).toBeNull();
  });
});
