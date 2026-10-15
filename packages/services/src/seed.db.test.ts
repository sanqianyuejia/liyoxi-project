// 播种的连库用例（任务书 W0-21 第 7 节第 1、2、3 条）。
// 走测试支架：自己的库（迁移建好、没有种子），缺省身份是应用角色 lyx_app——播种按它的授权就够。
// 几条用例共用一个库、按先后讲一件事：空库 → 播种 → 再播 → 运营改过与注册表多了键 → 造违规。
import {
  CHECKLIST_TEMPLATE_CODE,
  defaultRoleActions,
  FLAGS,
  NOTIFY_SCENES,
  STAFF_ROLE_KEY,
} from "@liyoxi/contract";
import type { PrismaClient } from "@liyoxi/db";
import { describe, expect, it } from "vitest";

import { DICT_ITEM_SEEDS } from "./config/index.js";
import { createTxRunner, uuidv7 } from "./kernel/index.js";
import type { AssertionViolation } from "./kernel/index.js";
import { checkSeedAssertions, runSeed, SEED_MODULES } from "./seed.js";
import { createClock, useTestDatabase } from "./testing/index.js";

const db = useTestDatabase("services");
// 机器忙时建库、跑 700 多行的插入都会慢：时限留足
const TIMEOUT = { timeout: 180_000 };

/** 种子会写的表 */
const TABLES = [
  "dict_type",
  "dict_item",
  "feature_flag",
  "checklist_template",
  "site_config_revision",
  "work_calendar_day",
  "staff_role",
  "staff_group",
  "wx_template_slot",
  "sms_template",
  "notify_scene",
  "agreement",
  "plan",
  "plan_revision",
  "point_pack",
  "price_tier_revision",
  "billing_param",
  "valuation_policy",
] as const;

const clock = createClock();

async function setup() {
  const prisma = await db.prisma();
  return { prisma, tx: createTxRunner({ prisma, appEnv: "test" }) };
}

/** 各表的行数 */
async function counts(prisma: PrismaClient): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${table}`,
    );
    result[table] = rows[0]?.n ?? -1;
  }
  return result;
}

/** 各表全部内容的指纹：任何一行、任何一列变了都会变 */
async function fingerprints(prisma: PrismaClient): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ digest: string | null }[]>(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS digest FROM ${table} t`,
    );
    result[table] = rows[0]?.digest ?? "空表";
  }
  return result;
}

const codesOf = (violations: readonly AssertionViolation[]): string[] =>
  [...new Set(violations.map((item) => item.code))].sort();
const subjectsOf = (violations: readonly AssertionViolation[], code: string): string[] =>
  violations.filter((item) => item.code === code).map((item) => item.subjectKey);

describe("播种", () => {
  it("空库上：该有种子才成立的四条断言报得出违规", TIMEOUT, async () => {
    const { prisma } = await setup();
    const violations = await checkSeedAssertions(prisma, clock.now());
    expect(codesOf(violations)).toEqual(["config.N16", "config.N20", "config.N9", "staff.I8"]);
    expect(subjectsOf(violations, "staff.I8").sort()).toEqual([...STAFF_ROLE_KEY.values].sort());
    expect(subjectsOf(violations, "config.N9")).toEqual(["home_recommend", "mall"]);
    expect(subjectsOf(violations, "config.N16")).toEqual(["plan_tier", "point_type"]);
    expect(subjectsOf(violations, "config.N20")).toHaveLength(
      CHECKLIST_TEMPLATE_CODE.values.length,
    );
  });

  it("空库播种：以应用角色跑通，行数对得上，六条断言 0 违规", TIMEOUT, async () => {
    const { prisma, tx } = await setup();
    const who = await prisma.$queryRawUnsafe<{ current_user: string }[]>("SELECT current_user");
    expect(who[0]?.current_user).toBe("lyx_app");

    const report = await runSeed({ tx, clock });
    expect(report.tables.map((table) => table.table)).toEqual([...TABLES]);
    expect([...new Set(report.tables.map((table) => table.module))]).toEqual(
      SEED_MODULES.map((item) => item.module),
    );
    expect(report.tables.every((table) => table.existing === 0)).toBe(true);

    const stored = await counts(prisma);
    expect(stored).toEqual({
      dict_type: 22,
      dict_item: DICT_ITEM_SEEDS.length,
      feature_flag: FLAGS.length,
      checklist_template: 9,
      site_config_revision: 2,
      work_calendar_day: 730,
      staff_role: 8,
      staff_group: 8,
      wx_template_slot: 12,
      sms_template: 9,
      notify_scene: NOTIFY_SCENES.length,
      agreement: 6,
      plan: 3,
      plan_revision: 3,
      point_pack: 4,
      price_tier_revision: 4,
      billing_param: 12,
      valuation_policy: 1,
    });
    const sceneKeys = await prisma.notifyScene.findMany({
      select: { sceneKey: true },
      orderBy: { sceneKey: "asc" },
    });
    expect(sceneKeys.map((row) => row.sceneKey)).toEqual(
      NOTIFY_SCENES.map((row) => row.key).sort(),
    );
    expect(report.inserted).toBe(Object.values(stored).reduce((sum, n) => sum + n, 0));

    expect(await checkSeedAssertions(prisma, clock.now())).toEqual([]);
  });

  it("照文档抽查几行", TIMEOUT, async () => {
    const { prisma } = await setup();
    // 角色：权限点开关取默认授予；超级管理员锁定、开关为空
    const cs = await prisma.staffRole.findUniqueOrThrow({ where: { key: "cs" } });
    expect(cs.actions).toEqual(defaultRoleActions("cs"));
    expect((cs.moduleLevels as Record<string, string>).service).toBe("e");
    const admin = await prisma.staffRole.findUniqueOrThrow({ where: { key: "super_admin" } });
    expect([admin.isLocked, admin.actions, admin.updatedByStaffId]).toEqual([true, {}, null]);
    // 场景：通道绑定；员工场景没有槽位与短信
    const sample = await prisma.notifyScene.findUniqueOrThrow({
      where: { sceneKey: "m.sample_pending" },
    });
    expect(sample).toMatchObject({
      audience: "merchant",
      name: "样片待确认",
      wxTemplateSlotKey: "service_progress",
      smsPolicy: "fallback",
      smsTemplateKey: "sample_pending",
      smsNodes: ["R1", "M"],
      sendWindow: "window",
      extEnabled: true,
      sceneEnabled: true,
    });
    expect(
      await prisma.notifyScene.count({
        where: {
          audience: "staff",
          OR: [{ wxTemplateSlotKey: { not: null } }, { smsPolicy: { not: "never" } }],
        },
      }),
    ).toBe(0);
    expect(await prisma.wxTemplateSlot.count({ where: { status: "unconfigured" } })).toBe(12);
    // 开关：默认值是 JSON null 的那个键写的是 JSON null
    const flags = await prisma.$queryRawUnsafe<{ key: string; kind: string }[]>(
      "SELECT key, jsonb_typeof(default_value) AS kind FROM feature_flag WHERE key IN ('ops.maintenance_notice', 'client.min_version', 'export.enabled') ORDER BY key",
    );
    expect(flags.map((row) => row.kind)).toEqual(["string", "boolean", "null"]);
    // 字典：驳回原因发到 R34，下一个号是 35；固定编码的类型号没动
    const types = await prisma.dictType.findMany({
      where: { typeKey: { in: ["reject_reason", "permit_type", "plan_tier"] } },
      orderBy: { typeKey: "asc" },
    });
    expect(types.map((type) => [type.typeKey, type.nextCodeNo, type.codePrefix])).toEqual([
      ["permit_type", 1, "PT"],
      ["plan_tier", 1, null],
      ["reject_reason", 35, "R"],
    ]);
    // 清单 9 套各一个启用版本；站点配置两份都是已发布的第 1 版
    expect(
      await prisma.checklistTemplate.count({ where: { status: "active", versionNo: 1 } }),
    ).toBe(9);
    const site = await prisma.siteConfigRevision.findMany({ orderBy: { configKey: "asc" } });
    expect(site.map((row) => [row.configKey, row.status, row.revNo])).toEqual([
      ["home_recommend", "published", 1],
      ["mall", "published", 1],
    ]);
    // 价目：专业版首版；计费参数立即生效
    const pro = await prisma.planRevision.findFirstOrThrow({ where: { plan: { code: "pro" } } });
    expect(pro).toMatchObject({
      revisionNo: 1,
      monthlyFeeFen: 600_000,
      monthlyPoints: 6600,
      discountBp: 9000,
      cyclePrices: { "1": 600_000, "3": 1_800_000, "12": 7_200_000 },
      announcedAt: null,
      createdByStaffId: null,
    });
    expect(pro.effectiveAt.getTime()).toBe(clock.now().getTime());
    // 日历：国庆节当天放假，调休的周六上班
    const days = await prisma.$queryRawUnsafe<{ day: string; kind: string; is_workday: boolean }[]>(
      "SELECT day::text AS day, kind, is_workday FROM work_calendar_day WHERE day IN ('2026-10-01', '2026-10-10', '2027-10-01') ORDER BY day",
    );
    expect(days).toEqual([
      { day: "2026-10-01", kind: "holiday", is_workday: false },
      { day: "2026-10-10", kind: "adjusted_workday", is_workday: true },
      { day: "2027-10-01", kind: "weekday", is_workday: true },
    ]);
  });

  it("再播一遍：新增 0 行，各表内容逐行不变", TIMEOUT, async () => {
    const { prisma, tx } = await setup();
    const before = await fingerprints(prisma);
    clock.advance(3_600_000); // 要是有行被重写，时间列会跟着变
    const report = await runSeed({ tx, clock });
    expect(report.inserted).toBe(0);
    expect(report.tables.filter((table) => table.inserted > 0)).toEqual([]);
    expect(await fingerprints(prisma)).toEqual(before);
  });

  it("运营改过的行不被改回；注册表里多出来的键只补这一行", TIMEOUT, async () => {
    const { prisma, tx } = await setup();
    // 后台把一个开关关了，把客服的一个权限点关了
    await prisma.featureFlag.update({
      where: { key: "export.enabled" },
      data: { defaultValue: false, lockVersion: 1 },
    });
    await prisma.staffRole.update({
      where: { key: "cs" },
      data: { actions: { "merchant.profile.proxy_edit": { on: false, leadOnly: false } } },
    });
    // 相当于代码里新登记了一个开关、一个场景：库里还没有这两行
    await prisma.featureFlag.delete({ where: { key: "weapp.trailer.feed" } });
    await prisma.notifyScene.delete({ where: { sceneKey: "s.merchant_changed" } });

    clock.advance(60_000);
    const report = await runSeed({ tx, clock });
    expect(report.tables.filter((table) => table.inserted > 0)).toEqual([
      { module: "config", table: "feature_flag", inserted: 1, existing: FLAGS.length - 1 },
      { module: "notify", table: "notify_scene", inserted: 1, existing: NOTIFY_SCENES.length - 1 },
    ]);
    const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key: "export.enabled" } });
    expect([flag.defaultValue, flag.lockVersion]).toEqual([false, 1]);
    const cs = await prisma.staffRole.findUniqueOrThrow({ where: { key: "cs" } });
    expect(cs.actions).toEqual({ "merchant.profile.proxy_edit": { on: false, leadOnly: false } });
    expect(await checkSeedAssertions(prisma, clock.now())).toEqual([]);
  });

  it("各造一条违规数据，六条断言都查得出来", TIMEOUT, async () => {
    const { prisma } = await setup();
    const now = clock.now();
    const staffId = uuidv7();
    // staff.I8：少一个角色（它的默认组有外键指着，先删）
    await prisma.staffGroup.deleteMany({ where: { staffRoleKey: "channel_ops" } });
    await prisma.staffRole.delete({ where: { key: "channel_ops" } });
    // config.N9：商城配置没有已发布的一版；同时生效的 Banner 超过上限（默认 5 张）
    await prisma.siteConfigRevision.updateMany({
      where: { configKey: "mall", status: "published" },
      data: { status: "archived", updatedAt: now },
    });
    await prisma.homeBanner.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        id: uuidv7(),
        title: `测试 ${index + 1}`,
        imageFileId: uuidv7(),
        jumpKind: "none",
        startAt: new Date(now.getTime() - 60_000),
        position: index,
        createdByStaffId: staffId,
        createdAt: now,
        updatedAt: now,
      })),
    });
    // config.N16：系统枚举字典里多出一项
    await prisma.dictItem.create({
      data: {
        id: uuidv7(),
        dictTypeKey: "plan_tier",
        code: "vip",
        name: "至尊版",
        position: 9,
        createdAt: now,
        updatedAt: now,
      },
    });
    // config.N17：没有定义的参数键
    await prisma.paramValue.create({
      data: {
        id: uuidv7(),
        key: "lyxtest.undefined_key",
        value: 1,
        effectiveAt: now,
        createdByStaffId: staffId,
        createdAt: now,
      },
    });
    // config.N19：没登记的开关键；值类型与登记不一致
    await prisma.featureFlag.create({
      data: {
        key: "lyxtest.unknown",
        valueType: "bool",
        defaultValue: true,
        exposedTo: "server",
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.featureFlag.update({
      where: { key: "client.min_version" },
      data: { valueType: "enum" },
    });
    // config.N20：一套清单没有启用中的版本
    await prisma.checklistTemplate.updateMany({
      where: { code: "patrol.check", status: "active" },
      data: { status: "retired", retiredAt: now, updatedAt: now },
    });

    const violations = await checkSeedAssertions(prisma, now);
    expect(codesOf(violations)).toEqual([
      "config.N16",
      "config.N17",
      "config.N19",
      "config.N20",
      "config.N9",
      "staff.I8",
    ]);
    expect(subjectsOf(violations, "staff.I8")).toEqual(["channel_ops"]);
    const n9 = subjectsOf(violations, "config.N9");
    expect(n9[0]).toMatch(/^home_banner@/);
    expect(n9.slice(1)).toEqual(["mall"]);
    expect(violations.find((item) => item.code === "config.N9")?.detail).toBe(
      "同时生效 6 张，上限 5 张",
    );
    expect(violations.filter((item) => item.code === "config.N16")).toEqual([
      { code: "config.N16", subjectKey: "plan_tier", detail: "多出项 vip" },
    ]);
    expect(subjectsOf(violations, "config.N17")).toEqual(["lyxtest.undefined_key"]);
    expect(violations.filter((item) => item.code === "config.N19")).toEqual([
      {
        code: "config.N19",
        subjectKey: "client.min_version",
        detail: "值类型是 enum，登记的是 json",
      },
      { code: "config.N19", subjectKey: "lyxtest.unknown", detail: "开关键没有登记" },
    ]);
    expect(subjectsOf(violations, "config.N20")).toEqual(["patrol.check"]);
  });
});
