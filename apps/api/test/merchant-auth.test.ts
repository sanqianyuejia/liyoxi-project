// 商家鉴权链与会话四条接口的接口层用例（任务书 W1-04 第 7 节验收 6、7、11、12 里属于第一个 PR 的部分）。
// operationId 以字符串字面量写在这里：“已落地”的判定按它认“有接口层测试”。
//   "m.session.create"、"m.session.phoneLogin"、"m.session.current.delete"、"m.me.get"
// 整个应用建起来，处理器是生产的清单加几条样例路由（member、能力点、required 的写、optional）：
// 鉴权链是生产的那五件，登录走真实的手机号登录（假微信），不用 fakeAuth。
import {
  CONSENT_WHITELIST_OPERATIONS,
  errorResponses,
  MeViewSchema,
  merchantRoute,
  okResponse,
  orNull,
  PhoneLoginResultSchema,
  SilentLoginResultSchema,
  VERSION_GATE_EXEMPT_OPERATIONS,
  z,
} from "@liyoxi/contract";
import type { AnyContractRoute } from "@liyoxi/contract";
import { createIdentityContext, uuidv7 } from "@liyoxi/services";
import { createFactories } from "@liyoxi/services/testing";
import type { Factories } from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { ok } from "../src/http/errors.js";
import { idemOf } from "../src/http/idempotency.js";
import { merchantConsent } from "../src/http/merchant-consent.js";
import { RATE_LIMIT_QUOTAS } from "../src/http/rate-limit-quotas.js";
import { versionGate } from "../src/http/version-gate.js";
import { merchantServicesOf } from "../src/merchant/services.js";
import { HANDLERS } from "../src/routes/index.js";
import { sessionHandlers } from "../src/routes/sessions.js";
import { defineHandler } from "../src/routing/define.js";
import { MountError } from "../src/routing/mount.js";
import { ROUTE_MIDDLEWARES } from "../src/routing/pipeline.js";
import { useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";
import {
  currentUserConsents,
  presetLoginCodes,
  seedUserAgreements,
  signInAsMerchant,
} from "../src/testing/merchant.js";
import type { SignedInMerchant } from "../src/testing/merchant.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 120_000 };

// ---------- 样例路由：不进契约的登记表，名字带 lyxtest ----------

const ViewerSchema = z.object({
  merchantUserId: orNull(z.string()),
  role: orNull(z.string()),
  entityId: orNull(z.string()),
  storeId: orNull(z.string()),
  storeMode: orNull(z.string()),
});
const NoteSchema = z.object({ serial: z.int() });
const NoteBody = {
  body: {
    required: true,
    content: { "application/json": { schema: z.object({ text: z.string().min(1) }) } },
  },
} as const;
const sample = {
  responses: { ...okResponse(ViewerSchema), ...errorResponses(401, 403, 426, 428) },
};

const memberRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-gates/member",
  operationId: "m.lyxtestGate.member",
  "x-clerk-view": "same",
  ...sample,
});
const ownerOnlyRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-gates/owner-only",
  operationId: "m.lyxtestGate.ownerOnly",
  "x-capability": "order.create",
  "x-clerk-view": "none",
  ...sample,
});
const uploadRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-gates/upload",
  operationId: "m.lyxtestGate.upload",
  "x-capability": "asset.upload",
  "x-clerk-view": "same",
  ...sample,
});
const optionalRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-gates/optional",
  operationId: "m.lyxtestGate.optional",
  "x-auth": "optional",
  "x-clerk-view": "same",
  ...sample,
});
const userNoteRoute = merchantRoute({
  method: "post",
  path: "/m/lyxtest-gates/notes",
  operationId: "m.lyxtestGate.note.create",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
  request: NoteBody,
  responses: { ...okResponse(NoteSchema), ...errorResponses(400, 401, 403, 426, 428) },
});
const memberNoteRoute = merchantRoute({
  method: "post",
  path: "/m/lyxtest-gates/member-notes",
  operationId: "m.lyxtestGate.memberNote.create",
  "x-clerk-view": "same",
  "x-idempotent": "required",
  request: NoteBody,
  responses: { ...okResponse(NoteSchema), ...errorResponses(400, 401, 403, 426, 428) },
});

let executed = 0;
const viewer = (route: AnyContractRoute) =>
  defineHandler(route as typeof memberRoute, (c) =>
    ok(c, {
      merchantUserId: c.var.identity?.actor.id ?? null,
      role: c.var.identity?.actor.role ?? null,
      entityId: c.var.identity?.entityId ?? null,
      storeId: c.var.identity?.storeId ?? null,
      storeMode: c.var.membership?.storeMode ?? null,
    }),
  );
const note = (route: typeof userNoteRoute | typeof memberNoteRoute) =>
  defineHandler(route as typeof userNoteRoute, async (c) => {
    const { runtime } = c.var;
    const result = await runtime.tx.run(
      async (tx) => {
        executed += 1;
        await tx.outboxEvent.create({
          data: {
            id: uuidv7(),
            eventType: "lyxtest.gate_noted",
            payload: { v: 1 },
            actorType: "system",
            occurredAt: runtime.clock.now(),
          },
        });
        return { serial: executed };
      },
      { idem: idemOf(c) },
    );
    return ok(c, result);
  });

const GATE_HANDLERS = [
  viewer(memberRoute),
  viewer(ownerOnlyRoute),
  viewer(uploadRoute),
  viewer(optionalRoute),
  note(userNoteRoute),
  note(memberNoteRoute),
];
const NOTE_SCOPES = ["m.lyxtestGate.note.create", "m.lyxtestGate.memberNote.create"];

// ---------- 共用 ----------

let api: TestApi;
let make: Factories;
let prisma: Awaited<ReturnType<typeof testApi.db.prisma>>;
/** 一位老板（建了主体与首家门店）、他店里的一位店员、一个没有成员关系的账号 */
let owner: SignedInMerchant & { entityId: string; storeId: string };
let clerk: SignedInMerchant;
let loner: SignedInMerchant;

interface Body<T = Record<string, unknown>> {
  code: number;
  error?: string;
  data: T;
  details?: { pendingConsents?: { agreementKey: string }[] };
}
async function call<T = Record<string, unknown>>(
  path: string,
  init: Parameters<TestApi["request"]>[1] = {},
  on: TestApi = api,
): Promise<{ status: number; headers: Headers; body: Body<T> }> {
  const response = await on.request(`/api/v1${path}`, init);
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Body<T>,
  };
}
const noteRows = () => prisma.idempotencyRecord.count({ where: { scope: { in: NOTE_SCOPES } } });
const postNote = (path: string, headers: Record<string, string>, key: string) =>
  call<{ serial: number }>(path, {
    method: "POST",
    json: { text: "备忘" },
    headers: { ...headers, "idempotency-key": key },
  });
const setMinVersion = async (version: string): Promise<void> => {
  const now = api.clock.now();
  await prisma.featureFlag.upsert({
    where: { key: "client.min_version" },
    update: { defaultValue: version, updatedAt: now },
    create: {
      key: "client.min_version",
      valueType: "json",
      defaultValue: version,
      rules: [],
      exposedTo: "client",
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.config.cache.bump("flag");
};

beforeAll(async () => {
  api = await testApi.start({ handlers: [...HANDLERS, ...GATE_HANDLERS] });
  await seedUserAgreements(testApi, api);
  prisma = await testApi.db.prisma();
  make = createFactories({ db: prisma, clock: api.clock });

  const { tenant } = merchantServicesOf(api.runtime);
  const boss = await signInAsMerchant(api);
  const created = await tenant.createEntity(
    createIdentityContext({
      actor: { type: "merchant", id: boss.merchantUserId, client: "weapp" },
    }),
  );
  owner = { ...boss, entityId: created.entityId, storeId: created.storeId };
  clerk = await signInAsMerchant(api);
  const member = await make.entityMember({
    entityId: owner.entityId,
    merchantUserId: clerk.merchantUserId,
  });
  await make.storeMember({
    entityMemberId: member.id,
    storeId: owner.storeId,
    addedByMemberId: created.memberId,
  });
  loner = await signInAsMerchant(api);
}, 180_000);

describe("会话三条与当前账号", () => {
  it(
    "手机号登录：令牌与 me 合契约的结构，带 no-store；当前账号只出脱敏手机号",
    TIMEOUT,
    async () => {
      const phone = "13612345678";
      const openid = "oLyxApi_shape";
      const login = await call("/m/sessions/phone-login", {
        method: "POST",
        json: {
          ...presetLoginCodes(api, { openid, phone }),
          consents: await currentUserConsents(api),
          device: { model: "iPhone 15", system: "iOS 17.5" },
          attribution: { channelCode: "nope", scene: 1011 },
        },
        headers: { "x-client-version": "1.4.0" },
      });
      expect(login.status).toBe(200);
      expect(login.headers.get("Cache-Control")).toBe("no-store");
      const result = PhoneLoginResultSchema.parse(login.body.data);
      expect(result).toMatchObject({ isNewUser: true, switchedFrom: null });
      expect(result.me.user.phoneMask).toBe("136****5678");

      const me = await call("/m/me", { headers: { authorization: `Bearer ${result.token}` } });
      expect(me.status).toBe(200);
      expect(me.headers.get("Cache-Control")).toBe("no-store");
      expect(MeViewSchema.parse(me.body.data)).toEqual(result.me);
      expect(JSON.stringify(me.body)).not.toContain(phone);

      // 入参不合结构：400，不到用例
      const bad = await call("/m/sessions/phone-login", {
        method: "POST",
        json: { loginCode: "x", phoneCode: "y", consents: [] },
      });
      expect([bad.status, bad.body.error]).toEqual([400, "VALIDATION_FAILED"]);
    },
  );

  it(
    "静默登录：没绑定过的微信 needPhone；绑定过的发会话；code 无效 400；退出后令牌失效、不能再静默登录",
    TIMEOUT,
    async () => {
      const silent = (loginCode: string) =>
        call("/m/sessions", { method: "POST", json: { loginCode } });
      const fresh = presetLoginCodes(api, { openid: "oLyxApi_nobody", phone: "13600000001" });
      const guest = await silent(fresh.loginCode);
      expect(guest.status).toBe(200);
      expect(SilentLoginResultSchema.parse(guest.body.data)).toEqual({
        needPhone: true,
        token: null,
        me: null,
      });
      const invalid = await silent("lyxtest-not-preset");
      expect([invalid.status, invalid.body.error]).toEqual([400, "WECHAT_CODE_INVALID"]);

      const user = await signInAsMerchant(api);
      const again = () => presetLoginCodes(api, { openid: user.openid, phone: user.phone });
      const back = await silent(again().loginCode);
      expect(back.headers.get("Cache-Control")).toBe("no-store");
      const session = SilentLoginResultSchema.parse(back.body.data);
      expect(session.needPhone).toBe(false);
      expect(session.me?.user.merchantUserId).toBe(user.merchantUserId);
      const headers = { authorization: `Bearer ${session.token ?? ""}` };
      expect((await call("/m/me", { headers })).status).toBe(200);

      const out = await call("/m/sessions/current", { method: "DELETE", headers });
      expect([out.status, out.body.data]).toEqual([200, null]);
      const after = await call("/m/me", { headers });
      expect([after.status, after.body.error]).toEqual([401, "SESSION_INVALID"]);
      // 另一条会话（手机号登录的那条）不受影响；这个微信要重新验证手机号才恢复静默登录
      expect((await call("/m/me", { headers: user.headers })).status).toBe(200);
      const closed = await silent(again().loginCode);
      expect(closed.body.data).toMatchObject({ needPhone: true });
    },
  );

  it(
    "没带令牌 401 AUTH_REQUIRED；写法不对、对不上、账号被禁用 401 SESSION_INVALID",
    TIMEOUT,
    async () => {
      const none = await call("/m/me");
      expect([none.status, none.body.error]).toEqual([401, "AUTH_REQUIRED"]);
      const cases = [
        "Bearer lyxm_garbage",
        "Basic dXNlcjpwYXNz",
        `Bearer ${loner.token.slice(0, -3)}AAA`,
      ];
      for (const authorization of cases) {
        const response = await call("/m/me", { headers: { authorization } });
        expect([response.status, response.body.error], authorization).toEqual([
          401,
          "SESSION_INVALID",
        ]);
      }
      const banned = await signInAsMerchant(api);
      await prisma.merchantUser.update({
        where: { id: banned.merchantUserId },
        data: { status: "disabled" },
      });
      const refused = await call("/m/me", { headers: banned.headers });
      expect([refused.status, refused.body.error]).toEqual([401, "SESSION_INVALID"]);
      const logout = await call("/m/sessions/current", { method: "DELETE" });
      expect([logout.status, logout.body.error]).toEqual([401, "AUTH_REQUIRED"]);
    },
  );

  it("optional 路由：没带令牌、带了无效的令牌都按匿名；有效的令牌带出身份", TIMEOUT, async () => {
    const path = "/m/lyxtest-gates/optional";
    expect((await call(path)).body.data).toMatchObject({ merchantUserId: null });
    const stale = await call(path, { headers: { authorization: "Bearer lyxm_garbage" } });
    expect([stale.status, stale.body.data.merchantUserId]).toEqual([200, null]);
    const known = await call(path, { headers: loner.headers });
    expect(known.body.data).toMatchObject({ merchantUserId: loner.merchantUserId, role: null });
  });
});

describe("成员关系与能力点（验收 6）", () => {
  const path = "/m/lyxtest-gates/member";

  it(
    "member 路由：缺 X-Store-Id、不是 UUID、门店不存在、没有成员关系，一律 403 NOT_A_MEMBER",
    TIMEOUT,
    async () => {
      const stranger = await make.store();
      const attempts: Record<string, string>[] = [
        owner.headers,
        owner.withStore("not-a-uuid"),
        owner.withStore(uuidv7()),
        owner.withStore(stranger.id),
        loner.withStore(owner.storeId),
      ];
      for (const headers of attempts) {
        const response = await call(path, { headers });
        expect([response.status, response.body.error]).toEqual([403, "NOT_A_MEMBER"]);
      }
      const anonymous = await call(path, { headers: { "x-store-id": owner.storeId } });
      expect([anonymous.status, anonymous.body.error]).toEqual([401, "AUTH_REQUIRED"]);
    },
  );

  it(
    "老板与店员进自己的门店：身份上下文带上角色、主体与门店；大写的门店 id 同样认",
    TIMEOUT,
    async () => {
      const boss = await call(path, { headers: owner.withStore(owner.storeId.toUpperCase()) });
      expect(boss.body.data).toEqual({
        merchantUserId: owner.merchantUserId,
        role: "owner",
        entityId: owner.entityId,
        storeId: owner.storeId,
        storeMode: "active",
      });
      const staff = await call(path, { headers: clerk.withStore(owner.storeId) });
      expect(staff.body.data).toMatchObject({ role: "clerk", storeId: owner.storeId });
    },
  );

  it(
    "店员调 clerkView none 的路由 403 ROLE_FORBIDDEN；能力点按角色与门店状态判",
    TIMEOUT,
    async () => {
      const barred = await call("/m/lyxtest-gates/owner-only", {
        headers: clerk.withStore(owner.storeId),
      });
      expect([barred.status, barred.body.error]).toEqual([403, "ROLE_FORBIDDEN"]);
      expect(
        (await call("/m/lyxtest-gates/owner-only", { headers: owner.withStore(owner.storeId) }))
          .status,
      ).toBe(200);
      // asset.upload：店员有
      expect(
        (await call("/m/lyxtest-gates/upload", { headers: clerk.withStore(owner.storeId) })).status,
      ).toBe(200);

      // 老板自己停用的门店：收尾上下文，超出收尾范围的能力点回 STORE_ARCHIVED
      const now = api.clock.now();
      const archived = await make.store({
        entityId: owner.entityId,
        lifecycle: "archived",
        archivedAt: now,
        archiveReason: "by_owner",
        archiveActorType: "merchant",
        archiveActorId: owner.merchantUserId,
        archiveClient: "weapp",
      });
      const winding = await call(path, { headers: owner.withStore(archived.id) });
      expect(winding.body.data).toMatchObject({ role: "owner", storeMode: "archived" });
      const upload = await call("/m/lyxtest-gates/upload", {
        headers: owner.withStore(archived.id),
      });
      expect([upload.status, upload.body.error]).toEqual([403, "STORE_ARCHIVED"]);
      const order = await call("/m/lyxtest-gates/owner-only", {
        headers: owner.withStore(archived.id),
      });
      expect([order.status, order.body.error]).toEqual([403, "STORE_ARCHIVED"]);
      // 店员进不了已停用的门店
      const gone = await call(path, { headers: clerk.withStore(archived.id) });
      expect([gone.status, gone.body.error]).toEqual([403, "NOT_A_MEMBER"]);
    },
  );
});

describe("顺序：401、403、426、428 都在幂等行落库之前（验收 6、7）", () => {
  it(
    "被拦下的 required 请求幂等表 0 行；同意后用同一个键重放成功，只执行一次",
    TIMEOUT,
    async () => {
      const user = await signInAsMerchant(api);
      const userPath = "/m/lyxtest-gates/notes";
      const memberPath = "/m/lyxtest-gates/member-notes";
      const before = await noteRows();
      const ran = executed;

      // 401：没带令牌；403：member 的写没带门店
      const unauth = await postNote(userPath, {}, "note:gate-401");
      expect([unauth.status, unauth.body.error]).toEqual([401, "AUTH_REQUIRED"]);
      const outsider = await postNote(memberPath, user.headers, "note:gate-403");
      expect([outsider.status, outsider.body.error]).toEqual([403, "NOT_A_MEMBER"]);

      // 426：版本过低。豁免的协议读取照常；登录这种公开接口同样被拦
      await setMinVersion("2.0.0");
      try {
        const old = { ...user.headers, "x-client-version": "1.9.9" };
        const outdated = await postNote(userPath, old, "note:gate-426");
        expect([outdated.status, outdated.body.error]).toEqual([426, "CLIENT_OUTDATED"]);
        const missing = await call("/m/me", { headers: user.headers });
        expect([missing.status, missing.body.error]).toEqual([426, "CLIENT_OUTDATED"]);
        const login = await call("/m/sessions", {
          method: "POST",
          json: { loginCode: "x" },
          headers: { "x-client-version": "1.9.9" },
        });
        expect([login.status, login.body.error]).toEqual([426, "CLIENT_OUTDATED"]);
        expect(
          (await call("/m/agreements", { headers: { "x-client-version": "1.9.9" } })).status,
        ).toBe(200);
        const current = await call("/m/me", {
          headers: { ...user.headers, "x-client-version": "2.0.0" },
        });
        expect(current.status).toBe(200);
      } finally {
        await setMinVersion("0.0.0");
      }

      // 428：隐私政策出了要重新同意的新版本
      const staff = await make.staff({ staffRoleKey: "super_admin" });
      const file = await make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
      const next = await make.agreementVersion({
        agreementKey: "privacy",
        status: "pending",
        effectiveAt: api.clock.now(),
        isReconsentRequired: true,
        createdByStaffId: staff.id,
        pdfFileId: file.id,
      });
      merchantServicesOf(api.runtime).identity.consentGate.invalidate();
      const key = "note:gate-428";
      const blocked = await postNote(userPath, user.headers, key);
      expect([blocked.status, blocked.body.error]).toEqual([428, "CONSENT_REQUIRED"]);
      expect(blocked.body.details?.pendingConsents).toMatchObject([
        { agreementKey: "privacy", agreementVersionId: next.id },
      ]);
      // 白名单照常：当前账号（带出待同意的协议）、协议读取
      const me = await call<{ pendingConsents: unknown[] }>("/m/me", { headers: user.headers });
      expect([me.status, me.body.data.pendingConsents.length]).toEqual([200, 1]);
      expect((await call("/m/agreements", { headers: user.headers })).status).toBe(200);
      // optional 路由不在白名单里：登录用户同样被拦，匿名不查
      const optional = await call("/m/lyxtest-gates/optional", { headers: user.headers });
      expect(optional.status).toBe(428);
      expect((await call("/m/lyxtest-gates/optional")).status).toBe(200);

      expect(await noteRows()).toBe(before);
      expect(executed).toBe(ran);

      // 同意新版本（这里走手机号登录带上新版本的同意）之后，原来的令牌、同一个键重放成功
      await signInAsMerchant(api, { phone: user.phone, openid: user.openid });
      const first = await postNote(userPath, user.headers, key);
      expect([first.status, first.headers.get("Idempotent-Replayed")]).toEqual([200, null]);
      const replay = await postNote(userPath, user.headers, key);
      expect([replay.status, replay.headers.get("Idempotent-Replayed")]).toEqual([200, "true"]);
      expect(replay.body.data).toEqual(first.body.data);
      expect(executed).toBe(ran + 1);
      expect(await noteRows()).toBe(before + 1);
    },
  );

  it(
    "指纹相等时不查同意记录；没有成员关系的账号在 user 路由上按最小的一列判能力点",
    TIMEOUT,
    async () => {
      const user = await signInAsMerchant(api);
      const { docs } = merchantServicesOf(api.runtime);
      const real = docs.pendingConsents;
      let lookups = 0;
      docs.pendingConsents = (db, id) => {
        lookups += 1;
        return real(db, id);
      };
      try {
        for (let n = 0; n < 3; n += 1) {
          const done = await postNote("/m/lyxtest-gates/notes", user.headers, `note:stamp-${n}`);
          expect(done.status).toBe(200);
        }
        expect(lookups).toBe(0);
      } finally {
        docs.pendingConsents = real;
      }
    },
  );

  it("两张名单上的接口不挂对应的中间件：版本门槛豁免 5 条、协议同意白名单 9 条", () => {
    const route = (operationId: string) =>
      ({ operationId, "x-auth": "user", "x-clerk-view": "same" }) as unknown as AnyContractRoute;
    for (const id of VERSION_GATE_EXEMPT_OPERATIONS) {
      expect(versionGate(route(id), api.runtime), id).toBeNull();
    }
    for (const id of CONSENT_WHITELIST_OPERATIONS) {
      expect(merchantConsent(route(id), api.runtime), id).toBeNull();
    }
    expect(versionGate(route("m.me.get"), api.runtime)).not.toBeNull();
    expect(merchantConsent(route("m.entity.create"), api.runtime)).not.toBeNull();
    // 已挂载的路由按声明各有各的链
    const chain = (id: string) =>
      api.api.mounted.find((item) => item.operationId === id)?.middlewares;
    expect(chain("m.me.get")).toEqual(["versionGate", "auth", "rateLimit", "idempotency"]);
    expect(chain("m.session.phoneLogin")).toEqual(["versionGate", "rateLimit", "idempotency"]);
    expect(chain("m.agreement.list")).toEqual(["rateLimit", "idempotency"]);
    expect(chain("m.lyxtestGate.ownerOnly")).toEqual([
      "versionGate",
      "auth",
      "membership",
      "consent",
      "authz",
      "rateLimit",
      "idempotency",
    ]);
  });
});

describe("限流（验收 12）", () => {
  const tight = {
    ...RATE_LIMIT_QUOTAS,
    "m.login.silent": [{ by: "ip", limit: 2, windowSec: 60 }],
    "m.login.phone": [{ by: "ip", limit: 2, windowSec: 3_600 }],
  } as const;

  it("两条登录路由超限回 429 并带 Retry-After", TIMEOUT, async () => {
    const limited = await testApi.start({ rateLimitQuotas: tight });
    const silent = () =>
      call("/m/sessions", { method: "POST", json: { loginCode: "lyxtest-none" } }, limited);
    expect((await silent()).status).toBe(400);
    expect((await silent()).status).toBe(400);
    const third = await silent();
    expect([third.status, third.body.error]).toEqual([429, "RATE_LIMITED"]);
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);

    const phone = () =>
      call(
        "/m/sessions/phone-login",
        {
          method: "POST",
          json: {
            loginCode: "lyxtest-none",
            phoneCode: "lyxtest-none",
            consents: [{ agreementKey: "user", agreementVersionId: uuidv7() }],
          },
        },
        limited,
      );
    expect((await phone()).status).toBe(400);
    expect((await phone()).status).toBe(400);
    const blocked = await phone();
    expect([blocked.status, blocked.body.error]).toEqual([429, "RATE_LIMITED"]);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it(
    "手机号登录另按 openid 计：同一个微信每小时 5 次，第 6 次 429，手机号的 code 不再去换",
    TIMEOUT,
    async () => {
      const openid = "oLyxApi_hammer";
      const attempt = (n: number) =>
        call("/m/sessions/phone-login", {
          method: "POST",
          json: {
            ...presetLoginCodes(api, { openid, phone: "13600000002" }),
            // 协议没勾全：每次都在事务里被 428 拦下，不建账号；按 openid 的计数照记
            consents: [{ agreementKey: "user", agreementVersionId: uuidv7() }],
          },
          // 每次换一个来源 IP：只让 openid 这一条规则起作用
          peer: `198.19.200.${n + 1}`,
        });
      api.wechat.resetCalls();
      for (let n = 0; n < 5; n += 1) {
        const response = await attempt(n);
        expect(response.status, `第 ${n + 1} 次`).not.toBe(429);
      }
      const sixth = await attempt(5);
      expect([sixth.status, sixth.body.error]).toEqual([429, "RATE_LIMITED"]);
      expect(Number(sixth.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(api.wechat.callsOf("code2Session")).toHaveLength(6);
      expect(api.wechat.callsOf("getPhoneNumber")).toHaveLength(5);
    },
  );

  it("声明了档位而装配里没有限流：建应用即失败", TIMEOUT, async () => {
    const failure = await testApi
      .start({
        handlers: sessionHandlers,
        pipeline: ROUTE_MIDDLEWARES.filter((entry) => entry.slot !== "rateLimit"),
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MountError);
    const issues = (failure as MountError).issues;
    expect(issues).toHaveLength(sessionHandlers.length);
    expect(issues[0]).toContain("m.session.create：声明了 x-rate-limit");
  });
});
