import { describe, expect, it } from "vitest";

import { APP_ENVS } from "../kernel/index.js";
import {
  ALL_PROVIDER_METHODS,
  callWithSample,
  createFakeProviders,
  createRecordingLogger,
} from "../testing/index.js";
import type { FakeControl } from "../testing/index.js";
import {
  createProviders,
  guardProviders,
  PROVIDER_APP_ENVS,
  PROVIDER_METHODS,
  PROVIDER_NAMES,
  unconfiguredProviders,
} from "./index.js";
import type { ProviderCall, ProviderName, Providers } from "./index.js";

// 接口清单、三者一致、外呼前钩子的用例（W0-19 任务书 第 7 节第 10 条，第 10 节第 6 步，第 11 节第 3 项）。

const NOT_METHODS = ["status", "configured", "capabilities"];

describe("十二个接口", () => {
  it("名字与顺序照 ADR-039", () => {
    expect([...PROVIDER_NAMES]).toEqual([
      "wechat",
      "wechatPay",
      "sms",
      "storage",
      "media",
      "ocr",
      "asr",
      "llm",
      "wecom",
      "esign",
      "invoice",
      "mail",
    ]);
  });

  it("方法按用途登记，含备份与群机器人能力，一共 43 个", () => {
    expect(
      Object.fromEntries(PROVIDER_NAMES.map((name) => [name, PROVIDER_METHODS[name].length])),
    ).toEqual({
      wechat: 6, // 登录、手机号、订阅消息、小程序码、图片与文本内容安全
      wechatPay: 6, // 预下单、回调验签、查单、关单、退款、账单
      sms: 3, // 员工激活码、订阅消息的补发、值班告警
      storage: 11, // 原八个业务原语，加备份流式上传、对象头与条件复制
      media: 4, // 体检、转码、打包、视频审核
      ocr: 2, // 营业执照识别、行业许可证字段抽取
      asr: 1, // 录音转写
      llm: 2, // 素材识别打标、要点提炼
      wecom: 6, // 员工通知、“联系我”二维码、加好友回调、微信客服、后台扫码、告警群机器人
      esign: 1, // 授权书数字签名
      invoice: 1, // 自动开票
      mail: 1, // 电子发票发送
    });
    expect(ALL_PROVIDER_METHODS).toHaveLength(44);
  });

  it("环境的取值与 kernel 的 APP_ENV 相同", () => {
    expect([...PROVIDER_APP_ENVS]).toEqual([...APP_ENVS]);
  });
});

describe("三者一致：接口、未配置实现、替身的方法集合相同", () => {
  // 少一个方法在编译期就过不去（pnpm typecheck）；这里再在运行时核对一遍，并查没有多出来的
  const fakes = createFakeProviders();

  it.each([...PROVIDER_NAMES])("%s", (name) => {
    const declared: string[] = [...PROVIDER_METHODS[name]].sort();

    const unconfigured: Record<string, unknown> = { ...unconfiguredProviders[name] };
    const functions = Object.keys(unconfigured).filter(
      (key) => typeof unconfigured[key] === "function",
    );
    expect(functions.sort()).toEqual(declared);
    expect(
      Object.keys(unconfigured)
        .filter((key) => !declared.includes(key))
        .sort(),
    ).toEqual(NOT_METHODS.filter((key) => key in unconfigured).sort());

    const fake: Record<string, unknown> = { ...fakes[name] };
    for (const method of declared) expect(typeof fake[method]).toBe("function");
    expect(fake.status).toBe("fake");
    expect(fake.configured).toBe(true);
  });
});

describe("外呼前钩子：每个方法的入口调一次", () => {
  function hooked(build: (beforeCall: (call: ProviderCall) => void) => Providers) {
    const seen: ProviderCall[] = [];
    return { seen, providers: build((call) => void seen.push(call)) };
  }

  it.each(ALL_PROVIDER_METHODS)(
    "未配置实现：$provider 的 $method",
    async ({ provider, method }) => {
      const { seen, providers } = hooked((beforeCall) =>
        createProviders({ appEnv: "prod", logger: createRecordingLogger(), beforeCall }),
      );
      await callWithSample(providers, provider, method);
      expect(seen).toEqual([{ provider, method }]);
    },
  );

  it.each(ALL_PROVIDER_METHODS)("替身：$provider 的 $method", async ({ provider, method }) => {
    const { seen, providers } = hooked((beforeCall) => createFakeProviders({ beforeCall }));
    await callWithSample(providers, provider, method);
    expect(seen).toEqual([{ provider, method }]);
  });

  it("本地落点（假微信、控制台短信、媒体小文件通道、图片章）同样先过钩子", async () => {
    const { seen, providers } = hooked((beforeCall) =>
      createProviders({ appEnv: "local", logger: createRecordingLogger(), beforeCall }),
    );
    await providers.wechat.code2Session({ code: "c" });
    await providers.sms.sendActivationCode({ phone: "13800138000", code: "1" });
    await providers.media.probe({ src: { bucket: "media", key: "incoming/a" } });
    await providers.esign.seal({ pdf: new Uint8Array() });
    // 本地 MinIO：这两个方法不连网
    await providers.storage.issueSts({ bucket: "media", keyPrefix: "incoming/", durationSec: 60 });
    await providers.storage.presignPost({
      bucket: "media",
      key: "files/a",
      mime: "video/mp4",
      maxBytes: 1,
      expiresSec: 1,
    });
    expect(seen.map((call) => `${call.provider}.${call.method}`)).toEqual([
      "wechat.code2Session",
      "sms.sendActivationCode",
      "media.probe",
      "esign.seal",
      "storage.issueSts",
      "storage.presignPost",
    ]);
  });

  it("不给钩子就空转", async () => {
    const providers = createProviders({ appEnv: "prod", logger: createRecordingLogger() });
    await expect(providers.asr.transcribe({ url: "u" })).resolves.toMatchObject({ ok: false });
  });

  it.each(ALL_PROVIDER_METHODS)(
    "钩子抛错：$provider 的 $method 原样抛给调用方，实现没有被调用",
    async ({ provider, method }) => {
      const inTransaction = new Error("在事务里调了外部服务");
      const fakes = createFakeProviders({
        beforeCall: () => {
          throw inTransaction;
        },
      });
      // 抛出来的是拒绝的 Promise，不是同步抛错：调用方用 await 与 .catch 都接得住
      const pending = callWithSample(fakes, provider, method);
      await expect(pending).rejects.toBe(inTransaction);
      expect((fakes[provider] as FakeControl<string>).calls).toEqual([]);
    },
  );

  it("包上钩子之后，状态与替身的编排入口照常可用，写入落在原对象上", async () => {
    const fakes = createFakeProviders();
    expect(fakes.wechatPay.status).toBe("fake");
    fakes.wechatPay.retryDelayMs = 1_000;
    expect(fakes.wechatPay.retryDelayMs).toBe(1_000);
    fakes.storage.capabilities.sts = false;
    expect(
      await fakes.storage.issueSts({ bucket: "media", keyPrefix: "incoming/", durationSec: 60 }),
    ).toMatchObject({ ok: false, reason: "unsupported" });
    fakes.asr.defaultText = "改过的缺省文本";
    expect(await fakes.asr.transcribe({ url: "u" })).toMatchObject({
      ok: true,
      value: { text: "改过的缺省文本" },
    });
  });

  it("guardProviders 可以再包一层：两个钩子各调一次", async () => {
    const order: string[] = [];
    const inner = createFakeProviders({ beforeCall: () => void order.push("inner") });
    const outer = guardProviders(inner, () => void order.push("outer"));
    await outer.mail.send({ to: "a@example.invalid", subject: "s", text: "t" });
    expect(order).toEqual(["outer", "inner"]);
    expect(inner.mail.outbox).toHaveLength(1);
  });
});

describe("替身集合也是一份 Providers", () => {
  it("十二个键都在，名字与 PROVIDER_NAMES 相同", () => {
    const fakes: Record<ProviderName, unknown> = createFakeProviders();
    expect(Object.keys(fakes).sort()).toEqual([...PROVIDER_NAMES].sort());
  });
});
