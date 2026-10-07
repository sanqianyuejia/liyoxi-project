// 假企业微信：记下应用消息与“联系我”二维码；加好友回调用 encodeCallback 造、verifyAndDecryptCallback 解。
// 回调的格式是替身自己的（签名是摘要，不是真实的验签）。

import { createHash } from "node:crypto";

import { failed, ok } from "../../providers/types.js";
import type {
  ProviderMethodName,
  ProviderResult,
  WecomCallbackEvent,
  WecomProvider,
} from "../../providers/types.js";
import { createFakeCore, systemClock } from "./base.js";
import type { FakeClock, FakeControl } from "./base.js";

type Method = ProviderMethodName<WecomProvider>;

export interface FakeWecomMessage {
  toUser: string;
  title: string;
  description: string;
  url?: string;
}

export interface FakeContactWay {
  configId: string;
  qrCodeUrl: string;
  userId: string;
  state: string;
}

export interface FakeWecom extends WecomProvider, FakeControl<Method> {
  /** 发出去的应用消息 */
  readonly messages: FakeWecomMessage[];
  readonly robotMessages: Array<{ title: string; content: string; mentionAll: boolean }>;
  /** 生成过的“联系我”二维码 */
  readonly contactWays: FakeContactWay[];
  /** 把一个事件编成回调请求，交给被测的回调入口 */
  encodeCallback(event: WecomCallbackEvent): { query: Record<string, string>; rawBody: string };
}

function signatureOf(timestamp: string, nonce: string, rawBody: string): string {
  return createHash("sha256")
    .update(`fake-wecom\n${timestamp}\n${nonce}\n${rawBody}\n`)
    .digest("hex");
}

export function createFakeWecom(options: { clock?: FakeClock } = {}): FakeWecom {
  const clock = options.clock ?? systemClock;
  const core = createFakeCore<Method>(clock);
  const messages: FakeWecomMessage[] = [];
  const robotMessages: Array<{ title: string; content: string; mentionAll: boolean }> = [];
  const contactWays: FakeContactWay[] = [];
  let nonceSeq = 0;

  return {
    status: "fake",
    configured: true,
    ...core.control,
    messages,
    robotMessages,
    contactWays,
    encodeCallback(event) {
      const rawBody = JSON.stringify(event);
      const timestamp = String(Math.floor(clock.now().getTime() / 1000));
      const nonce = `fake-nonce-${(nonceSeq += 1)}`;
      return {
        rawBody,
        query: { timestamp, nonce, msg_signature: signatureOf(timestamp, nonce, rawBody) },
      };
    },

    sendRobotMessage: (input) =>
      core.run("sendRobotMessage", input, () => {
        robotMessages.push({ ...input });
        return ok(undefined);
      }),
    sendAppMessage: (input) =>
      core.run("sendAppMessage", input, () => {
        messages.push({ ...input });
        return ok(undefined);
      }),
    createContactWay: (input) =>
      core.run("createContactWay", input, () => {
        const configId = `fake-contact-way-${contactWays.length + 1}`;
        const way = { configId, qrCodeUrl: `https://fake-wecom.invalid/qr/${configId}`, ...input };
        contactWays.push(way);
        return ok({ configId: way.configId, qrCodeUrl: way.qrCodeUrl });
      }),
    verifyAndDecryptCallback: (input) =>
      core.run("verifyAndDecryptCallback", input, (): ProviderResult<WecomCallbackEvent> => {
        const { timestamp = "", nonce = "", msg_signature: signature } = input.query;
        if (signature !== signatureOf(timestamp, nonce, input.rawBody)) {
          return failed("rejected", "验签失败");
        }
        return ok(JSON.parse(input.rawBody) as WecomCallbackEvent);
      }),
    getKfLink: (input) =>
      core.run("getKfLink", input, () =>
        ok({ url: `https://fake-wecom.invalid/kf?scene=${encodeURIComponent(input.scene ?? "")}` }),
      ),
  };
}
