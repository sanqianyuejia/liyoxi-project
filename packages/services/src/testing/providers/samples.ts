// 十二个接口每个方法一份样例入参。类型照接口推出来：接口加了方法而这里没补，编译失败。
// 用例拿它把全部方法逐个调一遍（未配置实现、外呼前钩子、替身的失败与延迟）。

import { PROVIDER_METHODS, PROVIDER_NAMES } from "../../providers/types.js";
import type {
  ProviderMethodName,
  ProviderName,
  ProviderResult,
  Providers,
} from "../../providers/types.js";

export type ProviderInputs = {
  [K in ProviderName]: {
    [M in ProviderMethodName<Providers[K]>]: Providers[K][M] extends (input: infer I) => unknown
      ? I
      : never;
  };
};

const SAMPLE_REF = { bucket: "media", key: "incoming/sample/video.mp4" } as const;

export const SAMPLE_PROVIDER_INPUTS: ProviderInputs = {
  wechat: {
    code2Session: { code: "sample-code" },
    getPhoneNumber: { code: "sample-phone-code" },
    sendSubscribeMessage: {
      openid: "sample-openid",
      templateId: "sample-template",
      data: { thing1: "样例" },
    },
    createMiniProgramCode: { scene: "s=1", page: "pages/home/index" },
    checkText: { openid: "sample-openid", scene: "profile", content: "样例称呼" },
    checkImage: {
      openid: "sample-openid",
      scene: "profile",
      mediaUrl: "https://example.invalid/a.jpg",
    },
  },
  wechatPay: {
    createJsapiOrder: {
      outTradeNo: "FK-SAMPLE-0001",
      description: "样例套餐",
      amountFen: 19900,
      payerOpenid: "sample-openid",
    },
    verifyAndDecryptNotification: { headers: {}, rawBody: "{}" },
    queryByOutTradeNo: { outTradeNo: "FK-SAMPLE-0001" },
    closeOrder: { outTradeNo: "FK-SAMPLE-0001" },
    createRefund: {
      outTradeNo: "FK-SAMPLE-0001",
      outRefundNo: "TK-SAMPLE-0001",
      refundFen: 100,
      totalFen: 19900,
    },
    fetchTradeBill: { billDate: "2026-10-01" },
  },
  sms: {
    sendActivationCode: { phone: "13800138000", code: "246810" },
    sendSubscribeFallback: {
      phone: "13800138000",
      templateKey: "order_delivered",
      params: { orderNo: "LYX-SAMPLE-0001" },
    },
    sendOncallAlert: { phones: ["13800138000"], title: "样例告警", content: "worker 租约过期" },
  },
  storage: {
    backupPutStream: {
      bucket: "lyx-test-backup",
      key: "daily/sample.dump.age",
      maxBytes: 1024,
      body: {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2, 3]);
        },
      },
      signal: new AbortController().signal,
    },
    backupHead: { bucket: "lyx-test-backup", key: "daily/sample.dump.age" },
    backupCopy: {
      src: { bucket: "lyx-test-backup", key: "daily/sample.dump.age" },
      dst: { bucket: "lyx-test-backup", key: "monthly/sample.dump.age" },
      ifMatchEtag: '"sample-etag"',
    },
    presignPost: { ...SAMPLE_REF, mime: "video/mp4", maxBytes: 20 * 1024 * 1024, expiresSec: 600 },
    issueSts: { bucket: "media", keyPrefix: "incoming/sample/", durationSec: 900 },
    head: SAMPLE_REF,
    readPrefix: { ...SAMPLE_REF, bytes: 4096 },
    putObject: { ...SAMPLE_REF, body: new Uint8Array([1, 2, 3]), contentType: "application/pdf" },
    copy: {
      src: SAMPLE_REF,
      dst: { bucket: "media", key: "files/sample/video.mp4" },
      ifMatchEtag: '"sample-etag"',
      contentType: "video/mp4",
    },
    presignGet: { ...SAMPLE_REF, expiresSec: 900, disposition: "inline" },
    delete: SAMPLE_REF,
  },
  media: {
    probe: { src: SAMPLE_REF },
    transcode: {
      src: SAMPLE_REF,
      dst: { bucket: "media", key: "files/sample/video-720p.mp4" },
      template: "mp4-720p",
      userData: "sample-job:1",
    },
    pack: {
      bucket: "media",
      items: [{ key: "files/sample/video.mp4", name: "第 1 集.mp4" }],
      dstKey: "files/sample/pack.zip",
      userData: "sample-job:2",
    },
    audit: { src: SAMPLE_REF, scenes: ["porn", "politics"], userData: "sample-job:3" },
  },
  ocr: {
    recognizeBusinessLicense: { imageUrl: "https://example.invalid/license.jpg" },
    extractLicenseFields: {
      fileUrl: "https://example.invalid/permit.jpg",
      fieldNames: ["许可证编号", "有效期至"],
    },
  },
  asr: { transcribe: { url: "https://example.invalid/voice.m4a" } },
  llm: {
    tagAsset: { kind: "image", url: "https://example.invalid/dish.jpg" },
    extractKeyPoints: { text: "招牌菜是酸菜鱼。周末有优惠。门口可以停车。", maxPoints: 3 },
  },
  wecom: {
    sendRobotMessage: { title: "样例告警", content: "worker租约过期", mentionAll: true },
    sendAppMessage: {
      toUser: "sample-staff",
      title: "新工单",
      description: "有一张交付工单待处理",
    },
    createContactWay: { userId: "sample-manager", state: "store:sample" },
    verifyAndDecryptCallback: { query: {}, rawBody: "{}" },
    getKfLink: { scene: "order" },
    exchangeWebLoginCode: { code: "fake-web-login-code" },
  },
  esign: { seal: { pdf: new TextEncoder().encode("%PDF-sample") } },
  invoice: { issue: { requestNo: "FP-SAMPLE-0001", title: "样例餐饮店", amountFen: 19900 } },
  mail: { send: { to: "owner@example.invalid", subject: "电子发票", text: "发票见附件。" } },
};

/** 十二个接口的全部方法，一行一个，顺序照 PROVIDER_NAMES 与 PROVIDER_METHODS */
export const ALL_PROVIDER_METHODS: ReadonlyArray<{ provider: ProviderName; method: string }> =
  PROVIDER_NAMES.flatMap((provider) =>
    PROVIDER_METHODS[provider].map((method) => ({ provider, method })),
  );

/** 用样例入参调一个方法 */
export function callWithSample(
  providers: Providers,
  provider: ProviderName,
  method: string,
): Promise<ProviderResult<unknown>> {
  const target = providers[provider] as unknown as Record<
    string,
    ((input: unknown) => Promise<ProviderResult<unknown>>) | undefined
  >;
  const inputs: Record<string, unknown> = SAMPLE_PROVIDER_INPUTS[provider];
  const call = target[method];
  if (typeof call !== "function") throw new Error(`${provider} 没有方法 ${method}`);
  return call.call(target, inputs[method]);
}
