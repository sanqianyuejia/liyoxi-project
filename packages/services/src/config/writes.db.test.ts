import { beforeAll, describe, expect, it, vi } from "vitest";
import { assembleServices } from "../assembly.js";
import { createTxRunner, createIdentityContext } from "../kernel/index.js";
import {
  createClock,
  createFactories,
  sampleStaffContext,
  useSeededDatabase,
  configTestStaffBriefs,
  createConfigProfileFixture,
} from "../testing/index.js";
import { createConfig, createConfigAdmin } from "./index.js";
import type { ConfigActor, ConfigAdmin } from "./index.js";

const db = useSeededDatabase("services");
const clock = createClock();
let prisma: Awaited<ReturnType<typeof db.prisma>>, admin: ConfigAdmin, actor: ConfigActor;
let bumps = 0;
beforeAll(async () => {
  prisma = await db.prisma();
  const make = createFactories({ db: prisma, clock });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  actor = {
    staff: await sampleStaffContext(prisma, staff.id),
    identity: createIdentityContext({ actor: { type: "staff", id: staff.id, client: "admin" } }),
  };
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const config = createConfig({
    db: prisma,
    clock,
    redis: {
      async get() {
        return String(bumps);
      },
      async incr() {
        return ++bumps;
      },
    },
  });
  admin = createConfigAdmin({
    tx,
    clock,
    assembly: assembleServices({ entry: "api", appEnv: "test" }),
    config,
    staffBriefs: configTestStaffBriefs,
  });
}, 120000);
const ext = { open: true, special: false, requiredCerts: [] };
const checklistItems = [
  { key: "unique", label: "真实检查", required: true, allowNa: false, merchantVisible: true },
];

describe("W2-05 配置事务", { timeout: 120000 }, () => {
  it("同一类型并发发码不重；父层、同级名称和系统枚举守卫", async () => {
    const [a, b] = await Promise.all([
      admin.createDictItem(actor, { typeKey: "genre", name: "并发甲" }),
      admin.createDictItem(actor, { typeKey: "genre", name: "并发乙" }),
    ]);
    expect(a.code).not.toBe(b.code);
    await expect(
      admin.createDictItem(actor, { typeKey: "genre", name: "并发甲" }),
    ).rejects.toMatchObject({ error: "DICT_NAME_DUPLICATED" });
    const parent = await admin.createDictItem(actor, { typeKey: "industry", name: "根行业", ext });
    const child = await admin.createDictItem(actor, {
      typeKey: "industry",
      parentCode: parent.code,
      name: "子品类",
      ext,
    });
    expect(child.code).toBe(parent.code + "01");
    await expect(
      admin.createDictItem(actor, {
        typeKey: "industry",
        parentCode: child.code,
        name: "超深",
        ext,
      }),
    ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    await expect(
      admin.createDictItem(actor, { typeKey: "region", name: "禁新增" }),
    ).rejects.toMatchObject({ error: "DICT_TYPE_NOT_EDITABLE" });
    const system = await prisma.dictItem.findFirstOrThrow({ where: { dictTypeKey: "plan_tier" } });
    await expect(
      admin.updateDictItem(actor, system.id, { lockVersion: system.lockVersion, isEnabled: false }),
    ).rejects.toMatchObject({
      error: "DICT_ITEM_LOCKED",
      details: { rule: "system_enum_display_only" },
    });
    await expect(
      admin.updateDictItem(actor, a.dictItemId, { lockVersion: 999, name: "旧版" }),
    ).rejects.toMatchObject({ error: "VERSION_CONFLICT" });
    expect(bumps).toBe(4);
  });
  it("真实门店引用阻断行业停用；无引用品类可停用且历史名称仍可读", async () => {
    const item = await admin.createDictItem(actor, { typeKey: "industry", name: "引用行业", ext });
    const make = createFactories({ db: prisma, clock });
    const store = await make.store();
    await prisma.storeProfile.create({
      data: {
        storeId: store.id,
        entityId: store.entityId,
        industryCode: item.code,
        categoryCode: item.code,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
    });
    const counts = await admin.dictReferences([{ typeKey: "industry", code: item.code }]);
    expect(counts.get(`industry:${item.code}`)).toBe(1);
    await expect(
      admin.updateDictItem(actor, item.dictItemId, { lockVersion: 0, isEnabled: false }),
    ).rejects.toMatchObject({ error: "DICT_ITEM_IN_USE", details: { refCount: 1 } });
    const free = await admin.createDictItem(actor, { typeKey: "industry", name: "未引用", ext });
    await admin.updateDictItem(actor, free.dictItemId, { lockVersion: 0, isEnabled: false });
    const config = createConfig({ db: prisma, clock, redis: null });
    expect(await config.dicts.label("industry", free.code)).toBe("未引用");
  });
  it("停用与公开档案新增引用互斥：无停用项进入新业务", async () => {
    const item = await admin.createDictItem(actor, { typeKey: "industry", name: "竞争行业", ext });
    const child = await admin.createDictItem(actor, {
      typeKey: "industry",
      parentCode: item.code,
      name: "竞争品类",
      ext,
    });
    const h = createConfigProfileFixture(prisma);
    const { viewer } = await h.owner();
    const results = await Promise.allSettled([
      admin.updateDictItem(actor, item.dictItemId, { lockVersion: 0, isEnabled: false }),
      h.profile.updateBasic(viewer, {
        lockVersion: 0,
        draft: true,
        storeName: "竞争门店",
        industryCode: item.code,
        categoryCode: child.code,
      }),
    ]);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const row = await prisma.dictItem.findUniqueOrThrow({ where: { id: item.dictItemId } });
    const profile = await prisma.storeProfile.findUnique({
      where: { storeId: viewer.membership.storeId },
    });
    expect(!(row.isEnabled === false && profile?.industryCode === item.code)).toBe(true);
  });
  it("公开档案新增引用真实等待配置项排他锁，提交后保留实际引用", async () => {
    const item = await admin.createDictItem(actor, {
      typeKey: "industry",
      name: "锁事实行业",
      ext,
    });
    const child = await admin.createDictItem(actor, {
      typeKey: "industry",
      parentCode: item.code,
      name: "锁事实品类",
      ext,
    });
    const h = createConfigProfileFixture(prisma);
    const { viewer } = await h.owner();
    let acquired!: () => void;
    let release!: () => void;
    let holderPid = 0;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocking = createTxRunner({ prisma, appEnv: "test" }).run(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      holderPid = backend!.pid;
      await tx.$queryRaw`SELECT id FROM dict_item WHERE id=${item.dictItemId}::uuid FOR UPDATE`;
      acquired();
      await released;
    });
    await held;
    const saving = h.profile.updateBasic(viewer, {
      lockVersion: 0,
      draft: true,
      industryCode: item.code,
      categoryCode: child.code,
    });
    try {
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND ${holderPid}::int=ANY(pg_blocking_pids(pid))`;
          // lyx_app 看不到会话所属账号的 query 文本；定点依赖关系无需提权。
          // 持有者仅持此配置项排他锁；等待者是上面真实 Profile 公口的新增引用。
          expect(row?.n).toBe(1);
        },
        { timeout: 3000, interval: 10 },
      );
    } finally {
      release();
      await blocking;
      await saving;
    }
    expect(
      (
        await prisma.storeProfile.findUniqueOrThrow({
          where: { storeId: viewer.membership.storeId },
        })
      ).industryCode,
    ).toBe(item.code);
    await expect(
      admin.updateDictItem(actor, item.dictItemId, { lockVersion: 0, isEnabled: false }),
    ).rejects.toMatchObject({ error: "DICT_ITEM_IN_USE", details: { refCount: 1 } });
  });
  it("permit_type 同时核 profile 和 config 的实际 requiredCerts；无来源类型明确 null", async () => {
    const permit = await prisma.dictItem.findFirstOrThrow({
      where: { dictTypeKey: "permit_type" },
    });
    await admin.createDictItem(actor, {
      typeKey: "industry",
      name: "许可证引用",
      ext: { ...ext, requiredCerts: [permit.code] },
    });
    await expect(
      admin.updateDictItem(actor, permit.id, { lockVersion: permit.lockVersion, isEnabled: false }),
    ).rejects.toMatchObject({ error: "DICT_ITEM_IN_USE", details: { refCount: 1 } });
    const counts = await admin.dictReferences([{ typeKey: "genre", code: "G01" }]);
    expect(counts.get("genre:G01")).toBeNull();
  });
  it("参数任一版本冲突整批回滚；预约不被立即值撤销；历史和边界可查", async () => {
    const initial = await admin.replaceParams(actor, {
      items: [{ key: "order.start_delay_minutes", value: 5, expectedRev: null }],
    });
    const rev = initial.items[0]!.latestRev;
    const before = await prisma.paramValue.count();
    clock.advance(1);
    await expect(
      admin.replaceParams(actor, {
        items: [
          { key: "order.start_delay_minutes", value: 7, expectedRev: null },
          { key: "trial.episodes", value: 1, expectedRev: null },
        ],
      }),
    ).rejects.toMatchObject({
      error: "VERSION_CONFLICT",
      details: { conflicts: [{ key: "order.start_delay_minutes", latestRev: rev }] },
    });
    expect(await prisma.paramValue.count()).toBe(before);
    const effectiveAt = new Date(clock.now().getTime() + 3600000).toISOString();
    const scheduled = await admin.replaceParams(actor, {
      items: [{ key: "order.start_delay_minutes", value: 9, expectedRev: rev, effectiveAt }],
    });
    const pending = scheduled.items[0]!.pending[0]!;
    clock.advance(1);
    const immediate = await admin.replaceParams(actor, {
      items: [
        { key: "order.start_delay_minutes", value: 6, expectedRev: scheduled.items[0]!.latestRev },
      ],
    });
    expect(immediate.items[0]).toMatchObject({ value: 6, pending: [{ value: 9 }] });
    const withdrawn = await admin.withdrawParam(actor, pending.paramValueId);
    expect(withdrawn.pending).toEqual([]);
    await expect(admin.withdrawParam(actor, pending.paramValueId)).rejects.toMatchObject({
      error: "STATE_NOT_ALLOWED",
    });
    clock.advance(1);
    const boundary = await admin.replaceParams(actor, {
      items: [
        {
          key: "order.start_delay_minutes",
          value: 8,
          expectedRev: withdrawn.latestRev,
          effectiveAt: new Date(clock.now().getTime() + 600000).toISOString(),
        },
      ],
    });
    await expect(
      admin.withdrawParam(actor, boundary.items[0]!.pending[0]!.paramValueId),
    ).rejects.toMatchObject({
      error: "PARAM_WITHDRAW_TOO_LATE",
      details: { effectiveAt: boundary.items[0]!.pending[0]!.effectiveAt },
    });
  });
  it("参数字段校验保留原定义且预约组合仍合法；脱敏原样回传保留真实值", async () => {
    await expect(
      admin.replaceParams(actor, {
        items: [{ key: "work.start", value: "20:00", expectedRev: null }],
      }),
    ).rejects.toMatchObject({
      error: "VALIDATION_FAILED",
      details: { fieldErrors: [{ path: "items.0.value" }] },
    });
    await expect(
      admin.replaceParams(actor, {
        items: [{ key: "trial.episodes", value: -1, expectedRev: null }],
      }),
    ).rejects.toMatchObject({
      error: "VALIDATION_FAILED",
      details: { fieldErrors: [{ path: "items.0.value" }] },
    });
    const value = [
      { staffId: actor.staff.staff.id, phone: "13900112233", wxOpenid: "test_openid_1234" },
    ];
    const first = await admin.replaceParams(actor, {
      items: [{ key: "notify.test_recipients", value, expectedRev: null }],
    });
    expect(first.items[0]!.value).toEqual([
      { staffId: actor.staff.staff.id, phone: "139****2233", wxOpenid: "****1234" },
    ]);
    clock.advance(1);
    await admin.replaceParams(actor, {
      items: [
        {
          key: "notify.test_recipients",
          value: first.items[0]!.value as typeof value,
          expectedRev: first.items[0]!.latestRev,
        },
      ],
    });
    expect(
      (
        await prisma.paramValue.findFirstOrThrow({
          where: { key: "notify.test_recipients" },
          orderBy: { seq: "desc" },
        })
      ).value,
    ).toEqual(value);
  });
  it("flags 规则顺序、JSON约束和旧版守卫；清单版本串行与历史保留", async () => {
    const flag = (await admin.flags()).items.find((row) => row.flagKey === "export.enabled")!;
    const changed = await admin.updateFlag(actor, flag.flagKey, {
      lockVersion: flag.lockVersion,
      defaultValue: false,
      rules: [{ when: { platform: ["test"] }, value: true }],
    });
    expect(changed).toMatchObject({
      defaultValue: false,
      rules: [{ value: true }],
      lockVersion: flag.lockVersion + 1,
    });
    await expect(
      admin.updateFlag(actor, flag.flagKey, { lockVersion: flag.lockVersion, defaultValue: true }),
    ).rejects.toMatchObject({ error: "VERSION_CONFLICT" });
    await expect(
      admin.updateFlag(actor, "client.min_version", { lockVersion: 0, defaultValue: "broken" }),
    ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    const [a, b] = await Promise.all([
      admin.createChecklist(actor, { code: "qc.sample", items: checklistItems }),
      admin.createChecklist(actor, { code: "qc.sample", items: checklistItems }),
    ]);
    expect(a.versionNo).not.toBe(b.versionNo);
    const active = await admin.activateChecklist(actor, a.checklistTemplateId);
    expect(active.status).toBe("active");
    const old = await prisma.checklistTemplate.findMany({
      where: { code: "qc.sample", status: "active" },
    });
    expect(old).toHaveLength(1);
    expect((await admin.discardChecklist(actor, b.checklistTemplateId)).status).toBe("retired");
    await expect(admin.discardChecklist(actor, a.checklistTemplateId)).rejects.toMatchObject({
      error: "STATE_NOT_ALLOWED",
    });
    expect(await prisma.statusTransition.count({ where: { machine: "checklist_template" } })).toBe(
      0,
    );
  });
  it.each([
    { name: "不同mask", phone: "15899994455", wxOpenid: "future_openid_9876" },
    { name: "mask碰撞", phone: "13999992233", wxOpenid: "future_openid_1234" },
  ])("P2 当前敏感原样回传保持A，未来预约B不提前生效：$name", async ({ phone, wxOpenid }) => {
    const key = "notify.test_recipients";
    const currentA = [
      { staffId: actor.staff.staff.id, phone: "13900112233", wxOpenid: "current_openid_1234" },
    ];
    const pendingB = [{ staffId: actor.staff.staff.id, phone, wxOpenid }];
    const prior = (await admin.params({ keys: [key] })).items[0]!;
    clock.advance(1);
    const first = (
      await admin.replaceParams(actor, {
        items: [{ key, value: currentA, expectedRev: prior.latestRev }],
      })
    ).items[0]!;
    const effectiveAt = new Date(clock.now().getTime() + 3_600_000).toISOString();
    const scheduled = (
      await admin.replaceParams(actor, {
        items: [{ key, value: pendingB, expectedRev: first.latestRev, effectiveAt }],
      })
    ).items[0]!;
    const pending = scheduled.pending.find((item) => item.effectiveAt === effectiveAt)!;
    const pendingBefore = await prisma.paramValue.findUniqueOrThrow({
      where: { id: pending.paramValueId },
    });
    const displayed = (await admin.params({ keys: [key] })).items[0]!;
    expect(displayed).toMatchObject({
      value: first.value,
      rev: first.rev,
      latestRev: scheduled.latestRev,
    });
    expect(displayed.rev).not.toBe(displayed.latestRev);
    clock.advance(1);
    try {
      const result = (
        await admin.replaceParams(actor, {
          items: [
            { key, value: displayed.value as typeof currentA, expectedRev: displayed.latestRev },
          ],
        })
      ).items[0]!;
      const saved = await prisma.paramValue.findFirstOrThrow({
        where: { key, cancelledAt: null, effectiveAt: { lte: clock.now() } },
        orderBy: [{ effectiveAt: "desc" }, { seq: "desc" }],
      });
      expect(saved.value).toEqual(currentA);
      expect(result).toMatchObject({ value: first.value, pending: [pending] });
      expect(
        await prisma.paramValue.findUniqueOrThrow({ where: { id: pending.paramValueId } }),
      ).toEqual(pendingBefore);
      // 立即行seq较新也不能覆盖预约的更晚生效时刻；到点仍读取B。
      clock.set(new Date(effectiveAt));
      const nowEffective = (await admin.params({ keys: [key] })).items[0]!;
      expect(nowEffective).toMatchObject({ rev: pending.rev, value: pending.value, pending: [] });
      expect(
        (await prisma.paramValue.findUniqueOrThrow({ where: { id: pending.paramValueId } })).value,
      ).toEqual(pendingB);
    } finally {
      // 回到保存时刻只为用真实撤销口收本用例的预约，不删业务历史行。
      clock.set(new Date(pendingBefore.createdAt.getTime() + 1));
      await admin.withdrawParam(actor, pending.paramValueId);
    }
  });
});
