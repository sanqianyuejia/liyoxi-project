// Provider 接口：12 个外部能力（01 第 9 节；ADR-039）。领域模块只引本文件（D7 第 2.2 节 D8）。
//
// 写法上的约定（W0-19 任务书 第 11 节第 1、3、5 项）：
//   1. 方法按 01 第 9 节“用途”列一项一个，入参出参取能确定的最小集。后续使用方只增方法或可选字段；
//      改已有签名要在 PR 描述里单列。
//   2. 每个方法都返回 Promise<ProviderResult<T>>。没办成不抛错，返回 { ok: false, reason }：
//      调用方看 reason 分支来降级，不靠捕获异常（01 第 2.2 节 P5）。只有程序错误才抛，比如在事务里外呼。
//   3. 每个接口带 status（生效状态）与 configured（这项能力现在能不能用）。
//   4. 金额一律整数分，字段名以 Fen 结尾。
//   5. 加方法时三处一起改，少一处即编译失败：接口、PROVIDER_METHODS、未配置实现与替身。
// 本文件不引任何别的文件。

// ---------- 通用 ----------

/** Provider 运行在哪个环境。取值与 kernel 的 AppEnv 相同；这里另写一份，免得 providers 与 kernel 互引成环 */
export const PROVIDER_APP_ENVS = ["local", "test", "stg", "prod"] as const;
export type ProviderAppEnv = (typeof PROVIDER_APP_ENVS)[number];

/** 没办成的原因 */
export type ProviderFailureReason =
  /** 这项能力没配置 */
  | "unconfigured"
  /** 当前驱动没有这个方法的能力（如本地 MinIO 不签发临时密钥） */
  | "unsupported"
  /** 外部服务连不上、超时或报 5xx：可以重试 */
  | "unavailable"
  /** 外部服务明确拒绝，或入参不合规：重试也不会成 */
  | "rejected";

export interface ProviderSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ProviderFailure {
  readonly ok: false;
  readonly reason: ProviderFailureReason;
  /** 给日志与排障看的一句话；不含任何配置值 */
  readonly message: string;
}

export type ProviderResult<T> = ProviderSuccess<T> | ProviderFailure;

export function ok<T>(value: T): ProviderSuccess<T> {
  return { ok: true, value };
}

export function failed(reason: ProviderFailureReason, message: string): ProviderFailure {
  return { ok: false, reason, message };
}

/**
 * 生效状态：真实驱动名，或下面三个固定值（任务书 第 11 节第 5 项）。
 *   local         只限 local、test 的落点：本地 MinIO、控制台短信、本地的假微信、媒体的小文件通道
 *   fake          测试替身，只在测试装配里出现
 *   unconfigured  未配置实现
 */
export type ProviderStatus = "local" | "fake" | "unconfigured" | (string & {});

export interface ProviderBase {
  readonly status: ProviderStatus;
  /** 这项能力现在能不能用。业务据此决定入口展不展示（如微信支付），不靠调用失败来试 */
  readonly configured: boolean;
}

/** 启动日志用的最小日志接口；pino 的 logger 可以直接传进来 */
export interface ProviderLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/** 内容安全与审核的结论。pending：结果稍后经回调或回查给出 */
export type ContentVerdict = "pass" | "review" | "block" | "pending";

// ---------- wechat：登录、手机号、订阅消息、小程序码、图片与文本内容安全 ----------

export interface WechatSession {
  openid: string;
  unionid?: string;
}

/** 文本内容安全的场景：资料、评论、论坛、社交日志 */
export type WechatTextScene = "profile" | "comment" | "forum" | "social";

export interface ContentCheckOutcome {
  verdict: ContentVerdict;
  /** 外部侧的追踪号；verdict 为 pending 时靠它对上回调 */
  traceId?: string;
}

export interface WechatProvider extends ProviderBase {
  /** 登录：用小程序端 wx.login 给的 code 换 openid */
  code2Session(input: { code: string }): Promise<ProviderResult<WechatSession>>;
  /** 手机号：用手机号组件给的 code 换手机号 */
  getPhoneNumber(input: { code: string }): Promise<ProviderResult<{ phone: string }>>;
  /** 订阅消息 */
  sendSubscribeMessage(input: {
    openid: string;
    templateId: string;
    page?: string;
    data: Record<string, string>;
  }): Promise<ProviderResult<void>>;
  /** 小程序码 */
  createMiniProgramCode(input: {
    scene: string;
    page?: string;
  }): Promise<ProviderResult<{ image: Uint8Array; contentType: string }>>;
  /** 文本内容安全 */
  checkText(input: {
    openid: string;
    scene: WechatTextScene;
    content: string;
  }): Promise<ProviderResult<ContentCheckOutcome>>;
  /** 图片内容安全 */
  checkImage(input: {
    openid: string;
    scene: WechatTextScene;
    mediaUrl: string;
  }): Promise<ProviderResult<ContentCheckOutcome>>;
}

// ---------- wechatPay：预下单、回调验签、查单、关单、退款、账单 ----------

export type WechatPayTradeState =
  "SUCCESS" | "REFUND" | "NOTPAY" | "CLOSED" | "REVOKED" | "USERPAYING" | "PAYERROR";

export type WechatPayRefundStatus = "SUCCESS" | "CLOSED" | "PROCESSING" | "ABNORMAL";

export interface WechatPayTransaction {
  outTradeNo: string;
  tradeState: WechatPayTradeState;
  transactionId?: string;
  amountFen?: number;
  payerOpenid?: string;
  /** 预下单时带的回传数据，原样返回 */
  attach?: string;
  successAt?: Date;
}

export interface WechatPayRefund {
  outRefundNo: string;
  outTradeNo: string;
  refundId: string;
  status: WechatPayRefundStatus;
  refundFen: number;
}

/** 验签并解密之后的回调内容。id 是通知编号，同一条通知重复投递时不变 */
export type WechatPayNotification =
  | { kind: "transaction"; id: string; transaction: WechatPayTransaction }
  | { kind: "refund"; id: string; refund: WechatPayRefund };

export interface WechatPayProvider extends ProviderBase {
  /** 预下单。幂等于商户单号：同一单号、同样的入参重复调用返回同一个结果 */
  createJsapiOrder(input: {
    outTradeNo: string;
    description: string;
    amountFen: number;
    payerOpenid: string;
    attach?: string;
    expireAt?: Date;
  }): Promise<ProviderResult<{ prepayId: string }>>;
  /** 回调验签并解密。验签不过返回 rejected，调用方须应答失败 */
  verifyAndDecryptNotification(input: {
    headers: Record<string, string>;
    rawBody: string;
  }): Promise<ProviderResult<WechatPayNotification>>;
  /** 查单 */
  queryByOutTradeNo(input: { outTradeNo: string }): Promise<ProviderResult<WechatPayTransaction>>;
  /** 关单。已关返回 closed；已支付返回 paid；该重试的返回 unavailable */
  closeOrder(input: {
    outTradeNo: string;
  }): Promise<ProviderResult<{ outcome: "closed" | "paid" }>>;
  /** 退款。幂等于退款单号 */
  createRefund(input: {
    outTradeNo: string;
    outRefundNo: string;
    refundFen: number;
    totalFen: number;
    reason?: string;
  }): Promise<ProviderResult<WechatPayRefund>>;
  /** 账单：申请并取回某一天的交易账单原文。billDate 写 YYYY-MM-DD（北京时间） */
  fetchTradeBill(input: {
    billDate: string;
  }): Promise<ProviderResult<{ billDate: string; text: string }>>;
}

// ---------- storage：签名、临时密钥、复制入库 ----------

/** 四个桶（03 第 5.1 节） */
export const STORAGE_BUCKETS = ["secure", "asset", "media", "pub"] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

/** 写入区的键前缀：直传只能落在这里，入库时条件复制到正式区（03 第 5.2 节） */
export const INCOMING_PREFIX = "incoming/";

export interface ObjectRef {
  bucket: StorageBucket;
  key: string;
}

/** 备份目标由部署显式配置，不属于四个业务桶，也不向客户端签名。 */
export interface BackupObjectRef {
  bucket: string;
  key: string;
}

export interface PresignedPost {
  url: string;
  /** 表单字段，原样放进 multipart 表单；文件字段名是 file，放最后 */
  fields: Record<string, string>;
  key: string;
  expiresAt: Date;
}

export interface StsCredential {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: Date;
}

export interface ObjectHead {
  exists: boolean;
  size: number;
  mime?: string;
  etag?: string;
}

export interface StorageProvider extends ProviderBase {
  /** sts：能不能签发临时密钥（大文件分块上传要用）；versioning：桶有没有开版本控制 */
  readonly capabilities: { readonly sts: boolean; readonly versioning: boolean };
  /** 已加密的备份流；最多 maxBytes，取消或流错误必须中止未完成上传。 */
  backupPutStream(
    input: BackupObjectRef & {
      body: AsyncIterable<Uint8Array>;
      maxBytes: number;
      signal: AbortSignal;
    },
  ): Promise<ProviderResult<{ etag: string; size: number }>>;
  backupHead(input: BackupObjectRef): Promise<ProviderResult<ObjectHead>>;
  /** 同一备份目标内按 etag 条件复制到 monthly 前缀。 */
  backupCopy(input: {
    src: BackupObjectRef;
    dst: BackupObjectRef;
    ifMatchEtag: string;
  }): Promise<ProviderResult<{ etag: string }>>;
  /** 签名（写）：≤20MB 的预签名表单，直传到写入区。key 不以 incoming/ 开头即 rejected */
  presignPost(input: {
    bucket: StorageBucket;
    key: string;
    mime: string;
    maxBytes: number;
    expiresSec: number;
  }): Promise<ProviderResult<PresignedPost>>;
  /** 临时密钥：限定到一个键前缀。驱动没有这个能力时返回 unsupported */
  issueSts(input: {
    bucket: StorageBucket;
    keyPrefix: string;
    durationSec: number;
  }): Promise<ProviderResult<StsCredential>>;
  /** 读对象头。对象不存在不算失败：返回 exists 为 false */
  head(input: ObjectRef): Promise<ProviderResult<ObjectHead>>;
  /** 有界读取文件头；confirm 只需前 4KB，可绑定对象 etag。 */
  readPrefix(
    input: ObjectRef & { bytes: number; ifMatchEtag?: string },
  ): Promise<ProviderResult<Uint8Array>>;
  /** 系统文件写入正式区；只供服务端种子与系统生成文件，禁止端侧使用。 */
  putObject(
    input: ObjectRef & {
      body: Uint8Array;
      contentType: string;
      contentDisposition?: string;
      ifAbsent?: boolean;
      contentIdentity?: string;
    },
  ): Promise<ProviderResult<{ etag: string; size: number }>>;
  /** 复制入库：源对象的 etag 与 ifMatchEtag 相同才复制，并改写内容类型；不同返回 rejected */
  copy(input: {
    src: ObjectRef;
    dst: ObjectRef;
    ifMatchEtag: string;
    contentType: string;
    contentDisposition?: string;
  }): Promise<ProviderResult<{ etag: string }>>;
  /** 签名（读）：签发有时限的读地址 */
  presignGet(input: {
    bucket: StorageBucket;
    key: string;
    expiresSec: number;
    /** 给了就按附件下载，并用这个文件名 */
    downloadName?: string;
    /** 显式覆盖响应的 Content-Disposition；不传保持旧行为。 */
    disposition?: "inline" | "attachment";
  }): Promise<ProviderResult<{ url: string; expiresAt: Date }>>;
  /** 删除。对象本来就不存在也算成功 */
  delete(input: ObjectRef): Promise<ProviderResult<void>>;
}

// ---------- media：体检、转码、打包、视频审核（M0 只有方法位，任务书 第 11 节第 7 项） ----------

export interface MediaProbeReport {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface MediaJob {
  jobId: string;
  state: "submitted" | "done";
  /** false：走的是本地小文件通道，直接算完成，没有真正处理 */
  processed: boolean;
}

export interface MediaProvider extends ProviderBase {
  /** 体检：分辨率、时长、编码、音轨。没有真正体检时 report 为 null */
  probe(input: {
    src: ObjectRef;
  }): Promise<ProviderResult<{ processed: boolean; report: MediaProbeReport | null }>>;
  /** 转码 */
  transcode(input: {
    src: ObjectRef;
    dst: ObjectRef;
    template: string;
    userData: string;
  }): Promise<ProviderResult<MediaJob>>;
  /** 打包：把同一个桶里的几个对象打成一个压缩包 */
  pack(input: {
    bucket: StorageBucket;
    items: Array<{ key: string; name: string }>;
    dstKey: string;
    userData: string;
  }): Promise<ProviderResult<MediaJob>>;
  /** 视频审核 */
  audit(input: {
    src: ObjectRef;
    scenes: string[];
    userData: string;
  }): Promise<ProviderResult<{ verdict: ContentVerdict; processed: boolean; jobId?: string }>>;
}

// ---------- sms：员工激活码、订阅消息的补发、值班告警 ----------

export interface SmsProvider extends ProviderBase {
  /** 员工激活码 */
  sendActivationCode(input: { phone: string; code: string }): Promise<ProviderResult<void>>;
  /** 订阅消息的补发：订阅消息发不出去时改发短信 */
  sendSubscribeFallback(input: {
    phone: string;
    templateKey: string;
    params: Record<string, string>;
  }): Promise<ProviderResult<void>>;
  /** 值班告警 */
  sendOncallAlert(input: {
    phones: string[];
    title: string;
    content: string;
  }): Promise<ProviderResult<void>>;
}

// ---------- ocr：营业执照识别、行业许可证字段抽取 ----------

export interface BusinessLicenseFields {
  name: string;
  /** 统一社会信用代码 */
  uscc: string;
  /** 法定代表人、经营者或负责人 */
  principal: string;
  address?: string;
  /** 营业期限止：YYYY-MM-DD，或 long_term */
  validTo?: string;
  /** 翻拍、复印件之类的告警 */
  warnings: string[];
}

export interface OcrProvider extends ProviderBase {
  /** 营业执照识别 */
  recognizeBusinessLicense(input: {
    imageUrl: string;
  }): Promise<ProviderResult<BusinessLicenseFields>>;
  /** 行业许可证字段抽取 */
  extractLicenseFields(input: {
    fileUrl: string;
    fieldNames: string[];
  }): Promise<ProviderResult<{ fields: Record<string, string> }>>;
}

// ---------- asr：录音转写 ----------

export interface AsrProvider extends ProviderBase {
  /** 录音转写 */
  transcribe(input: {
    url: string;
  }): Promise<ProviderResult<{ text: string; durationSec?: number }>>;
}

// ---------- llm：素材识别打标、要点提炼 ----------

export type LlmAssetKind = "image" | "video" | "audio" | "document";

export interface LlmProvider extends ProviderBase {
  /** 素材识别打标。图片与视频给 url；录音与文档给转写或抽出的 text */
  tagAsset(input: {
    kind: LlmAssetKind;
    url?: string;
    text?: string;
  }): Promise<ProviderResult<{ description: string; tags: string[] }>>;
  /** 要点提炼 */
  extractKeyPoints(input: {
    text: string;
    maxPoints?: number;
  }): Promise<ProviderResult<{ points: string[] }>>;
}

// ---------- wecom：员工通知、“联系我”二维码与加好友回调、微信客服 ----------

export type WecomCallbackEvent =
  /** 商家加了服务经理的好友。state 是生成“联系我”二维码时带的自定义参数 */
  | { kind: "contact_added"; userId: string; externalUserId: string; state?: string }
  | { kind: "other"; eventType: string };

export interface WecomProvider extends ProviderBase {
  /** 告警群机器人；未配置时明确失败，不借自建应用消息冒充群消息。 */
  sendRobotMessage(input: {
    title: string;
    content: string;
    mentionAll: boolean;
  }): Promise<ProviderResult<void>>;
  /** 员工通知：自建应用消息 */
  sendAppMessage(input: {
    toUser: string;
    title: string;
    description: string;
    url?: string;
  }): Promise<ProviderResult<void>>;
  /** “联系我”二维码 */
  createContactWay(input: {
    userId: string;
    state: string;
  }): Promise<ProviderResult<{ configId: string; qrCodeUrl: string }>>;
  /** 加好友回调：验签并解密 */
  verifyAndDecryptCallback(input: {
    query: Record<string, string>;
    rawBody: string;
  }): Promise<ProviderResult<WecomCallbackEvent>>;
  /** 微信客服：取在线客服的接待链接 */
  getKfLink(input: { scene?: string }): Promise<ProviderResult<{ url: string }>>;
}

// ---------- esign：授权书数字签名 ----------

export interface EsignProvider extends ProviderBase {
  /**
   * 授权书签署。mode 为 certificate 时带数字签名；为 stamp 时是图片章：章在文书渲染时已经盖上，
   * 这里不加数字签名，原样返回。stg、prod 下图片章须显式开关（ADR-039 的例外）。
   */
  seal(input: { pdf: Uint8Array }): Promise<
    ProviderResult<{
      pdf: Uint8Array;
      mode: "certificate" | "stamp";
      certSerial?: string;
      signedAt?: Date;
    }>
  >;
}

// ---------- invoice：自动开票（V1.1+，现在只留接口与未配置实现） ----------

export interface InvoiceProvider extends ProviderBase {
  /** 自动开票 */
  issue(input: {
    requestNo: string;
    title: string;
    taxNo?: string;
    amountFen: number;
  }): Promise<ProviderResult<{ invoiceNo: string }>>;
}

// ---------- mail：电子发票发送 ----------

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface MailProvider extends ProviderBase {
  /** 发一封邮件。V1.0 只用来发电子发票 */
  send(input: {
    to: string;
    subject: string;
    text: string;
    attachments?: MailAttachment[];
  }): Promise<ProviderResult<{ messageId: string }>>;
}

// ---------- 十二个接口的汇总 ----------

export interface Providers {
  wechat: WechatProvider;
  wechatPay: WechatPayProvider;
  sms: SmsProvider;
  storage: StorageProvider;
  media: MediaProvider;
  ocr: OcrProvider;
  asr: AsrProvider;
  llm: LlmProvider;
  wecom: WecomProvider;
  esign: EsignProvider;
  invoice: InvoiceProvider;
  mail: MailProvider;
}

export type ProviderName = keyof Providers;

/** 十二个接口的名字，顺序照 ADR-039。状态打印按这个顺序出 */
export const PROVIDER_NAMES = [
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
] as const satisfies readonly ProviderName[];

/** 一个接口里的方法名：值是函数的键 */
export type ProviderMethodName<P> = {
  [K in keyof P]-?: P[K] extends (...args: never[]) => unknown ? K : never;
}[keyof P] &
  string;

/**
 * 每个接口的方法清单。外呼前钩子的包装、未配置实现与替身的用例都照它逐个方法走。
 * 清单里写了接口没有的名字，下面的 satisfies 报错；接口加了方法而这里没列，再下面的断言报错。
 */
export const PROVIDER_METHODS = {
  wechat: [
    "code2Session",
    "getPhoneNumber",
    "sendSubscribeMessage",
    "createMiniProgramCode",
    "checkText",
    "checkImage",
  ],
  wechatPay: [
    "createJsapiOrder",
    "verifyAndDecryptNotification",
    "queryByOutTradeNo",
    "closeOrder",
    "createRefund",
    "fetchTradeBill",
  ],
  sms: ["sendActivationCode", "sendSubscribeFallback", "sendOncallAlert"],
  storage: [
    "backupPutStream",
    "backupHead",
    "backupCopy",
    "presignPost",
    "issueSts",
    "head",
    "readPrefix",
    "putObject",
    "copy",
    "presignGet",
    "delete",
  ],
  media: ["probe", "transcode", "pack", "audit"],
  ocr: ["recognizeBusinessLicense", "extractLicenseFields"],
  asr: ["transcribe"],
  llm: ["tagAsset", "extractKeyPoints"],
  wecom: [
    "sendAppMessage",
    "createContactWay",
    "verifyAndDecryptCallback",
    "getKfLink",
    "sendRobotMessage",
  ],
  esign: ["seal"],
  invoice: ["issue"],
  mail: ["send"],
} as const satisfies { readonly [K in ProviderName]: readonly ProviderMethodName<Providers[K]>[] };

type Assert<T extends true> = T;

/** 编译期断言：PROVIDER_NAMES 列全了十二个接口 */
export type ProviderNamesAreComplete = Assert<
  [Exclude<ProviderName, (typeof PROVIDER_NAMES)[number]>] extends [never] ? true : false
>;

/** 编译期断言：PROVIDER_METHODS 列全了每个接口的方法 */
export type ProviderMethodsAreComplete = Assert<
  {
    [K in ProviderName]: [
      Exclude<ProviderMethodName<Providers[K]>, (typeof PROVIDER_METHODS)[K][number]>,
    ] extends [never]
      ? true
      : false;
  }[ProviderName]
>;

// ---------- 外呼前钩子（任务书 第 11 节第 3 项；D7 第 2.3 节规则 5） ----------

export interface ProviderCall {
  provider: ProviderName;
  method: string;
}

/**
 * 每个 Provider 方法的入口先调它一次。缺省空转；接上 kernel 的事务标记之后，在事务里外呼会在这里抛错。
 * 它抛的错不归入 ProviderResult，原样抛给调用方：那是程序错误，不是外部服务没办成。
 */
export type BeforeProviderCall = (call: ProviderCall) => void;

/**
 * 给一个 Provider 包上外呼前钩子：清单里的每个方法，进入时先调一次钩子，再调原实现。
 * 其余的属性（status、configured、替身的编排入口）原样透传，读写都落在原对象上。
 */
export function withBeforeCall<K extends ProviderName, P extends Providers[K]>(
  name: K,
  provider: P,
  beforeCall: BeforeProviderCall,
): P {
  const methods: ReadonlySet<string> = new Set(PROVIDER_METHODS[name]);
  return new Proxy(provider, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof property !== "string" || !methods.has(property) || typeof value !== "function") {
        return value;
      }
      return async (...args: unknown[]): Promise<unknown> => {
        beforeCall({ provider: name, method: property });
        return Reflect.apply(value, target, args);
      };
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

/** 给十二个接口都包上外呼前钩子。传进来的可以是替身的集合：返回值的类型不变 */
export function guardProviders<T extends Providers>(
  providers: T,
  beforeCall: BeforeProviderCall,
): T {
  const guarded = { ...providers };
  // 同一个对象的另一个名字：按接口名逐个换成包好的
  const slots: Record<ProviderName, unknown> = guarded;
  for (const name of PROVIDER_NAMES) {
    slots[name] = withBeforeCall(name, providers[name], beforeCall);
  }
  return guarded;
}
