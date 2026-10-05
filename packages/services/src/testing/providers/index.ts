// 十二个测试替身，一接口一文件（ADR-039；D7 第 10.1 节）。经 @liyoxi/services/testing 导出。
//
// createFakeProviders() 一次给全十二个：共用一个时钟，生效状态都是 fake，每个方法的入口同样先过外呼前钩子。
// 每个替身都能：记录调用、注入失败与延迟（见 base.ts）；各自另有预置与编排的入口（见各文件开头）。
// 替身不连任何外部服务，不用任何密钥；假存储不依赖 MinIO。

import { guardProviderCall } from "../../kernel/index.js";
import { guardProviders, PROVIDER_NAMES } from "../../providers/types.js";
import type { BeforeProviderCall, Providers } from "../../providers/types.js";
import { createFakeAsr } from "./asr.js";
import type { FakeAsr } from "./asr.js";
import type { FakeClock } from "./base.js";
import { createFakeEsign } from "./esign.js";
import type { FakeEsign } from "./esign.js";
import { createFakeInvoice } from "./invoice.js";
import type { FakeInvoice } from "./invoice.js";
import { createFakeLlm } from "./llm.js";
import type { FakeLlm } from "./llm.js";
import { createFakeMail } from "./mail.js";
import type { FakeMail } from "./mail.js";
import { createFakeMedia } from "./media.js";
import type { FakeMedia } from "./media.js";
import { createFakeOcr } from "./ocr.js";
import type { FakeOcr } from "./ocr.js";
import { createFakeSms } from "./sms.js";
import type { FakeSms } from "./sms.js";
import { createFakeStorage } from "./storage.js";
import type { FakeStorage } from "./storage.js";
import { createFakeWechatPay } from "./wechat-pay.js";
import type { FakeWechatPay } from "./wechat-pay.js";
import { createFakeWechat } from "./wechat.js";
import type { FakeWechat } from "./wechat.js";
import { createFakeWecom } from "./wecom.js";
import type { FakeWecom } from "./wecom.js";

export * from "./asr.js";
export * from "./base.js";
export * from "./esign.js";
export * from "./invoice.js";
export * from "./llm.js";
export * from "./mail.js";
export * from "./media.js";
export * from "./ocr.js";
export * from "./samples.js";
export * from "./sms.js";
export * from "./storage.js";
export * from "./wechat-pay.js";
export * from "./wechat.js";
export * from "./wecom.js";

/** 十二个替身。它也是一份 Providers：少一个接口、或哪个替身少一个方法，编译失败 */
export interface FakeProviders extends Providers {
  wechat: FakeWechat;
  wechatPay: FakeWechatPay;
  sms: FakeSms;
  storage: FakeStorage;
  media: FakeMedia;
  ocr: FakeOcr;
  asr: FakeAsr;
  llm: FakeLlm;
  wecom: FakeWecom;
  esign: FakeEsign;
  invoice: FakeInvoice;
  mail: FakeMail;
}

export interface FakeProvidersOptions {
  /** 十二个替身共用的时钟；不给用系统时间 */
  clock?: FakeClock;
  /**
   * 外呼前钩子；缺省是 kernel 的 guardProviderCall（KF-1 改，原先空转）：在事务里调替身的方法即抛错，
   * 与真实装配一样。专门验别处的防线、要它空转时显式传 () => {}
   */
  beforeCall?: BeforeProviderCall;
}

export function createFakeProviders(options: FakeProvidersOptions = {}): FakeProviders {
  const { clock } = options;
  const fakes: FakeProviders = {
    wechat: createFakeWechat({ clock }),
    wechatPay: createFakeWechatPay({ clock }),
    sms: createFakeSms({ clock }),
    storage: createFakeStorage({ clock }),
    media: createFakeMedia({ clock }),
    ocr: createFakeOcr({ clock }),
    asr: createFakeAsr({ clock }),
    llm: createFakeLlm({ clock }),
    wecom: createFakeWecom({ clock }),
    esign: createFakeEsign({ clock }),
    invoice: createFakeInvoice({ clock }),
    mail: createFakeMail({ clock }),
  };
  return guardProviders(fakes, options.beforeCall ?? guardProviderCall);
}

/** 放行十二个替身里到点的延迟应答，返回一共放行了几个 */
export function tickFakes(fakes: FakeProviders): number {
  return PROVIDER_NAMES.reduce((released, name) => released + fakes[name].tick(), 0);
}
