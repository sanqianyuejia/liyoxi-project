// identity 的装配入口（W1-04）：把时钟、开事务的入口、状态迁移、事件、协议、主体、配置与微信能力绑上，
// 给出会话、登录、当前账号与商家鉴权链要的全部函数。api 启动时建一次（createFlow、createDocs、createTenant 之后）。
//
//   const identity = createIdentity({ tx, clock, flow, events, assembly, docs, tenant, config, keyring, wechat, appid });
//   await identity.phoneLogin(meta, input);            // 用例：外呼在前，自己开事务
//   await identity.authenticate(token, { ip });        // 鉴权中间件每请求调一次
//   await identity.pendingConsents(principal);         // 协议同意中间件
import type { MeView, PendingConsent, PhoneLoginResult, SilentLoginResult } from "@liyoxi/contract";
import { maskName } from "@liyoxi/shared/mask";

import { compareVersions, parseVersion } from "../config/index.js";
import type { Config, FlagContext } from "../config/index.js";
import type { ConsentSigner } from "../docs/index.js";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { createConsentGate } from "./consent-gate.js";
import type { ConsentGate } from "./consent-gate.js";
import { openidHmac, phoneLogin, silentLogin } from "./login.js";
import type { LoginDeps, PhoneLoginInput, PhoneLoginOptions, SilentLoginInput } from "./login.js";
import { logoutIn } from "./logout.js";
import { buildMeView } from "./me.js";
import { checkSession } from "./sessions.js";
import type { SessionCheck } from "./sessions.js";
import type { RequestMeta, SessionPrincipal } from "./types.js";

export interface IdentityDeps extends Omit<LoginDeps, "me" | "config"> {
  /** 配置读侧：参数 auth.dormant_days、开关 client.min_version */
  readonly config: Pick<Config, "params" | "flags">;
  /** 短信通道配没配（决定 MeUser.actions 里有没有换绑手机号）；不给即没配 */
  readonly smsConfigured?: () => boolean;
}

export interface Identity {
  // ---------- 用例函数：自己开事务 ----------
  /** m.session.create：不能静默登录时返回 needPhone，不区分原因、不写库 */
  silentLogin(meta: RequestMeta, input: SilentLoginInput): Promise<SilentLoginResult>;
  /** m.session.phoneLogin：首次登录建账号、记协议同意与来源 */
  phoneLogin(
    meta: RequestMeta,
    input: PhoneLoginInput,
    options?: PhoneLoginOptions,
  ): Promise<PhoneLoginResult>;
  /** m.session.current.delete */
  logout(principal: SessionPrincipal, meta: RequestMeta): Promise<void>;
  /** m.me.get：只读、现算 */
  me(merchantUserId: string): Promise<MeView>;

  // ---------- 商家鉴权链（中间件调） ----------
  /** 每请求校验会话令牌：按主键点查、不缓存；通过时按“同一天只写一次”续写 */
  authenticate(token: string, meta: { ip: string | null }): Promise<SessionCheck>;
  /** 本人待同意的用户级协议；空数组即放行。常态只比指纹，不查同意记录 */
  pendingConsents(
    principal: Pick<SessionPrincipal, "merchantUserId" | "consentStamp">,
  ): Promise<PendingConsent[]>;
  /** 客户端版本是不是低于最低版本（开关 client.min_version）。没带或写法不对的版本号按 0.0.0 算 */
  isClientOutdated(clientVersion: string | null, context?: FlagContext): Promise<boolean>;
  /** 协议同意的指纹缓存：用例里版本变了之后可以丢掉 */
  readonly consentGate: Pick<ConsentGate, "invalidate">;

  // ---------- 在调用方的事务里 ----------
  /** 当前会话的同意人快照：重新同意（m.agreementConsent.create）交给 docs.assertConsents 用 */
  consentSignerOf(tx: Tx, principal: SessionPrincipal): Promise<ConsentSigner>;
}

export function createIdentity(deps: IdentityDeps): Identity {
  const now = (): Date => deps.clock.now();
  const meDeps = {
    tenant: deps.tenant,
    docs: deps.docs,
    smsConfigured: deps.smsConfigured ?? (() => false),
  };
  const login: LoginDeps = { ...deps, me: meDeps };
  const gate = createConsentGate({ tx: deps.tx, clock: deps.clock, docs: deps.docs });

  return {
    silentLogin: (meta, input) => silentLogin(login, meta, input),
    phoneLogin: (meta, input, options) => phoneLogin(login, meta, input, options),
    logout: (principal, meta) => deps.tx.run((tx) => logoutIn(tx, now(), principal, meta)),
    me: (merchantUserId) => deps.tx.run((tx) => buildMeView(tx, meDeps, merchantUserId)),

    authenticate: (token, meta) => deps.tx.run((tx) => checkSession(tx, now(), token, meta)),
    pendingConsents: (principal) => gate.pending(principal),
    async isClientOutdated(clientVersion, context = {}) {
      const minimum = parseVersion(await deps.config.flags.minClientVersion(context));
      if (minimum === null) return false;
      return compareVersions(parseVersion(clientVersion) ?? [0, 0, 0], minimum) < 0;
    },
    consentGate: gate,

    async consentSignerOf(tx, principal) {
      const [user, identity, membership] = [
        await tx.merchantUser.findUnique({
          where: { id: principal.merchantUserId },
          select: { phoneEnc: true, phoneMask: true, displayName: true },
        }),
        await tx.wechatIdentity.findUnique({
          where: { id: principal.wechatIdentityId },
          select: { appid: true, openid: true },
        }),
        await deps.tenant.activeMembership(tx, principal.merchantUserId),
      ];
      if (user === null || user.phoneEnc === null || user.phoneMask === null) {
        throw new AppError("SESSION_INVALID");
      }
      const name = membership?.displayName ?? user.displayName;
      return {
        merchantUserId: principal.merchantUserId,
        phoneEnc: user.phoneEnc,
        phoneMask: user.phoneMask,
        operatorNameMask: name ? maskName(name) : null,
        role: membership?.role ?? null,
        appid: identity?.appid ?? null,
        openidHmac:
          identity === null ? null : openidHmac(deps.keyring(), identity.appid, identity.openid),
      };
    },
  };
}
