// 未配置实现：逐接口照 01 第 9 节“未配置时”一列（ADR-039；01 第 2.2 节 P5：未配置不崩溃）。
//
// 两类：
//   1. unconfigured*：调用即返回 { ok: false, reason: "unconfigured" }，不抛错、不外呼。调用方看 reason 降级。
//   2. 只限 local、test 的落点：本地的假微信、媒体的小文件通道；以及 esign 的图片章（stg、prod 须显式开关）。
//      storage 与 sms 的本地落点是驱动（storage/minio.ts、sms/console.ts），不在这里。
// 哪个环境用哪一个，由 index.ts 的工厂定。

import { failed, ok } from "./types.js";
import type {
  AsrProvider,
  EsignProvider,
  InvoiceProvider,
  LlmProvider,
  MailProvider,
  MediaProvider,
  OcrProvider,
  ProviderFailure,
  ProviderLogger,
  Providers,
  SmsProvider,
  StorageProvider,
  WechatPayProvider,
  WechatProvider,
  WecomProvider,
} from "./types.js";

const BASE = { status: "unconfigured", configured: false } as const;

/** 调用即返回“未配置”；what 写能力的名字，degrade 写调用方该怎么降级（给日志与排障看） */
function unconfigured(what: string, degrade: string): () => Promise<ProviderFailure> {
  const failure = failed("unconfigured", `${what}未配置：${degrade}`);
  return () => Promise.resolve(failure);
}

// ---------- wechat：本地用假实现 ----------

const wechatOff = unconfigured("微信小程序", "只有 local、test 有本地的假实现");

export const unconfiguredWechat: WechatProvider = {
  ...BASE,
  code2Session: wechatOff,
  getPhoneNumber: wechatOff,
  sendSubscribeMessage: wechatOff,
  createMiniProgramCode: wechatOff,
  checkText: wechatOff,
  checkImage: wechatOff,
};

/** 手机号组件给的 code 不是手机号时，本地的假微信回这个号 */
export const LOCAL_WECHAT_PHONE = "13800138000";

/** 一个像素的透明 PNG：本地的假微信拿它当小程序码 */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * 本地的假微信：不连微信，只限 local、test。
 *   登录     openid 由 code 直接推出（同一个 code 得到同一个 openid），演示脚本可以用固定的 code 固定身份
 *   手机号   code 本身是 11 位手机号就用它，否则回 LOCAL_WECHAT_PHONE
 *   订阅消息 只记一行日志，不真发
 *   小程序码 一个像素的占位图
 *   内容安全 一律放行
 */
export function createLocalWechat(deps: { logger: ProviderLogger }): WechatProvider {
  return {
    status: "local",
    configured: true,
    async code2Session({ code }) {
      if (code.trim() === "") return failed("rejected", "code 是空的");
      return ok({ openid: `local-openid-${code}` });
    },
    async getPhoneNumber({ code }) {
      return ok({ phone: /^1\d{10}$/.test(code) ? code : LOCAL_WECHAT_PHONE });
    },
    async sendSubscribeMessage({ openid, templateId, page }) {
      deps.logger.info(
        { provider: "wechat", openid, templateId, page },
        "[wechat:local] 订阅消息（没有真发）",
      );
      return ok(undefined);
    },
    async createMiniProgramCode() {
      return ok({ image: new Uint8Array(PLACEHOLDER_PNG), contentType: "image/png" });
    },
    async checkText() {
      return ok({ verdict: "pass" });
    },
    async checkImage() {
      return ok({ verdict: "pass" });
    },
  };
}

// ---------- wechatPay：只剩对公转账 ----------

const wechatPayOff = unconfigured("微信支付", "只剩对公转账");

export const unconfiguredWechatPay: WechatPayProvider = {
  ...BASE,
  createJsapiOrder: wechatPayOff,
  verifyAndDecryptNotification: wechatPayOff,
  queryByOutTradeNo: wechatPayOff,
  closeOrder: wechatPayOff,
  createRefund: wechatPayOff,
  fetchTradeBill: wechatPayOff,
};

// ---------- sms：本地是控制台输出（sms/console.ts）；这里是连控制台都不许用时的实现 ----------

const smsOff = unconfigured("短信", "提醒只剩站内与订阅消息");

export const unconfiguredSms: SmsProvider = {
  ...BASE,
  sendActivationCode: smsOff,
  sendSubscribeFallback: smsOff,
  sendOncallAlert: smsOff,
};

// ---------- storage / media：本地用 MinIO 走小文件通道 ----------

const storageOff = unconfigured("对象存储", "只有 local、test 有本地 MinIO");

export const unconfiguredStorage: StorageProvider = {
  ...BASE,
  capabilities: { sts: false, versioning: false },
  backupPutStream: storageOff,
  backupHead: storageOff,
  backupCopy: storageOff,
  presignPost: storageOff,
  issueSts: storageOff,
  head: storageOff,
  readPrefix: storageOff,
  putObject: storageOff,
  copy: storageOff,
  presignGet: storageOff,
  delete: storageOff,
};

const mediaOff = unconfigured("媒体处理", "只有 local、test 有小文件通道");

export const unconfiguredMedia: MediaProvider = {
  ...BASE,
  probe: mediaOff,
  transcode: mediaOff,
  pack: mediaOff,
  audit: mediaOff,
};

/**
 * 媒体的本地小文件通道：不体检、不转码、不打包、不审核，直接返回完成（processed 为 false）。只限 local、test。
 * 任务号由 userData 直接推出，同一个 userData 得到同一个任务号。
 */
export function createLocalMedia(): MediaProvider {
  return {
    status: "local",
    configured: true,
    async probe() {
      return ok({ processed: false, report: null });
    },
    async transcode({ userData }) {
      return ok({ jobId: `local-transcode-${userData}`, state: "done", processed: false });
    },
    async pack({ userData }) {
      return ok({ jobId: `local-pack-${userData}`, state: "done", processed: false });
    },
    async audit() {
      return ok({ verdict: "pass", processed: false });
    },
  };
}

// ---------- 可降级的五个：ocr、asr、llm、wecom、mail ----------

const ocrOff = unconfigured("证照识别", "商家手填、审核人手工核对");

export const unconfiguredOcr: OcrProvider = {
  ...BASE,
  recognizeBusinessLicense: ocrOff,
  extractLicenseFields: ocrOff,
};

export const unconfiguredAsr: AsrProvider = {
  ...BASE,
  transcribe: unconfigured("录音转写", "不转写"),
};

const llmOff = unconfigured("素材理解", "不打标");

export const unconfiguredLlm: LlmProvider = {
  ...BASE,
  tagAsset: llmOff,
  extractKeyPoints: llmOff,
};

export const unconfiguredWecom: WecomProvider = {
  ...BASE,
  sendRobotMessage: unconfigured("企业微信群机器人", "告警群通知未到达"),
  sendAppMessage: unconfigured("企业微信", "员工只收站内待办"),
  createContactWay: unconfigured("企业微信", "服务经理二维码人工上传"),
  verifyAndDecryptCallback: unconfigured("企业微信", "没有加好友回调，商家与服务经理人工绑定"),
  getKfLink: unconfigured("企业微信", "在线客服退回小程序原生客服消息"),
};

export const unconfiguredMail: MailProvider = {
  ...BASE,
  send: unconfigured("邮件", "电子发票只在小程序内下载"),
};

// ---------- esign：图片章（生产须显式开关） ----------

/** stg、prod 下没配电子签、也没打开图片章开关：签署返回“未配置”，不静默降级（ADR-039 的例外） */
export const unconfiguredEsign: EsignProvider = {
  ...BASE,
  seal: unconfigured("电子签", "图片章开关没有打开，不出件"),
};

/**
 * 图片章：章在文书渲染时已经盖上，这里不加数字签名，原样返回，mode 为 stamp。
 * local、test 下没配电子签即用它；stg、prod 下只有显式打开开关才用它。
 */
export function createStampEsign(): EsignProvider {
  return {
    status: "stamp",
    configured: true,
    async seal({ pdf }) {
      return ok({ pdf, mode: "stamp" });
    },
  };
}

// ---------- invoice：财务线下开具后上传 ----------

export const unconfiguredInvoice: InvoiceProvider = {
  ...BASE,
  issue: unconfigured("自动开票", "财务线下开具后上传"),
};

// ---------- 汇总 ----------

/** 十二个接口全都“未配置”的一套：stg、prod 下什么都没配时就是它（esign 的图片章开关另算） */
export const unconfiguredProviders: Providers = {
  wechat: unconfiguredWechat,
  wechatPay: unconfiguredWechatPay,
  sms: unconfiguredSms,
  storage: unconfiguredStorage,
  media: unconfiguredMedia,
  ocr: unconfiguredOcr,
  asr: unconfiguredAsr,
  llm: unconfiguredLlm,
  wecom: unconfiguredWecom,
  esign: unconfiguredEsign,
  invoice: unconfiguredInvoice,
  mail: unconfiguredMail,
};
