import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callWithSample, createRecordingLogger } from "../testing/index.js";
import {
  createProviders,
  LOCAL_WECHAT_PHONE,
  PROVIDER_METHODS,
  PROVIDER_NAMES,
  ProviderConfigError,
} from "./index.js";
import type {
  ProviderAppEnv,
  ProviderFailureReason,
  ProviderName,
  ProviderResult,
  Providers,
  ProviderSettings,
} from "./index.js";

// 未配置实现的用例（W0-19 任务书 第 7 节第 1、3、4、5 条）。
// 判据：什么 Provider 选项都不给，工厂构建成功；十二个接口逐个方法调一遍，行为与 01 第 9 节
// “未配置时”一列逐行一致；没有未捕获异常。
// storage 在 local、test 下是本地 MinIO：逐个方法调用时它起没起来都行（起来了照常办，没起来返回 unavailable）。

const LOCAL_ENVS: ProviderAppEnv[] = ["local", "test"];
const REMOTE_ENVS: ProviderAppEnv[] = ["stg", "prod"];
const REASONS: ProviderFailureReason[] = ["unconfigured", "unsupported", "unavailable", "rejected"];

function build(appEnv: ProviderAppEnv, settings?: ProviderSettings) {
  const logger = createRecordingLogger();
  return { logger, providers: createProviders({ appEnv, logger, settings }) };
}

/** 01 第 9 节的表：接口名 → “未配置时”一列的原文 */
function docColumn(): Map<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL("../../../../docs/01-architecture.md", import.meta.url)),
    "utf8",
  );
  const section = text.slice(text.indexOf("## 9. 集成架构"), text.indexOf("## 10. "));
  const column = new Map<string, string>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    for (const match of (cells[1] ?? "").matchAll(/`(\w+)`/g)) {
      column.set(match[1] ?? "", cells[5] ?? "");
    }
  }
  return column;
}

/** 逐个方法用样例入参调一遍：都要返回 ProviderResult，不抛错 */
async function callEvery(providers: Providers, name: ProviderName) {
  const results: Array<{ method: string; result: ProviderResult<unknown> }> = [];
  for (const method of PROVIDER_METHODS[name]) {
    const result = await callWithSample(providers, name, method);
    if (result.ok) {
      expect(Object.keys(result).sort()).toEqual(["ok", "value"]);
    } else {
      expect(REASONS).toContain(result.reason);
      expect(result.message).not.toBe("");
    }
    results.push({ method, result });
  }
  return results;
}

/** 这个接口的每个方法都返回“未配置”，提示里写着该怎么降级 */
async function expectAllUnconfigured(providers: Providers, name: ProviderName, hints: string[]) {
  expect(providers[name].status).toBe("unconfigured");
  expect(providers[name].configured).toBe(false);
  const results = await callEvery(providers, name);
  const messages = results.map(({ result }) => (result.ok ? "" : result.message)).join("\n");
  for (const { result } of results)
    expect(result).toMatchObject({ ok: false, reason: "unconfigured" });
  for (const hint of hints) expect(messages).toContain(hint);
}

interface Row {
  name: ProviderName;
  /** 01 第 9 节“未配置时”一列的原文 */
  doc: string;
  /** local、test 下什么都不配时的行为 */
  local(providers: Providers, logs: () => string): Promise<void>;
  /** stg、prod 下什么都不配时的行为 */
  remote(providers: Providers): Promise<void>;
}

/** local 与远端都只是“未配置”的接口：提示里要有 01 第 9 节写的降级办法 */
function degradable(name: ProviderName, doc: string, hints: string[]): Row {
  return {
    name,
    doc,
    local: (providers) => expectAllUnconfigured(providers, name, hints),
    remote: (providers) => expectAllUnconfigured(providers, name, hints),
  };
}

const ROWS: Row[] = [
  {
    name: "wechat",
    doc: "本地用假实现",
    async local({ wechat }, logs) {
      expect(wechat.status).toBe("local");
      expect(wechat.configured).toBe(true);
      // 登录：同一个 code 得到同一个 openid
      expect(await wechat.code2Session({ code: "demo-boss" })).toEqual({
        ok: true,
        value: { openid: "local-openid-demo-boss" },
      });
      expect(await wechat.code2Session({ code: " " })).toMatchObject({
        ok: false,
        reason: "rejected",
      });
      // 手机号：code 本身是手机号就用它，否则回固定的号
      expect(await wechat.getPhoneNumber({ code: "13912345678" })).toEqual({
        ok: true,
        value: { phone: "13912345678" },
      });
      expect(await wechat.getPhoneNumber({ code: "any" })).toEqual({
        ok: true,
        value: { phone: LOCAL_WECHAT_PHONE },
      });
      // 订阅消息：只记日志
      expect(
        await wechat.sendSubscribeMessage({ openid: "o1", templateId: "tpl-1", data: {} }),
      ).toEqual({ ok: true, value: undefined });
      expect(logs()).toContain("[wechat:local] 订阅消息（没有真发）");
      // 小程序码：一张 PNG
      const code = await wechat.createMiniProgramCode({ scene: "s=1" });
      if (!code.ok) throw new Error(code.message);
      expect([...code.value.image.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      // 内容安全：放行
      expect(await wechat.checkText({ openid: "o1", scene: "profile", content: "称呼" })).toEqual({
        ok: true,
        value: { verdict: "pass" },
      });
      expect(await wechat.checkImage({ openid: "o1", scene: "profile", mediaUrl: "u" })).toEqual({
        ok: true,
        value: { verdict: "pass" },
      });
    },
    remote: (providers) => expectAllUnconfigured(providers, "wechat", ["微信小程序未配置"]),
  },
  degradable("wechatPay", "只剩对公转账", ["只剩对公转账"]),
  {
    name: "storage",
    doc: "本地用 MinIO 走小文件通道",
    async local({ storage }) {
      expect(storage.status).toBe("local");
      expect(storage.configured).toBe(true);
      // 小文件通道：没有临时密钥；直传只能落在写入区
      expect(storage.capabilities).toEqual({ sts: false, versioning: false });
      expect(
        await storage.issueSts({ bucket: "media", keyPrefix: "incoming/", durationSec: 900 }),
      ).toMatchObject({ ok: false, reason: "unsupported" });
      expect(
        await storage.presignPost({
          bucket: "media",
          key: "files/direct.mp4",
          mime: "video/mp4",
          maxBytes: 1024,
          expiresSec: 60,
        }),
      ).toMatchObject({ ok: false, reason: "rejected" });
    },
    remote: (providers) => expectAllUnconfigured(providers, "storage", ["对象存储未配置"]),
  },
  {
    name: "media",
    doc: "本地用 MinIO 走小文件通道",
    async local({ media }) {
      expect(media.status).toBe("local");
      expect(media.configured).toBe(true);
      // 小文件通道：不处理，直接返回完成
      const results = await callEvery({ media } as Providers, "media");
      expect(Object.fromEntries(results.map(({ method, result }) => [method, result]))).toEqual({
        probe: { ok: true, value: { processed: false, report: null } },
        transcode: {
          ok: true,
          value: { jobId: "local-transcode-sample-job:1", state: "done", processed: false },
        },
        pack: {
          ok: true,
          value: { jobId: "local-pack-sample-job:2", state: "done", processed: false },
        },
        audit: { ok: true, value: { verdict: "pass", processed: false } },
      });
    },
    remote: (providers) => expectAllUnconfigured(providers, "media", ["媒体处理未配置"]),
  },
  {
    name: "sms",
    doc: "控制台输出；提醒只剩站内与订阅消息",
    async local({ sms }, logs) {
      expect(sms.status).toBe("local");
      expect(sms.configured).toBe(true);
      expect(await sms.sendActivationCode({ phone: "13800138000", code: "135790" })).toEqual({
        ok: true,
        value: undefined,
      });
      expect(logs()).toContain("[sms:console] 员工激活码");
      expect(logs()).toContain("135790");
    },
    remote: (providers) => expectAllUnconfigured(providers, "sms", ["提醒只剩站内与订阅消息"]),
  },
  degradable("ocr", "商家手填、审核人手工核对", ["商家手填、审核人手工核对"]),
  degradable("asr", "不转写", ["不转写"]),
  degradable("llm", "不打标", ["不打标"]),
  degradable("wecom", "员工只收站内待办；服务经理二维码人工上传；在线客服退回小程序原生客服消息", [
    "员工只收站内待办",
    "服务经理二维码人工上传",
    "在线客服退回小程序原生客服消息",
    "后台绑定使用手工录入成员账号",
  ]),
  {
    name: "esign",
    doc: "图片章（生产须显式开关）",
    async local({ esign }) {
      expect(esign.status).toBe("stamp");
      const pdf = new TextEncoder().encode("%PDF-授权书");
      expect(await esign.seal({ pdf })).toEqual({ ok: true, value: { pdf, mode: "stamp" } });
    },
    // 生产没有开关就不出件：见下面“电子签不静默降级”一组
    remote: (providers) => expectAllUnconfigured(providers, "esign", ["图片章开关没有打开"]),
  },
  degradable("invoice", "财务线下开具后上传", ["财务线下开具后上传"]),
  degradable("mail", "只在小程序内下载", ["只在小程序内下载"]),
];

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);
beforeAll(() => {
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
});
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandled);
  process.off("uncaughtException", onUnhandled);
  expect(unhandled).toEqual([]);
});

describe("什么都不配也能启动，行为与 01 第 9 节“未配置时”一列逐行一致", () => {
  it("表里十二行，十二个接口一个不落；01 第 9 节的表也是这十二个", () => {
    expect(ROWS.map((row) => row.name).sort()).toEqual([...PROVIDER_NAMES].sort());
    expect([...docColumn().keys()].sort()).toEqual([...PROVIDER_NAMES].sort());
  });

  it.each([...LOCAL_ENVS, ...REMOTE_ENVS])("%s：不给任何选项，工厂构建成功", (appEnv) => {
    expect(() => build(appEnv)).not.toThrow();
    expect(Object.keys(build(appEnv).providers).sort()).toEqual([...PROVIDER_NAMES].sort());
  });

  describe.each(ROWS)("$name：$doc", (row) => {
    it("这一行的原文与 01 第 9 节相同", () => {
      expect(docColumn().get(row.name)).toBe(row.doc);
    });

    it.each(LOCAL_ENVS)("%s：逐个方法调用都不抛错，行为照这一行", async (appEnv) => {
      const { providers, logger } = build(appEnv);
      await callEvery(providers, row.name);
      await row.local(providers, () => JSON.stringify(logger.lines));
    });

    it.each(REMOTE_ENVS)("%s：逐个方法调用都不抛错，返回“未配置”", async (appEnv) => {
      const { providers } = build(appEnv);
      await callEvery(providers, row.name);
      await row.remote(providers);
    });
  });
});

describe("可降级的能力：返回可识别的“未配置”结果，调用方不靠捕获异常来降级", () => {
  const DEGRADABLE: ProviderName[] = ["ocr", "asr", "llm", "wecom", "mail"];
  const cases = [...LOCAL_ENVS, ...REMOTE_ENVS].flatMap((appEnv) =>
    DEGRADABLE.flatMap((name) =>
      PROVIDER_METHODS[name].map((method) => ({ appEnv, name, method })),
    ),
  );

  it.each(cases)("$appEnv：$name 的 $method", async ({ appEnv, name, method }) => {
    const { providers } = build(appEnv);
    // 是正常返回（resolves），不是抛错
    await expect(callWithSample(providers, name, method)).resolves.toMatchObject({
      ok: false,
      reason: "unconfigured",
    });
  });
});

describe("电子签不静默降级（ADR-039 的例外）", () => {
  const pdf = new TextEncoder().encode("%PDF-授权书");

  it.each(REMOTE_ENVS)("%s：没配电子签、没打开图片章开关，签署返回“未配置”", async (appEnv) => {
    for (const settings of [undefined, {}, { esign: {} }, { esign: { imageSeal: false } }]) {
      const { providers, logger } = build(appEnv, settings);
      expect(providers.esign.status).toBe("unconfigured");
      expect(await providers.esign.seal({ pdf })).toMatchObject({
        ok: false,
        reason: "unconfigured",
      });
      expect(logger.lines.filter((line) => line.level === "warn")).toEqual([]);
    }
  });

  it.each(REMOTE_ENVS)("%s：开关打开才走图片章，并在启动日志里告警", async (appEnv) => {
    const { providers, logger } = build(appEnv, { esign: { imageSeal: true } });
    expect(providers.esign.status).toBe("stamp");
    expect(await providers.esign.seal({ pdf })).toEqual({
      ok: true,
      value: { pdf, mode: "stamp" },
    });
    const warnings = logger.lines.filter((line) => line.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("图片章开关已打开");
    expect(warnings[0]?.message).toContain("法务书面同意");
  });

  it.each(LOCAL_ENVS)("%s：不用开关就是图片章", async (appEnv) => {
    const { providers } = build(appEnv);
    expect(await providers.esign.seal({ pdf })).toMatchObject({
      ok: true,
      value: { mode: "stamp" },
    });
  });
});

describe("只限本地的驱动", () => {
  it.each(REMOTE_ENVS)("%s：选控制台短信即启动失败", (appEnv) => {
    const start = () => build(appEnv, { sms: { driver: "console" } });
    expect(start).toThrow(ProviderConfigError);
    expect(start).toThrow(`控制台短信只限 local、test，${appEnv} 不能选它`);
  });

  it.each(LOCAL_ENVS)("%s：选控制台短信照常启动", (appEnv) => {
    expect(build(appEnv, { sms: { driver: "console" } }).providers.sms.status).toBe("local");
  });

  it.each(REMOTE_ENVS)("%s：选本地 MinIO 即启动失败", (appEnv) => {
    const start = () => build(appEnv, { storage: { driver: "minio" } });
    expect(start).toThrow(ProviderConfigError);
    expect(start).toThrow(`本地 MinIO 只限 local、test，${appEnv} 不能选它`);
  });

  it("不认识的驱动名：启动失败，报错里不带写错的值", () => {
    const typo = "tencnet-mark";
    for (const settings of [{ sms: { driver: typo } }, { storage: { driver: typo } }]) {
      const start = () => build("local", settings as ProviderSettings);
      expect(start).toThrow(ProviderConfigError);
      expect(start).not.toThrow(typo);
    }
  });
});
