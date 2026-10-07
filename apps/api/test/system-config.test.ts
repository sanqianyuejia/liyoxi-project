// W2-05：13 个 operationId 的真实管线、事务、版本与缓存链。
import { describe, expect, it, beforeAll } from "vitest";
import type {
  ParamListSchema,
  DictItemViewSchema,
  ChecklistTemplateViewSchema,
  FeatureFlagViewSchema,
  CalendarImportResultSchema,
  z,
} from "@liyoxi/contract";
import { runSeed, uuidv7 } from "@liyoxi/services";
import { signInAsStaff, snapshotTables } from "@liyoxi/services/testing";
import type { SignedInStaff } from "@liyoxi/services/testing";
import { useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";
import { RATE_LIMIT_QUOTAS } from "../src/http/rate-limit-quotas.js";

const handle = useTestApi();
let app: TestApi, admin: SignedInStaff, editor: SignedInStaff;
const prefix = "/api/v1/admin";
type ParamList = z.infer<typeof ParamListSchema>;
type DictItem = z.infer<typeof DictItemViewSchema>;
type Checklist = z.infer<typeof ChecklistTemplateViewSchema>;
type Flag = z.infer<typeof FeatureFlagViewSchema>;
type CalendarImport = z.infer<typeof CalendarImportResultSchema>;
const operations = new Set<string>();
const request = (
  operationId: string,
  path: string,
  method = "GET",
  json?: unknown,
  key = uuidv7(),
  session = admin,
) => {
  operations.add(operationId);
  return app.request(prefix + path, {
    method,
    ...(json === undefined ? {} : { json }),
    headers: { ...session.headers, ...(method === "GET" ? {} : { "Idempotency-Key": key }) },
  });
};
async function data<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { data: T }).data;
}
beforeAll(async () => {
  app = await handle.start();
  await runSeed({ tx: app.runtime.tx, clock: app.clock });
  const prisma = await handle.db.prisma();
  admin = await signInAsStaff(prisma, { roleKey: "super_admin" });
  editor = await signInAsStaff(prisma, { roleKey: "editor" });
}, 120000);

describe("系统配置完整 API", { timeout: 120000 }, () => {
  it("13路由回显真实配置、自然日历幂等和required幂等重放", async () => {
    expect(
      (await data<{ items: unknown[] }>(await request("admin.dictType.list", "/dict-types"))).items
        .length,
    ).toBeGreaterThan(0);
    const key = uuidv7();
    const create = { typeKey: "genre", name: "API题材" };
    const dict = await data<DictItem>(
      await request("admin.dictItem.create", "/dict-items", "POST", create, key),
    );
    const replay = await data<DictItem>(
      await request("admin.dictItem.create", "/dict-items", "POST", create, key),
    );
    expect(replay).toEqual(dict);
    expect(await app.runtime.config.dicts.label("genre", dict.code)).toBe("API题材");
    const updated = await data<DictItem>(
      await request("admin.dictItem.update", `/dict-items/${dict.dictItemId}`, "PATCH", {
        name: "新题材",
        lockVersion: dict.lockVersion,
      }),
    );
    expect(updated.lockVersion).toBe(dict.lockVersion + 1);
    expect(await app.runtime.config.dicts.label("genre", dict.code)).toBe("新题材");
    const params = await data<ParamList>(
      await request("admin.paramValue.list", "/param-values?keys=order.start_delay_minutes"),
    );
    const effectiveAt = new Date(app.clock.now().getTime() + 3600000).toISOString();
    const replaced = await data<ParamList>(
      await request("admin.paramValue.replace", "/param-values", "PUT", {
        items: [
          {
            key: "order.start_delay_minutes",
            value: 5,
            expectedRev: params.items[0]!.latestRev,
            effectiveAt,
          },
        ],
      }),
    );
    const id = replaced.items[0]!.pending[0]!.paramValueId;
    const withdrawn = await data<{ pending: unknown[] }>(
      await request("admin.paramValue.withdraw", `/param-values/${id}/withdraw`, "POST", {}),
    );
    expect(withdrawn.pending).toEqual([]);
    const flags = await data<{ items: Flag[] }>(
      await request("admin.featureFlag.list", "/feature-flags"),
    );
    const flag = flags.items.find((item) => item.flagKey === "export.enabled")!;
    expect(
      (
        await data<Flag>(
          await request("admin.featureFlag.update", "/feature-flags/export.enabled", "PATCH", {
            lockVersion: flag.lockVersion,
            defaultValue: false,
          }),
        )
      ).defaultValue,
    ).toBe(false);
    expect(await app.runtime.config.flags.isEnabled("export.enabled")).toBe(false);
    const items = [
      { key: "api_check", label: "API检查", required: true, allowNa: false, merchantVisible: true },
    ];
    const draft = await data<Checklist>(
      await request("admin.checklistTemplate.create", "/checklist-templates", "POST", {
        code: "qc.sample",
        items,
      }),
    );
    expect(
      (
        await data<Checklist>(
          await request(
            "admin.checklistTemplate.activate",
            `/checklist-templates/${draft.checklistTemplateId}/activate`,
            "POST",
          ),
        )
      ).status,
    ).toBe("active");
    const abandoned = await data<Checklist>(
      await request("admin.checklistTemplate.create", "/checklist-templates", "POST", {
        code: "qc.sample",
        items,
      }),
    );
    expect(
      (
        await data<Checklist>(
          await request(
            "admin.checklistTemplate.discard",
            `/checklist-templates/${abandoned.checklistTemplateId}/discard`,
            "POST",
          ),
        )
      ).status,
    ).toBe("retired");
    const calendar = await data<CalendarImport>(
      await request("admin.calendarDay.batchImport", "/calendar-days/import", "POST", {
        year: 2026,
      }),
    );
    expect(calendar).toMatchObject({
      holidayCount: 7,
      adjustedWorkdayCount: 6,
      source: "国办发明电〔2025〕7号",
    });
    const year = await data<{ days: unknown[] }>(
      await request("admin.calendarDay.list", "/calendar-days?year=2026&includeAllDays=true"),
    );
    expect(year.days).toHaveLength(365);
    expect([...operations].sort()).toEqual(
      [
        "admin.calendarDay.batchImport",
        "admin.calendarDay.list",
        "admin.checklistTemplate.activate",
        "admin.checklistTemplate.create",
        "admin.checklistTemplate.discard",
        "admin.dictItem.create",
        "admin.dictItem.update",
        "admin.dictType.list",
        "admin.featureFlag.list",
        "admin.featureFlag.update",
        "admin.paramValue.list",
        "admin.paramValue.replace",
        "admin.paramValue.withdraw",
      ].sort(),
    );
  });
  it("GET零业务写入；权限、认证、CSRF与required幂等前置拒绝", async () => {
    const prisma = await handle.db.prisma();
    const tables = [
      "dict_type",
      "dict_item",
      "param_value",
      "feature_flag",
      "checklist_template",
      "work_calendar_day",
      "audit_log",
      "outbox_event",
      "idempotency_record",
    ] as const;
    const before = await snapshotTables(prisma, tables);
    for (const path of [
      "/dict-types",
      "/param-values",
      "/feature-flags",
      "/calendar-days?year=2026",
      "/dict-items?typeKey=industry&withRefCount=true",
      "/checklist-templates?allVersions=true",
    ])
      expect((await app.request(prefix + path, { headers: admin.headers })).status).toBe(200);
    expect(await snapshotTables(prisma, tables)).toEqual(before);
    expect((await app.request(prefix + "/feature-flags")).status).toBe(401);
    expect((await app.request(prefix + "/feature-flags", { headers: editor.headers })).status).toBe(
      403,
    );
    const blocked = await request(
      "admin.dictItem.create",
      "/dict-items",
      "POST",
      { typeKey: "genre", name: "越权" },
      uuidv7(),
      editor,
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "PERMISSION_DENIED" });
    const missing = await app.request(prefix + "/dict-items", {
      method: "POST",
      json: { typeKey: "genre", name: "缺幂等" },
      headers: admin.headers,
    });
    expect(missing.status).toBe(400);
    const csrf = await app.request(prefix + "/dict-items", {
      method: "POST",
      json: { typeKey: "genre", name: "跨源" },
      headers: { ...admin.headers, origin: "https://wrong.test", "Idempotency-Key": uuidv7() },
    });
    expect(csrf.status).toBe(403);
  });
  it("409整批conflicts/withdrawdetails、400精确fieldErrors与schema边界", async () => {
    const params = await data<ParamList>(
      await request("admin.paramValue.list", "/param-values?keys=trial.episodes"),
    );
    const current = params.items[0]!;
    const key = uuidv7();
    const input = { items: [{ key: "trial.episodes", value: 2, expectedRev: current.latestRev }] };
    const saved = await data<ParamList>(
      await request("admin.paramValue.replace", "/param-values", "PUT", input, key),
    );
    const conflict = await request("admin.paramValue.replace", "/param-values", "PUT", input);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "VERSION_CONFLICT",
      details: { conflicts: [{ key: "trial.episodes", latestRev: saved.items[0]!.latestRev }] },
    });
    const bad = await request("admin.paramValue.replace", "/param-values", "PUT", {
      items: [{ key: "work.start", value: "20:00", expectedRev: null }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: "VALIDATION_FAILED",
      fieldErrors: [{ path: "items.0.value" }],
    });
    const absent = await request("admin.calendarDay.batchImport", "/calendar-days/import", "POST", {
      year: 2027,
    });
    expect(absent.status).toBe(400);
    expect(await absent.json()).toMatchObject({
      error: "VALIDATION_FAILED",
      fieldErrors: [{ path: "days" }],
    });
    const flag = await request(
      "admin.featureFlag.update",
      "/feature-flags/export.enabled",
      "PATCH",
      { lockVersion: 0 },
    );
    expect(flag.status).toBe(409);
    const tooMany = await request(
      "admin.featureFlag.update",
      "/feature-flags/export.enabled",
      "PATCH",
      {
        lockVersion: 1,
        rules: Array.from({ length: 21 }, () => ({ when: { platform: ["test"] }, value: true })),
      },
    );
    expect(tooMany.status).toBe(400);
  });
  it("本包继承admin.global真实限流，429不占幂等写行", async () => {
    const throttled = await handle.start({
      rateLimitQuotas: {
        ...RATE_LIMIT_QUOTAS,
        "admin.global": [{ by: "user", windowSec: 60, limit: 1 }],
      },
    });
    const key = uuidv7();
    const headers = { ...admin.headers, "Idempotency-Key": key };
    const path = prefix + "/dict-items";
    const json = { typeKey: "genre", name: "限流配置" };
    expect((await throttled.request(path, { method: "POST", json, headers })).status).toBe(200);
    const prisma = await handle.db.prisma();
    const count = await prisma.idempotencyRecord.count();
    const response = await throttled.request(path, {
      method: "POST",
      json,
      headers: { ...headers, "Idempotency-Key": uuidv7() },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(await response.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(await prisma.idempotencyRecord.count()).toBe(count);
  });
});
