// 限流额度的初始值（W0-22b；约定 C68 的表“额度”一栏）。档位与名下的 operationId 在契约里登记
//（packages/contract/src/routes/rate-limits.ts）；这里只写每个档位按什么数、数多少。
// 额度是部署配置：现在是代码里的这张表，建应用时可以整张换（createApp 的 pipeline，见 rate-limit.ts）；
// 要按环境调时由环境包接成配置。少写一个档位，类型检查就过不了；运行时换进来的表缺档位，api 起不来。
//
// 不在这张表里的（约定 C68：涉及钱与安全状态的计数以数据库为准）：短信的号码限频与全站日上限、
// 后台登录的账号分桶锁定、匿名埋点的全站日总量、手机号登录的“每 openid 5 次 / 小时”
//（那条路由是公开的，openid 要到处理器里才换得出来，由登录的包自己数）。
import type { RateLimitTier } from "@liyoxi/contract";

export interface RateLimitRule {
  /**
   * 按什么计数：
   *   ip       客户端 IP（c.var.clientIp）
   *   user     操作人（商家用户、员工；下载页的请求算授权它的商家用户）。没登录的请求这条规则不适用
   *   session  会话：鉴权链给了会话标识用它，没给退到操作人。没登录的请求不适用
   *   param    路径参数（票据、支付单）
   */
  readonly by: "ip" | "user" | "session" | "param";
  /** by 是 param 时必填：路径参数名 */
  readonly param?: string;
  /** 只对匿名的请求生效（“每 IP …；登录后每用户 …”里的前一半）。只用于 ip */
  readonly anonymousOnly?: boolean;
  /** 只对这几条接口生效：一个档位里各接口额度不同的时候用。不写即档位名下全部 */
  readonly only?: readonly string[];
  /** 一个窗口里最多几次 */
  readonly limit: number;
  /** 窗口长度，秒 */
  readonly windowSec: number;
}

export type RateLimitQuotas = Readonly<Record<RateLimitTier, readonly RateLimitRule[]>>;

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export const RATE_LIMIT_QUOTAS: RateLimitQuotas = {
  "m.global": [
    { by: "ip", anonymousOnly: true, limit: 300, windowSec: MINUTE },
    { by: "user", limit: 600, windowSec: MINUTE },
  ],
  "m.login.silent": [{ by: "ip", limit: 30, windowSec: MINUTE }],
  "m.login.phone": [{ by: "ip", limit: 10, windowSec: HOUR }],
  "m.invitation": [
    { by: "ip", limit: 30, windowSec: MINUTE },
    { by: "user", limit: 10, windowSec: MINUTE },
  ],
  "m.sms": [{ by: "ip", limit: 20, windowSec: HOUR }],
  "m.analytics": [
    { by: "ip", anonymousOnly: true, limit: 60, windowSec: MINUTE },
    { by: "ip", anonymousOnly: true, limit: 300, windowSec: DAY },
    { by: "user", limit: 120, windowSec: MINUTE },
  ],
  "m.sign": [{ by: "user", limit: 600, windowSec: HOUR }],
  "m.subscribe": [{ by: "user", limit: 30, windowSec: DAY }],
  "m.payment_sync": [{ by: "param", param: "paymentOrderId", limit: 1, windowSec: 3 }],
  "admin.global": [{ by: "session", limit: 600, windowSec: MINUTE }],
  // 登录前的六条按 IP；会话内的三条（再验证、自助重新绑定）按会话，额度相同
  "admin.login": [
    { by: "ip", anonymousOnly: true, limit: 10, windowSec: MINUTE },
    { by: "session", limit: 10, windowSec: MINUTE },
  ],
  "admin.pii_reveal": [
    { by: "user", limit: 60, windowSec: HOUR },
    { by: "user", limit: 300, windowSec: DAY },
  ],
  // 两条测试发送合并计数：同一个档位、同一名员工用同一个计数键
  "admin.notify_test": [{ by: "user", limit: 5, windowSec: MINUTE }],
  "portal.global": [{ by: "session", limit: 300, windowSec: MINUTE }],
  "portal.ticket": [
    { by: "ip", limit: 10, windowSec: MINUTE, only: ["portal.portalTicket.create"] },
    {
      by: "param",
      param: "portalTicketId",
      limit: 60,
      windowSec: MINUTE,
      only: ["portal.portalTicket.get"],
    },
    // “每票据 5 次”：票据 5 分钟过期，窗口取 5 分钟即整个有效期
    {
      by: "param",
      param: "portalTicketId",
      limit: 5,
      windowSec: 5 * MINUTE,
      only: ["portal.portalTicket.exchange"],
    },
  ],
  "portal.verify": [
    { by: "ip", limit: 30, windowSec: MINUTE },
    { by: "ip", limit: 300, windowSec: HOUR },
  ],
  telemetry: [
    { by: "ip", anonymousOnly: true, limit: 10, windowSec: MINUTE },
    { by: "user", limit: 30, windowSec: MINUTE },
  ],
  // 约定只写“高上限保护、额度为部署配置”，没给数：先取每来源 IP 1200 次 / 分
  "hooks.ip": [{ by: "ip", limit: 1_200, windowSec: MINUTE }],
};

/**
 * 手机号登录的“每 openid 5 次 / 小时”（约定 C68；W1-04）：不是中间件里的规则。那条路由是公开的，openid 要换出来才知道，
 * 由登录的处理器在 code2Session 之后调限流器计数（routes/sessions.ts），计数键里放的是 openid 的 HMAC。
 */
export const PHONE_LOGIN_OPENID_QUOTA = { limit: 5, windowSec: HOUR } as const;
