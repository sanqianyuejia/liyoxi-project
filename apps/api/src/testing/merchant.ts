// 商家端接口用例的登录态（W1-04）：走真实的手机号登录（假微信），拿到令牌与请求头。各域的商家端接口包照这个写：
//
//   const testApi = useTestApi();
//   const api = await testApi.start();
//   await seedUserAgreements(testApi, api);                 // 一个测试库一次：协议清单的种子与两份用户级协议的当前版本
//   const owner = await signInAsMerchant(api);              // 新账号；要老板身份再调 m.entity.create 或用工厂造成员关系
//   await api.request("/api/v1/m/me", { headers: owner.headers });
//   await api.request("/api/v1/m/…", { headers: owner.withStore(storeId) });
//
// 每次登录换一个来源 IP：登录档位按 IP 限流（每 IP 10 次 / 小时），一份用例里登录多少个账号都不挤占额度。
// 只给测试用，不进构建产物。
import { runSeed, SEED_MODULES } from "@liyoxi/services";
import { createFactories } from "@liyoxi/services/testing";

import type { TestApi, TestApiHandle } from "./index.js";

export interface SignedInMerchant {
  readonly token: string;
  readonly merchantUserId: string;
  readonly phone: string;
  readonly openid: string;
  /** 手机号登录的响应体 data */
  readonly login: Record<string, unknown>;
  /** user 路由的请求头 */
  readonly headers: Record<string, string>;
  /** member 路由的请求头：另带 X-Store-Id */
  withStore(storeId: string): Record<string, string>;
}

export interface SignInInput {
  /** 不给即一个没用过的大陆手机号 */
  readonly phone?: string;
  /** 不给即一个没用过的 openid（一台新设备） */
  readonly openid?: string;
  /** 另带的请求头（X-Client-Version 等） */
  readonly headers?: Record<string, string>;
}

let sequence = 0;
const next = (): number => (sequence += 1);
const randomPeer = (): string =>
  `198.19.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

/** 协议清单的种子（连同员工角色）加两份用户级协议（user、privacy）的当前版本。一个测试库调一次 */
export async function seedUserAgreements(
  testApi: Pick<TestApiHandle, "db">,
  api: Pick<TestApi, "runtime" | "clock">,
): Promise<{ user: string; privacy: string }> {
  const modules = SEED_MODULES.filter((seed) => ["staff", "docs"].includes(seed.module));
  await runSeed({ tx: api.runtime.tx, clock: api.clock, modules });
  const make = createFactories({ db: await testApi.db.prisma(), clock: api.clock });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const file = await make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
  const shared = { createdByStaffId: staff.id, pdfFileId: file.id };
  return {
    user: (await make.agreementVersion({ agreementKey: "user", ...shared })).id,
    privacy: (await make.agreementVersion({ agreementKey: "privacy", ...shared })).id,
  };
}

interface AgreementRow {
  agreementKey: string;
  subjectKind: string;
  currentVersion: { agreementVersionId: string } | null;
}

/** 此刻用户级协议当前版本的同意（经公开的协议清单接口取，与端上的做法相同） */
export async function currentUserConsents(
  api: Pick<TestApi, "request">,
): Promise<{ agreementKey: string; agreementVersionId: string }[]> {
  const response = await api.request("/api/v1/m/agreements?scene=login");
  const body = (await response.json()) as { data: { items: AgreementRow[] } };
  return body.data.items
    .filter((item) => item.subjectKind === "user" && item.currentVersion !== null)
    .map((item) => ({
      agreementKey: item.agreementKey,
      agreementVersionId: (item.currentVersion as { agreementVersionId: string })
        .agreementVersionId,
    }));
}

/** 预置一组登录用的 code（假微信），返回请求体里要的两样 */
export function presetLoginCodes(
  api: Pick<TestApi, "wechat">,
  input: { openid: string; phone: string },
): { loginCode: string; phoneCode: string } {
  const n = next();
  const loginCode = `lyxtest-login-${n}`;
  const phoneCode = `lyxtest-phone-${n}`;
  api.wechat.sessions.set(loginCode, { openid: input.openid });
  api.wechat.phones.set(phoneCode, input.phone);
  return { loginCode, phoneCode };
}

/** 手机号登录一个商家账号（没有就建）。登录不成即抛错，带上状态码与错误符号 */
export async function signInAsMerchant(
  api: TestApi,
  input: SignInInput = {},
): Promise<SignedInMerchant> {
  const n = next();
  const phone = input.phone ?? `137${String(20_000_000 + n).padStart(8, "0")}`;
  const openid = input.openid ?? `oLyxApi_${String(n).padStart(6, "0")}`;
  const response = await api.request("/api/v1/m/sessions/phone-login", {
    method: "POST",
    json: { ...presetLoginCodes(api, { openid, phone }), consents: await currentUserConsents(api) },
    headers: input.headers ?? {},
    peer: randomPeer(),
  });
  const body = (await response.json()) as {
    error?: string;
    data?: { token: string; me: { user: { merchantUserId: string } } };
  };
  if (response.status !== 200 || body.data === undefined) {
    throw new Error(`手机号登录没成：${response.status} ${body.error ?? ""}`);
  }
  const headers = { ...input.headers, authorization: `Bearer ${body.data.token}` };
  return {
    token: body.data.token,
    merchantUserId: body.data.me.user.merchantUserId,
    phone,
    openid,
    login: body.data,
    headers,
    withStore: (storeId) => ({ ...headers, "x-store-id": storeId }),
  };
}
