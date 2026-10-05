// config 读侧的连库用例（任务书 W0-18 第 7 节第 1、3、4、5、6 条）。
// 走测试支架：自己的库（迁移建好、没有种子）、自己的 Redis 前缀；缺省是应用角色 lyx_app。
// param_value 只增不删：每条用例用各自的键，互不干扰。
import { COMMON_ERRORS } from "@liyoxi/contract";
import type { MallConfig } from "@liyoxi/contract";
import { PARAM_DEFS } from "@liyoxi/shared/params";
import type { ParamDef } from "@liyoxi/shared/params";
import { describe, expect, it } from "vitest";

import { createTxRunner, isAppError, uuidv7 } from "../kernel/index.js";
import { createClock, useTestDatabase, useTestRedis } from "../testing/index.js";

import { createConfig, ParamDefsError, paramsAt, PROBE_INTERVAL_MS } from "./index.js";
import type { Config, ConfigProblem } from "./index.js";

const db = useTestDatabase("services");
const redis = useTestRedis();
const TIMEOUT = { timeout: 60_000 };

const staffId = uuidv7();
const HOUR = 3_600_000;

/** 一个进程里的配置服务：各用例各建各的，手里的缓存互不相干 */
async function setup(options: { paramDefs?: readonly ParamDef[] } = {}) {
  const prisma = await db.prisma();
  const clock = createClock();
  const problems: ConfigProblem[] = [];
  const config: Config = createConfig({
    db: prisma,
    clock,
    redis: await redis.client(),
    report: (problem) => problems.push(problem),
    ...options,
  });
  const at = (offsetMs: number): Date => new Date(clock.now().getTime() + offsetMs);
  /** 写一行参数值，返回修订号 */
  const saveParam = async (
    key: string,
    value: unknown,
    effectiveAt: Date,
    cancelledAt?: Date,
  ): Promise<string> => {
    const row = await prisma.paramValue.create({
      data: {
        id: uuidv7(),
        key,
        value: value as never,
        effectiveAt,
        cancelledAt: cancelledAt ?? null,
        createdByStaffId: staffId,
        createdAt: clock.now(),
      },
    });
    return String(row.seq);
  };
  return { prisma, clock, config, problems, at, saveParam };
}

describe("启动自检：参数缺定义启动失败（验收 1）", () => {
  it("登记的键少一条定义：建配置服务即抛错，指出是哪个键", TIMEOUT, async () => {
    const withoutOne = (PARAM_DEFS as readonly ParamDef[]).filter(
      (def) => def.key !== "work.start",
    );
    const prisma = await db.prisma();
    const build = (): Config =>
      createConfig({ db: prisma, clock: createClock(), redis: null, paramDefs: withoutOne });
    expect(build).toThrow(ParamDefsError);
    expect(build).toThrow(/work\.start: 参数缺定义/);
    // 定义齐全时建得出来
    expect(() => createConfig({ db: prisma, clock: createClock(), redis: null })).not.toThrow();
  });
});

describe("参数（验收 3）", () => {
  it("库里没有取代码默认值；默认值为 null 的键读到 null", TIMEOUT, async () => {
    const { config } = await setup();
    expect(await config.params.get("work.start")).toBe("09:00");
    expect(await config.params.get("sla.ticket.assign")).toEqual({
      amount: 120,
      unit: "work_minutes",
    });
    expect(await config.params.get("invoice.apply_within_days")).toBeNull();
    const all = await config.params.all();
    expect(all.size).toBe(PARAM_DEFS.length);
    expect(all.get("work.end")).toEqual({ value: "18:00", rev: null, effectiveAt: null });
  });

  it("已生效的取生效时间最晚的一行；撤销的不算", TIMEOUT, async () => {
    const { config, at, saveParam } = await setup();
    await saveParam("remind.grace_hours", 6, at(-3 * HOUR));
    const rev = await saveParam("remind.grace_hours", 24, at(-1 * HOUR));
    // 一条预约过、生效前撤销了的值：从来没有生效过
    await saveParam("remind.sample.after_days", 9, at(-1 * HOUR), at(-2 * HOUR));
    expect(await config.params.get("remind.grace_hours")).toBe(24);
    expect((await config.params.all()).get("remind.grace_hours")).toMatchObject({ rev });
    expect(await config.params.get("remind.sample.after_days")).toBe(2);
  });

  it("预约的值到点才生效，不用等版本号变（硬过期不晚于切换时刻）", TIMEOUT, async () => {
    const { config, clock, at, saveParam } = await setup();
    await saveParam("export.max_rows", 1000, at(HOUR));
    expect(await config.params.get("export.max_rows")).toBe(200_000);
    clock.advance(HOUR - 1);
    expect(await config.params.get("export.max_rows")).toBe(200_000);
    clock.advance(1);
    expect(await config.params.get("export.max_rows")).toBe(1000);
  });

  it("某一时刻的值查库；快照带修订号", TIMEOUT, async () => {
    const { config, at, saveParam } = await setup();
    const first = at(-10 * HOUR);
    const second = at(-5 * HOUR);
    await saveParam("notify.sms.daily_cap", 3, first);
    const rev = await saveParam("notify.sms.daily_cap", 4, second);
    expect(await config.params.getAt("notify.sms.daily_cap", at(-11 * HOUR))).toBe(6);
    expect(await config.params.getAt("notify.sms.daily_cap", first)).toBe(3);
    expect(await config.params.getAt("notify.sms.daily_cap", at(-6 * HOUR))).toBe(3);
    expect(await config.params.getAt("notify.sms.daily_cap", at(0))).toBe(4);
    expect(await config.params.snapshot(["notify.sms.daily_cap", "notify.window.end"])).toEqual({
      values: { "notify.sms.daily_cap": 4, "notify.window.end": "21:00" },
      revs: { "notify.sms.daily_cap": rev, "notify.window.end": null },
    });
  });

  it("paramsAt：不经配置服务，拿事务句柄读某一时刻的值（W0-30a）", TIMEOUT, async () => {
    const { prisma, problems, at, saveParam } = await setup();
    await saveParam("service.reopen_window_days", 3, at(-10 * HOUR));
    await saveParam("service.reopen_window_days", 5, at(-5 * HOUR));
    await saveParam("service.reopen_window_days", 9, at(HOUR)); // 还没生效
    await saveParam("service.reopen_window_days", 8, at(-HOUR), at(-2 * HOUR)); // 生效前撤销了
    const tx = createTxRunner({ prisma, appEnv: "test" });
    const keys = ["service.reopen_window_days", "work.end"] as const;
    const read = (when: Date, defs?: readonly ParamDef[]) =>
      tx.run((handle) =>
        paramsAt(handle, keys, when, {
          report: (problem) => problems.push(problem),
          ...(defs ? { defs } : {}),
        }),
      );
    expect(await read(at(0))).toEqual({
      "service.reopen_window_days": 5,
      "work.end": "18:00", // 库里没有：代码默认值
    });
    expect((await read(at(-6 * HOUR)))["service.reopen_window_days"]).toBe(3);
    expect((await read(at(-11 * HOUR)))["service.reopen_window_days"]).toBe(7);
    expect((await read(at(2 * HOUR)))["service.reopen_window_days"]).toBe(9);
    expect(problems).toEqual([]);
    // 库里的值不合定义（这里把定义的上限收到 4，库里的 5 就不合了）：回退到代码默认值并上报
    const narrowed = (PARAM_DEFS as readonly ParamDef[]).map((def) =>
      def.key === "service.reopen_window_days" ? { ...def, max: 4 } : def,
    );
    expect((await read(at(0), narrowed))["service.reopen_window_days"]).toBe(7);
    expect(problems.map(({ kind, subject }) => [kind, subject])).toEqual([
      ["param_invalid_value", "service.reopen_window_days"],
    ]);
    // 同一个事务里刚写的值读得到：这是它与走缓存的 get 的差别
    const fresh = await tx.run(async (handle) => {
      await handle.paramValue.create({
        data: {
          id: uuidv7(),
          key: "service.reopen_window_days",
          value: 6,
          effectiveAt: at(-HOUR),
          createdByStaffId: staffId,
          createdAt: at(0),
        },
      });
      return paramsAt(handle, ["service.reopen_window_days"], at(0));
    });
    expect(fresh).toEqual({ "service.reopen_window_days": 6 });
  });

  it("库里的值不合定义、库里有没定义的键：回退默认值并上报；自检列得出来", TIMEOUT, async () => {
    const { config, problems, at, saveParam } = await setup();
    await saveParam("home.banner.max_active", 99, at(-HOUR));
    await saveParam("x.no_such_param", 1, at(-HOUR));
    await saveParam("tenant.default_store_limit", "很多", at(HOUR));
    expect(await config.params.get("home.banner.max_active")).toBe(5);
    expect(problems.map(({ kind, subject }) => [kind, subject]).sort()).toEqual([
      ["param_invalid_value", "home.banner.max_active"],
      ["param_unknown_key", "x.no_such_param"],
    ]);
    // 自检连待生效的行一起查
    const found = (await config.selfCheck()).map(({ kind, subject }) => [kind, subject]);
    expect(found).toEqual(
      expect.arrayContaining([
        ["param_invalid_value", "home.banner.max_active"],
        ["param_invalid_value", "tenant.default_store_limit"],
        ["param_unknown_key", "x.no_such_param"],
      ]),
    );
    // 上报的说明里不带值
    expect(JSON.stringify(problems)).not.toContain("99");
  });
});

describe("开关（验收 4）", () => {
  const entity = uuidv7();

  it("库里没有行：取登记的默认值；下发给前端的只有 client 的键", TIMEOUT, async () => {
    const { config } = await setup();
    const all = await config.flags.evaluate();
    expect(all["weapp.video.ad.enabled"]).toBe(true);
    expect(all["weapp.video.trailer.enabled"]).toBe(false);
    expect(all["notify.sms.enabled"]).toBe(true);
    const client = await config.flags.forClient();
    expect(Object.keys(client)).not.toContain("notify.sms.enabled");
    expect(client["export.enabled"]).toBe(true);
    expect(await config.flags.minClientVersion()).toBe("0.0.0");
  });

  it(
    "开关关闭时接口被拦：403 FEATURE_DISABLED，处理函数没有执行；打开后放行",
    TIMEOUT,
    async () => {
      const { prisma, clock, config } = await setup();
      // 路由的薄壳：先过开关，再进处理函数
      let handled = 0;
      const route = async (context = {}): Promise<string> => {
        await config.flags.requireEnabled("release.notice_faq", context);
        handled += 1;
        return "ok";
      };
      const rejected = await route().catch((error: unknown) => error);
      expect(isAppError(rejected) && rejected.error).toBe("FEATURE_DISABLED");
      expect(COMMON_ERRORS.FEATURE_DISABLED.http).toBe(403);
      expect(handled).toBe(0);

      // 后台把它打开：写库，提交后版本号加 1
      await prisma.featureFlag.create({
        data: {
          key: "release.notice_faq",
          valueType: "bool",
          defaultValue: true,
          exposedTo: "client",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        },
      });
      await config.cache.bump("flag");
      expect(await route()).toBe("ok");
      expect(handled).toBe(1);
      // 不是布尔的开关不能拿来当守卫
      await expect(config.flags.requireEnabled("client.min_version")).rejects.toThrow(TypeError);
    },
  );

  it("规则按序首条命中；都不命中取这一行的默认值", TIMEOUT, async () => {
    const { prisma, clock, config } = await setup();
    await prisma.featureFlag.create({
      data: {
        key: "release.partner",
        valueType: "bool",
        defaultValue: false,
        rules: [
          { when: { platform: ["devtools"] }, value: false },
          { when: { entityIds: [entity] }, value: true },
          { when: { clientVersion: ">=2.0.0", envVersion: ["trial"] }, value: true },
        ],
        exposedTo: "client",
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
    });
    const on = (context: object): Promise<boolean> =>
      config.flags.isEnabled("release.partner", context);
    expect(await on({})).toBe(false);
    expect(await on({ entityId: entity })).toBe(true);
    // 第一条先命中：白名单里的主体在开发者工具里仍是关
    expect(await on({ entityId: entity, platform: "devtools" })).toBe(false);
    expect(await on({ clientVersion: "2.1.0", envVersion: "trial" })).toBe(true);
    expect(await on({ clientVersion: "2.1.0", envVersion: "release" })).toBe(false);
    expect(await on({ clientVersion: "1.9.9", envVersion: "trial" })).toBe(false);
    expect((await config.flags.forClient({ entityId: entity }))["release.partner"]).toBe(true);
  });

  it("最低版本取 client.min_version；库里的行与登记对不上时回退并上报", TIMEOUT, async () => {
    const { prisma, clock, config, problems } = await setup();
    const row = { exposedTo: "client", createdAt: clock.now(), updatedAt: clock.now() };
    await prisma.featureFlag.createMany({
      data: [
        { ...row, key: "client.min_version", valueType: "json", defaultValue: "1.4.0" },
        // 登记的是 bool，库里写成了 enum
        { ...row, key: "weapp.trailer.feed", valueType: "enum", defaultValue: "on" },
        // 规则不合结构
        {
          ...row,
          key: "weapp.trailer.autoplay",
          valueType: "bool",
          defaultValue: true,
          rules: [{ when: {}, value: true }],
        },
        { ...row, key: "x.no_such_flag", valueType: "bool", defaultValue: true },
      ],
    });
    expect(await config.flags.minClientVersion()).toBe("1.4.0");
    expect(await config.flags.value("weapp.trailer.feed")).toBe(false);
    expect(await config.flags.value("weapp.trailer.autoplay")).toBe(false);
    const reported = problems.map(({ kind, subject }) => [kind, subject]).sort();
    expect(reported).toEqual([
      ["flag_invalid_row", "weapp.trailer.autoplay"],
      ["flag_invalid_row", "weapp.trailer.feed"],
      ["flag_unknown_key", "x.no_such_flag"],
    ]);
    const found = (await config.flags.selfCheck()).map(({ kind, subject }) => [kind, subject]);
    expect(found.sort()).toEqual(reported);
  });
});

describe("字典（验收 5）", () => {
  it("后台视图给全部项；小程序视图只给可选的项、白名单里的扩展属性", TIMEOUT, async () => {
    const { prisma, clock, config } = await setup();
    const now = { createdAt: clock.now(), updatedAt: clock.now() };
    await prisma.dictType.createMany({
      data: [
        {
          ...now,
          typeKey: "industry",
          name: "行业品类",
          structure: "tree",
          maxDepth: 2,
          codePrefix: "C",
          codeWidth: 2,
          disablePolicy: "block_if_referenced",
          isMerchantVisible: true,
          versionNo: 7,
        },
        {
          ...now,
          typeKey: "ticket_type",
          name: "工单类型",
          structure: "flat",
          maxDepth: 1,
          codePrefix: "K",
          codeWidth: 2,
          disablePolicy: "free",
          isMerchantVisible: true,
        },
        {
          ...now,
          typeKey: "reject_reason",
          name: "驳回原因",
          structure: "flat",
          maxDepth: 1,
          codePrefix: "R",
          codeWidth: 2,
          disablePolicy: "free",
          isMerchantVisible: false,
        },
      ],
    });
    const item = (dictTypeKey: string, code: string, name: string, extra: object = {}) => ({
      ...now,
      id: uuidv7(),
      dictTypeKey,
      code,
      name,
      ...extra,
    });
    const open = { open: true, special: false, requiredCerts: ["food_business"] };
    // 上级先写：下级的外键指向同类型里的上级编码
    await prisma.dictItem.createMany({
      data: [
        item("industry", "C02", "丽人", { position: 1, ext: { ...open, open: false } }),
        item("industry", "C01", "餐饮", { position: 0, ext: open, tags: ["热门"] }),
        item("industry", "C03", "停用的行业", { position: 2, ext: open, isEnabled: false }),
        item("ticket_type", "K01", "交付进度", {
          ext: {
            defaultPriority: "mid",
            transferable: true,
            notifyLead: false,
            isAfterSales: false,
          },
        }),
        item("reject_reason", "R01", "证照模糊", { ext: { scene: "store_review" } }),
      ],
    });
    await prisma.dictItem.createMany({
      data: [
        item("industry", "C0102", "烧烤", { parentCode: "C01", position: 1, ext: open }),
        item("industry", "C0101", "火锅", { parentCode: "C01", position: 0, ext: open }),
      ],
    });

    // 后台视图：全部项，上级在前、同级按 position，扩展属性原样
    const staffView = await config.dicts.list("industry");
    expect(staffView.items.map((entry) => entry.code)).toEqual([
      "C01",
      "C0101",
      "C0102",
      "C02",
      "C03",
    ]);
    expect(staffView.items[0]).toMatchObject({ ext: open, tags: ["热门"], isSelectable: true });
    expect(staffView).toMatchObject({ versionNo: 7, structure: "tree" });
    await expect(config.dicts.list("no_such_type")).rejects.toMatchObject({ error: "NOT_FOUND" });

    // 小程序视图
    const [industry, ticketType] = await config.dicts.listForMerchant(["industry", "ticket_type"]);
    expect(industry!.items.map((entry) => entry.code)).toEqual(["C01", "C0101", "C0102"]);
    expect(industry!.items[0]!.ext).toEqual({ special: false, requiredCerts: ["food_business"] });
    expect(ticketType!.items[0]!.ext).toEqual({ isAfterSales: false });
    const withDisabled = await config.dicts.listForMerchant(["industry"], {
      includeDisabled: true,
    });
    expect(withDisabled[0]!.items.map((entry) => [entry.code, entry.isSelectable])).toEqual([
      ["C01", true],
      ["C0101", true],
      ["C0102", true],
      ["C02", false],
      ["C03", false],
    ]);
    const children = await config.dicts.listForMerchant(["industry"], { parentCode: "C01" });
    expect(children[0]!.items.map((entry) => entry.code)).toEqual(["C0101", "C0102"]);
    // 小程序不可见的类型、不存在的类型、parentCode 用得不对
    for (const call of [
      () => config.dicts.listForMerchant(["reject_reason"]),
      () => config.dicts.listForMerchant(["no_such_type"]),
      () => config.dicts.listForMerchant(["industry", "ticket_type"], { parentCode: "C01" }),
      () => config.dicts.listForMerchant(["ticket_type"], { parentCode: "K01" }),
    ]) {
      await expect(call()).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    }

    // 名称不看启用状态；可选要启用且开放
    expect(await config.dicts.label("industry", "C03")).toBe("停用的行业");
    expect(await config.dicts.label("reject_reason", "R01")).toBe("证照模糊");
    expect(await config.dicts.label("industry", "C99")).toBeNull();
    expect(await config.dicts.isSelectable("industry", "C0101")).toBe(true);
    expect(await config.dicts.isSelectable("industry", "C02")).toBe(false);
    expect(await config.dicts.isSelectable("industry", "C03")).toBe(false);
    expect(await config.dicts.isSelectable("industry", "C99")).toBe(false);
    expect(await config.dicts.isSelectable("reject_reason", "R01")).toBe(true);
    expect(await config.dicts.versions()).toEqual({
      industry: 7,
      ticket_type: 1,
      reject_reason: 1,
    });
  });
});

describe("站点配置与清单模板（验收 5）", () => {
  const mall: MallConfig = {
    categories: [{ key: "all", name: "全部", genreCodes: [], visible: true, fixed: true }],
    hotWords: [],
    filters: {
      genre: true,
      industry: false,
      episodes: false,
      price: false,
      episodeBands: [],
      priceBands: [],
    },
    sorts: ["composite"],
    defaultSort: "composite",
    weights: { heat: 40, sales30d: 30, freshness: 20, manual: 10 },
  };

  it("站点配置取已发布的一版；草稿、归档、不合结构的都不算", TIMEOUT, async () => {
    const { prisma, clock, config, problems } = await setup();
    const now = { createdAt: clock.now(), updatedAt: clock.now() };
    const publishedAt = clock.now();
    expect(await config.siteConfig.published("mall")).toBeNull();
    await prisma.siteConfigRevision.createMany({
      data: [
        {
          ...now,
          id: uuidv7(),
          configKey: "mall",
          revNo: 1,
          status: "archived",
          content: { ...mall, hotWords: ["旧"] },
          publishedAt,
        },
        {
          ...now,
          id: uuidv7(),
          configKey: "mall",
          revNo: 2,
          status: "published",
          content: mall,
          publishedAt,
        },
        {
          ...now,
          id: uuidv7(),
          configKey: "mall",
          status: "draft",
          content: { ...mall, hotWords: ["草稿"] },
          baseRevNo: 2,
        },
        // 已发布、但内容不合结构
        {
          ...now,
          id: uuidv7(),
          configKey: "home_recommend",
          revNo: 1,
          status: "published",
          content: { recommendCount: 99 },
          publishedAt,
        },
      ],
    });
    await config.cache.bump("site");
    expect(await config.siteConfig.published("mall")).toEqual({
      configKey: "mall",
      revNo: 2,
      content: mall,
      publishedAt,
    });
    expect(await config.siteConfig.published("home_recommend")).toBeNull();
    expect(problems.map(({ kind, subject }) => [kind, subject])).toEqual([
      ["site_config_invalid", "home_recommend"],
    ]);
  });

  it("清单模板取启用中的版本；按版本号取得到历史版本，草稿取不到", TIMEOUT, async () => {
    const { prisma, clock, config } = await setup();
    const now = { createdAt: clock.now(), updatedAt: clock.now() };
    const items = (label: string) => [
      { key: "subtitle", label, required: true, allowNa: false, merchantVisible: true },
    ];
    const earlier = new Date(clock.now().getTime() - HOUR);
    await prisma.checklistTemplate.createMany({
      data: [
        {
          ...now,
          id: uuidv7(),
          code: "qc.sample",
          versionNo: 1,
          status: "retired",
          items: items("第一版"),
          activatedAt: earlier,
          retiredAt: clock.now(),
        },
        {
          ...now,
          id: uuidv7(),
          code: "qc.sample",
          versionNo: 2,
          status: "active",
          items: items("第二版"),
          activatedAt: clock.now(),
        },
        { ...now, id: uuidv7(), code: "qc.sample", versionNo: 3, status: "draft", items: [] },
      ],
    });
    expect(await config.checklists.active("qc.sample")).toMatchObject({
      code: "qc.sample",
      versionNo: 2,
      status: "active",
      items: items("第二版"),
    });
    expect(await config.checklists.version("qc.sample", 1)).toMatchObject({
      status: "retired",
      items: items("第一版"),
    });
    expect(await config.checklists.version("qc.sample", 3)).toBeNull();
    expect(await config.checklists.version("qc.sample", 9)).toBeNull();
    expect(await config.checklists.active("launch.verify")).toBeNull();
  });
});

describe("两个进程经 Redis 的版本号互相看到改动（验收 6）", () => {
  it("一边写库并把版本号加 1，另一边下一次探测即读到新值", TIMEOUT, async () => {
    const reader = await setup();
    const writer = await setup();
    expect(await reader.config.params.get("auth.dormant_days")).toBe(180);
    await writer.saveParam("auth.dormant_days", 90, writer.at(-HOUR));
    const before = await reader.config.cache.version("param");
    await writer.config.cache.bump("param");
    expect(await reader.config.cache.version("param")).toBe(before + 1);
    // 写的一方自己立刻读到；读的一方在探测间隔内还是旧值，过了间隔读到新值
    expect(await writer.config.params.get("auth.dormant_days")).toBe(90);
    expect(await reader.config.params.get("auth.dormant_days")).toBe(180);
    reader.clock.advance(PROBE_INTERVAL_MS);
    expect(await reader.config.params.get("auth.dormant_days")).toBe(90);
    // 版本号放在本 worker 的前缀之下
    const raw = await redis.raw();
    expect(await raw.get(`${redis.prefix}cfg:ver:param`)).toBe(String(before + 1));
  });
});
