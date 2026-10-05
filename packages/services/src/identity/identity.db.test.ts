// identity 的服务层用例（任务书 W1-04 第 7 节验收 1、4 与“模块完整”的五条不变量）。连真库，整份文件共用一个带种子的库。
// 各段用自己的手机号与 openid，互不踩；时钟只往前拨。并发的两条（验收 2、3）在 login.concurrency.test.ts。
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createIdentityContext, uuidv7 } from "../kernel/index.js";
import { openField, phoneBidx } from "../security/index.js";
import {
  assertSnapshotsEqual,
  diffSnapshots,
  snapshotTables,
  useSeededDatabase,
} from "../testing/index.js";
import {
  appError,
  buildHarness,
  keyring,
  META,
  nextOpenid,
  nextPhone,
  TEST_APPID,
} from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import {
  findI22Violations,
  findI23Violations,
  findI25Violations,
  findI8Violations,
  findI9Violations,
  MAX_SESSIONS_PER_IDENTITY,
  openidHmac,
  parseToken,
} from "./index.js";

const db = useSeededDatabase("services");
const SLOW = 120_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let prisma: PrismaClient;
let h: Harness;

beforeAll(async () => {
  prisma = await db.prisma();
  h = await buildHarness(prisma);
}, SLOW);

/** 用一个新手机号、新 openid 走一遍手机号登录 */
async function register(input: { phone?: string; openid?: string } = {}) {
  const phone = input.phone ?? nextPhone();
  const openid = input.openid ?? nextOpenid();
  const result = await h.identity.phoneLogin(META, {
    ...h.codes({ openid, phone }),
    consents: h.consents(),
  });
  const sessionId = parseToken(result.token)?.sessionId as string;
  return { phone, openid, result, sessionId, userId: result.me.user.merchantUserId };
}

const userByPhone = (phone: string) =>
  prisma.merchantUser.findUnique({ where: { phoneBidx: phoneBidx(keyring, phone) } });
const identityOf = (openid: string) =>
  prisma.wechatIdentity.findUnique({ where: { appid_openid: { appid: TEST_APPID, openid } } });
const authEvents = (subjectId: string) =>
  prisma.authEvent.findMany({ where: { subjectId }, orderBy: { seq: "asc" } });
const check = (token: string) => h.identity.authenticate(token, { ip: "198.51.100.7" });

describe("令牌与会话（验收 1）", () => {
  it(
    "有效的令牌给出当前会话；同一天第二次请求不再写库；隔天的第一次请求续写一次",
    async () => {
      const { result, sessionId, userId } = await register();
      const tables = ["user_session", "merchant_user", "wechat_identity"];
      const before = await snapshotTables(prisma, tables);

      h.clock.advance(MINUTE);
      const first = await check(result.token);
      expect(first).toMatchObject({ ok: true, touched: false });
      if (!first.ok) throw new Error("本该有效");
      expect(first.principal).toMatchObject({ sessionId, merchantUserId: userId });
      expect(first.principal.consentStamp).toMatch(/^[0-9a-f]{64}$/);
      assertSnapshotsEqual(before, await snapshotTables(prisma, tables));

      // 隔天：会话的 last_seen_at 与空闲过期、账号与微信身份的活跃时间各写一次
      h.clock.advance(DAY);
      expect(await check(result.token)).toMatchObject({ ok: true, touched: true });
      const now = h.clock.now();
      const session = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.lastSeenAt).toEqual(now);
      expect(session.idleExpiresAt).toEqual(new Date(now.getTime() + 30 * DAY));
      expect(session.lastIp).toBe("198.51.100.7");
      const user = await prisma.merchantUser.findUniqueOrThrow({ where: { id: userId } });
      expect(user.lastActiveAt).toEqual(now);

      const after = await snapshotTables(prisma, tables);
      h.clock.advance(MINUTE);
      expect(await check(result.token)).toMatchObject({ ok: true, touched: false });
      assertSnapshotsEqual(after, await snapshotTables(prisma, tables));

      // 微信身份的活跃时间：距上次写入超过 30 分钟才再写，只动它这一行
      h.clock.advance(31 * MINUTE);
      expect(await check(result.token)).toMatchObject({ ok: true, touched: true });
      const identity = await prisma.wechatIdentity.findUniqueOrThrow({
        where: { id: first.principal.wechatIdentityId },
      });
      expect(identity.lastActiveAt).toEqual(h.clock.now());
      const touched = diffSnapshots(after, await snapshotTables(prisma, tables));
      expect(touched.tables.map((table) => table.table)).toEqual(["wechat_identity"]);
    },
    SLOW,
  );

  it(
    "空闲 30 天、绝对 90 天的边界：到点即无效，差 1 毫秒还有效",
    async () => {
      const idle = await register();
      h.clock.advance(30 * DAY - 1);
      expect(await check(idle.result.token)).toMatchObject({ ok: true });
      // 上一次请求把空闲过期滑到了“那一刻 + 30 天”
      h.clock.advance(30 * DAY - 1);
      expect(await check(idle.result.token)).toMatchObject({ ok: true });
      h.clock.advance(30 * DAY);
      expect(await check(idle.result.token)).toEqual({ ok: false, reason: "idle_expired" });

      // 绝对过期：一直有请求（每 20 天一次，空闲过期不断后滑），满 90 天仍然无效
      const absolute = await register();
      for (let step = 0; step < 4; step += 1) {
        h.clock.advance(20 * DAY);
        expect(await check(absolute.result.token)).toMatchObject({ ok: true });
      }
      h.clock.advance(10 * DAY - 1);
      expect(await check(absolute.result.token)).toMatchObject({ ok: true });
      h.clock.advance(1);
      expect(await check(absolute.result.token)).toEqual({
        ok: false,
        reason: "absolute_expired",
      });
    },
    SLOW,
  );

  it(
    "吊销、账号禁用、改了一位的令牌、不存在的会话、写法不对：各是哪一种无效",
    async () => {
      const revoked = await register();
      await prisma.userSession.update({
        where: { id: revoked.sessionId },
        data: { revokedAt: h.clock.now(), revokeReason: "admin" },
      });
      expect(await check(revoked.result.token)).toEqual({ ok: false, reason: "revoked" });

      const disabled = await register();
      await prisma.merchantUser.update({
        where: { id: disabled.userId },
        data: { status: "disabled" },
      });
      expect(await check(disabled.result.token)).toEqual({
        ok: false,
        reason: "account_inactive",
      });

      const live = await register();
      const last = live.result.token.at(-2) === "A" ? "B" : "A";
      const tampered = `${live.result.token.slice(0, -2)}${last}${live.result.token.slice(-1)}`;
      expect(await check(tampered)).toEqual({ ok: false, reason: "mismatch" });
      const other = await register();
      const swapped = live.result.token.replace(live.sessionId, other.sessionId);
      expect(await check(swapped)).toEqual({ ok: false, reason: "mismatch" });
      const ghost = live.result.token.replace(
        live.sessionId,
        "0198c0de-0000-7000-8000-00000000dead",
      );
      expect(await check(ghost)).toEqual({ ok: false, reason: "unknown" });
      expect(await check("lyxm_not-a-token")).toEqual({ ok: false, reason: "malformed" });
      expect(await check(live.result.token)).toMatchObject({ ok: true });
    },
    SLOW,
  );
});

describe("手机号登录各分支（验收 4）", () => {
  it(
    "新号：建账号（手机号四列、来源）、注册的状态历史与事件、两份同意记录与指纹、会话、auth_event",
    async () => {
      const phone = nextPhone();
      const openid = nextOpenid();
      h.providers.reset();
      const result = await h.identity.phoneLogin(META, {
        ...h.codes({ openid, phone, unionid: "uLyxTest_1" }),
        consents: h.consents(),
        device: { model: "iPhone 15", system: "iOS 17.5", wechatVersion: "8.0.50" },
      });
      h.providers.assertCalls(["wechat.code2Session", "wechat.getPhoneNumber"]);

      expect(result.isNewUser).toBe(true);
      expect(result.switchedFrom).toBeNull();
      expect(result.me.memberships).toEqual([]);
      expect(result.me.pendingConsents).toEqual([]);
      expect(result.me.notices).toEqual([]);
      expect(result.me.user).toMatchObject({
        displayName: null,
        phoneMask: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        actions: ["update", "deletion"],
      });

      const user = await userByPhone(phone);
      if (user === null) throw new Error("账号没建出来");
      expect(user).toMatchObject({
        id: result.me.user.merchantUserId,
        status: "active",
        phoneLast4: phone.slice(-4),
        sourceType: "organic",
        sourceReferralCodeId: null,
      });
      expect(openField(keyring, "merchant_user.phone_enc", user.phoneEnc as string)).toBe(phone);
      expect(user.consentStamp).toBe((await h.docs.consentStamps(prisma)).user);

      const history = await prisma.statusTransition.findMany({ where: { subjectId: user.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        machine: "merchant_user",
        stateField: "status",
        fromState: null,
        toState: "active",
        event: "merchant_user.register",
      });
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: user.id } });
      expect(events.map((event) => event.eventType)).toEqual(["merchant_user.registered"]);
      expect(events[0]?.payload).toMatchObject({
        v: 1,
        merchantUserId: user.id,
        via: "phone_login",
        sourceType: "organic",
        sourceReferralCodeId: null,
        fromState: null,
        toState: "active",
        transition: "merchant_user.register",
      });

      const consents = await prisma.agreementConsent.findMany({
        where: { merchantUserId: user.id },
      });
      expect(consents.map((row) => row.agreementKey).sort()).toEqual(["privacy", "user"]);
      for (const row of consents) {
        expect(row).toMatchObject({
          scene: "login",
          method: "checkbox",
          role: null,
          operatorNameMask: null,
          appid: TEST_APPID,
          bizType: null,
          entityId: null,
          ip: META.ip,
          requestId: META.requestId,
        });
        expect(Buffer.from(row.openidHmac as Uint8Array)).toEqual(
          openidHmac(keyring, TEST_APPID, openid),
        );
        expect(row.deviceSnapshot).toMatchObject({ model: "iPhone 15", appVersion: "1.4.0" });
      }

      const identity = await identityOf(openid);
      expect(identity).toMatchObject({
        merchantUserId: user.id,
        unionid: "uLyxTest_1",
        silentLoginEnabled: true,
      });
      const sessions = await prisma.userSession.findMany({ where: { merchantUserId: user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        wechatIdentityId: identity?.id,
        deviceInfo: "iPhone 15 · iOS 17.5 · 微信 8.0.50",
        lastIp: META.ip,
        revokedAt: null,
      });
      // 库里只有随机部分的摘要：令牌里的随机部分在哪一列都找不到
      const secret = result.token.split(".")[1] as string;
      expect(JSON.stringify(sessions)).not.toContain(secret);
      expect(await authEvents(user.id)).toMatchObject([
        { space: "merchant", event: "login_success", method: "phone", ip: META.ip },
      ]);
    },
    SLOW,
  );

  it(
    "首触来源：两个码转大写查登记表，邀请码优先，命中且启用才算；老号再登录不改来源",
    async () => {
      const staff = await h.make.staff();
      const now = h.clock.now();
      const code = (value: string, sourceType: string, status = "active") =>
        prisma.referralCode.create({
          data: {
            id: uuidv7(),
            code: value,
            sourceType,
            ownerStaffId: sourceType === "sales" ? staff.id : null,
            status,
            ...(status === "disabled" ? { disabledAt: now } : {}),
            createdAt: now,
            updatedAt: now,
          },
        });
      const sales = await code("LYXSALES01", "sales");
      const campaign = await code("LYXCAMP01", "campaign");
      await code("LYXOFF01", "campaign", "disabled");
      const loginWith = async (attribution: Record<string, unknown>, phone = nextPhone()) => {
        await h.identity.phoneLogin(META, {
          ...h.codes({ openid: nextOpenid(), phone }),
          consents: h.consents(),
          attribution,
        });
        return { phone, user: await userByPhone(phone) };
      };

      // 两个码都命中：邀请码优先
      const both = await loginWith({
        inviteCode: "lyxsales01",
        channelCode: "LYXCAMP01",
        scene: 1011,
      });
      expect(both.user).toMatchObject({
        sourceType: "sales",
        sourceReferralCodeId: sales.id,
        sourceInviteCode: "lyxsales01",
        sourceChannelCode: "LYXCAMP01",
        sourceScene: 1011,
      });
      // 邀请码停用：落到渠道码
      const fallback = await loginWith({ inviteCode: "LYXOFF01", channelCode: "lyxcamp01" });
      expect(fallback.user).toMatchObject({
        sourceType: "campaign",
        sourceReferralCodeId: campaign.id,
      });
      // 都不中：自然来源，原值照存
      const organic = await loginWith({ channelCode: "NOPE" });
      expect(organic.user).toMatchObject({
        sourceType: "organic",
        sourceReferralCodeId: null,
        sourceChannelCode: "NOPE",
      });
      // 老号换一台设备再登录，带了别的码：来源不改
      await loginWith({ inviteCode: "LYXSALES01" }, organic.phone);
      expect(await userByPhone(organic.phone)).toMatchObject({ sourceType: "organic" });
      expect(await findI23Violations(prisma)).toEqual([]);
    },
    SLOW,
  );

  it(
    "老号换微信：不是新用户；有成员关系且还有别的微信时写审计、发 wechat_bound，没有成员关系不发",
    async () => {
      const first = await register();
      const second = await h.identity.phoneLogin(META, {
        ...h.codes({ openid: nextOpenid(), phone: first.phone }),
        consents: h.consents(),
      });
      expect(second.isNewUser).toBe(false);
      expect(second.me.user.merchantUserId).toBe(first.userId);
      expect(await prisma.wechatIdentity.count({ where: { merchantUserId: first.userId } })).toBe(
        2,
      );
      const bound = () =>
        prisma.outboxEvent.findMany({
          where: { aggregateId: first.userId, eventType: "merchant_user.wechat_bound" },
        });
      expect(await bound()).toEqual([]);

      // 建了主体之后再换一个微信
      const owner = await h.tenant.createEntity(
        createIdentityContext({
          actor: { type: "merchant", id: first.userId, client: "weapp" },
        }),
      );
      const openid = nextOpenid();
      const third = await h.identity.phoneLogin(META, {
        ...h.codes({ openid, phone: first.phone }),
        consents: h.consents(),
      });
      expect(third.me.memberships).toMatchObject([
        { role: "owner", lastStoreId: owner.storeId, entity: { entityId: owner.entityId } },
      ]);
      expect(third.me.memberships[0]?.stores).toMatchObject([
        { storeId: owner.storeId, isPrimary: true, lifecycle: "active" },
      ]);
      const [event] = await bound();
      expect(event?.payload).toEqual({
        v: 1,
        merchantUserId: first.userId,
        wechatIdentityId: (await identityOf(openid))?.id,
      });
      const audits = await prisma.auditLog.findMany({
        where: { targetId: first.userId, action: "identity.wechat_identity.bind" },
      });
      expect(audits).toMatchObject([
        { stream: "ops", category: "account_security", entityId: owner.entityId },
      ]);
      // 同意记录带上了这时的角色
      const latest = await prisma.agreementConsent.findMany({
        where: { merchantUserId: first.userId },
      });
      expect(latest).toHaveLength(2);
    },
    SLOW,
  );

  it(
    "改绑：这个微信原来登录的是另一个有成员关系的账号 → 返回 switchedFrom，旧身份行删掉、原会话吊销",
    async () => {
      const previous = await register();
      await h.tenant.createEntity(
        createIdentityContext({
          actor: { type: "merchant", id: previous.userId, client: "weapp" },
        }),
      );
      const oldIdentity = await identityOf(previous.openid);
      const phone = nextPhone();
      const result = await h.identity.phoneLogin(META, {
        ...h.codes({ openid: previous.openid, phone }),
        consents: h.consents(),
      });
      expect(result.isNewUser).toBe(true);
      expect(result.switchedFrom).toEqual({ phoneMask: previous.result.me.user.phoneMask });

      const identity = await identityOf(previous.openid);
      expect(identity?.merchantUserId).toBe(result.me.user.merchantUserId);
      expect(identity?.id).not.toBe(oldIdentity?.id);
      expect(
        await prisma.userSession.findUnique({ where: { id: previous.sessionId } }),
      ).toMatchObject({ revokeReason: "identity_rebound", wechatIdentityId: null });
      expect(await check(previous.result.token)).toEqual({ ok: false, reason: "revoked" });
      expect(await authEvents(previous.userId)).toMatchObject([
        { event: "login_success" },
        { event: "identity_rebound", detail: { identityId: oldIdentity?.id, revokedSessions: 1 } },
      ]);

      // 原账号没有成员关系时不给 switchedFrom
      const loner = await register();
      const moved = await h.identity.phoneLogin(META, {
        ...h.codes({ openid: loner.openid, phone: nextPhone() }),
        consents: h.consents(),
      });
      expect(moved.switchedFrom).toBeNull();
    },
    SLOW,
  );

  it(
    "账号禁用、区号不是 86、协议没勾全、版本过期：各回对应的码，都不留下账号、会话与同意记录",
    async () => {
      const disabled = await register();
      await prisma.merchantUser.update({
        where: { id: disabled.userId },
        data: { status: "disabled" },
      });
      const tables = ["merchant_user", "wechat_identity", "user_session", "agreement_consent"];
      const before = await snapshotTables(prisma, tables);

      const again = h.codes({ openid: nextOpenid(), phone: disabled.phone });
      expect(
        (await appError(() => h.identity.phoneLogin(META, { ...again, consents: h.consents() })))
          .error,
      ).toBe("ACCOUNT_DISABLED");

      const abroad = h.codes({ openid: nextOpenid(), phone: "+85291234567" });
      expect(
        (await appError(() => h.identity.phoneLogin(META, { ...abroad, consents: h.consents() })))
          .error,
      ).toBe("PHONE_REGION_UNSUPPORTED");

      // 只勾了一份：428，details 里是缺的那一份
      const partial = await appError(() =>
        h.identity.phoneLogin(META, {
          ...h.codes({ openid: nextOpenid(), phone: nextPhone() }),
          consents: [{ agreementKey: "user", agreementVersionId: h.versions.user.id }],
        }),
      );
      expect(partial.error).toBe("CONSENT_REQUIRED");
      expect(partial.details).toMatchObject({
        pendingConsents: [{ agreementKey: "privacy", agreementVersionId: h.versions.privacy.id }],
      });

      // 交的不是当前版本：409，带当前版本 id
      const stale = await appError(() =>
        h.identity.phoneLogin(META, {
          ...h.codes({ openid: nextOpenid(), phone: nextPhone() }),
          consents: [
            { agreementKey: "user", agreementVersionId: h.versions.user.id },
            { agreementKey: "privacy", agreementVersionId: "0198c0de-0000-7000-8000-00000000beef" },
          ],
        }),
      );
      expect(stale.error).toBe("AGREEMENT_VERSION_STALE");
      expect(stale.details).toEqual({
        agreementKey: "privacy",
        currentAgreementVersionId: h.versions.privacy.id,
      });
      assertSnapshotsEqual(before, await snapshotTables(prisma, tables));
    },
    SLOW,
  );

  it(
    "休眠保护：已休眠的老板换了微信 → REVERIFY_REQUIRED，库里只多一行 auth_event；五条放行条件各自放行",
    async () => {
      const owner = await register();
      const ctx = createIdentityContext({
        actor: { type: "merchant", id: owner.userId, client: "weapp" },
      });
      // 没有成员关系：多久没登录都放行
      h.clock.advance(200 * DAY);
      await h.identity.phoneLogin(META, {
        ...h.codes({ openid: nextOpenid(), phone: owner.phone }),
        consents: h.consents(),
      });
      await h.tenant.createEntity(ctx);

      // 有成员关系、181 天没活跃、换了微信：转人工
      h.clock.advance(181 * DAY);
      const tables = [
        "merchant_user",
        "wechat_identity",
        "user_session",
        "agreement_consent",
        "status_transition",
        "outbox_event",
        "audit_log",
        "auth_event",
      ];
      const before = await snapshotTables(prisma, tables);
      const stranger = nextOpenid();
      const refused = await appError(() =>
        h.identity.phoneLogin(META, {
          ...h.codes({ openid: stranger, phone: owner.phone }),
          consents: h.consents(),
        }),
      );
      expect(refused.error).toBe("REVERIFY_REQUIRED");
      const diff = diffSnapshots(before, await snapshotTables(prisma, tables));
      expect(diff.tables.map((table) => table.table)).toEqual(["auth_event"]);
      expect(diff.tables[0]).toMatchObject({ removed: [], changed: [] });
      expect(diff.tables[0]?.added).toHaveLength(1);
      expect((await authEvents(owner.userId)).at(-1)).toMatchObject({
        event: "reverify_required",
        method: "phone",
      });
      expect(await identityOf(stranger)).toBeNull();

      // 已绑定的微信（不是新绑定）照常登录，不查休眠
      const known = await h.identity.phoneLogin(META, {
        ...h.codes({ openid: owner.openid, phone: owner.phone }),
        consents: h.consents(),
      });
      expect(known.isNewUser).toBe(false);

      // 刚活跃过（上一步登录写了 last_active_at）：新微信放行
      await h.identity.phoneLogin(META, {
        ...h.codes({ openid: nextOpenid(), phone: owner.phone }),
        consents: h.consents(),
      });

      // 再次休眠：人工放行窗口内放行；参数设 0（关闭检查）放行
      h.clock.advance(181 * DAY);
      await prisma.merchantUser.update({
        where: { id: owner.userId },
        data: { dormantBypassUntil: new Date(h.clock.now().getTime() + 72 * 60 * MINUTE) },
      });
      await h.identity.phoneLogin(META, {
        ...h.codes({ openid: nextOpenid(), phone: owner.phone }),
        consents: h.consents(),
      });
      h.clock.advance(181 * DAY);
      h.dormantDays = 0;
      try {
        await h.identity.phoneLogin(META, {
          ...h.codes({ openid: nextOpenid(), phone: owner.phone }),
          consents: h.consents(),
        });
      } finally {
        h.dormantDays = 180;
      }
    },
    SLOW,
  );

  it(
    "外呼失败回 WECHAT_UNAVAILABLE、code 无效回 WECHAT_CODE_INVALID，都没开事务；按 openid 限流的钩子在换手机号之前",
    async () => {
      const codes = h.codes({ openid: nextOpenid(), phone: nextPhone() });
      const input = { ...codes, consents: h.consents() };
      const runs = h.txRuns();

      h.wechat.failNext("code2Session");
      expect((await appError(() => h.identity.phoneLogin(META, input))).error).toBe(
        "WECHAT_UNAVAILABLE",
      );
      h.wechat.failNext("getPhoneNumber");
      expect((await appError(() => h.identity.phoneLogin(META, input))).error).toBe(
        "WECHAT_UNAVAILABLE",
      );
      expect(
        (await appError(() => h.identity.phoneLogin(META, { ...input, loginCode: "nope" }))).error,
      ).toBe("WECHAT_CODE_INVALID");
      expect(
        (await appError(() => h.identity.phoneLogin(META, { ...input, phoneCode: "nope" }))).error,
      ).toBe("WECHAT_CODE_INVALID");
      h.wechat.failNext("code2Session");
      expect(
        (await appError(() => h.identity.silentLogin(META, { loginCode: codes.loginCode }))).error,
      ).toBe("WECHAT_UNAVAILABLE");
      expect(h.txRuns()).toBe(runs);

      // 钩子拿到的是 openid 的 HMAC；它抛错即中止，手机号的 code 没用掉
      h.providers.reset();
      const seen: string[] = [];
      const limited = new Error("每 openid 限流");
      await expect(
        h.identity.phoneLogin(META, input, {
          onOpenid: (key) => {
            seen.push(key);
            return Promise.reject(limited);
          },
        }),
      ).rejects.toBe(limited);
      expect(seen).toEqual([
        openidHmac(
          keyring,
          TEST_APPID,
          h.wechat.sessions.get(codes.loginCode)?.openid as string,
        ).toString("hex"),
      ]);
      h.providers.assertCalls(["wechat.code2Session"]);
      expect(h.txRuns()).toBe(runs);
    },
    SLOW,
  );
});

describe("静默登录、退出、当前账号", () => {
  it(
    "没有身份、账号被禁用：needPhone，不写库；绑定过的微信静默登录发会话；退出后不能再静默登录",
    async () => {
      const tables = ["merchant_user", "wechat_identity", "user_session", "auth_event"];
      const unknown = h.codes({ openid: nextOpenid(), phone: nextPhone() });
      const before = await snapshotTables(prisma, tables);
      expect(await h.identity.silentLogin(META, { loginCode: unknown.loginCode })).toEqual({
        needPhone: true,
        token: null,
        me: null,
      });
      assertSnapshotsEqual(before, await snapshotTables(prisma, tables));

      const user = await register();
      const again = () => h.codes({ openid: user.openid, phone: user.phone }).loginCode;
      const silent = await h.identity.silentLogin(META, {
        loginCode: again(),
        device: { model: "Mate 60" },
      });
      expect(silent.needPhone).toBe(false);
      expect(silent.me?.user.merchantUserId).toBe(user.userId);
      const check1 = await check(silent.token as string);
      expect(check1).toMatchObject({ ok: true });
      expect(await authEvents(user.userId)).toMatchObject([
        { event: "login_success", method: "phone" },
        { event: "login_success", method: "silent" },
      ]);

      // 退出：当前会话吊销、这个微信的静默登录关掉、auth_event；另一条会话不受影响
      if (!check1.ok) throw new Error("本该有效");
      await h.identity.logout(check1.principal, META);
      expect(await check(silent.token as string)).toEqual({ ok: false, reason: "revoked" });
      expect(await check(user.result.token)).toMatchObject({ ok: true });
      expect((await identityOf(user.openid))?.silentLoginEnabled).toBe(false);
      expect((await authEvents(user.userId)).at(-1)).toMatchObject({ event: "logout" });
      const frozen = await snapshotTables(prisma, tables);
      expect((await h.identity.silentLogin(META, { loginCode: again() })).needPhone).toBe(true);
      assertSnapshotsEqual(frozen, await snapshotTables(prisma, tables));

      // 重新验证手机号后恢复静默登录
      await h.identity.phoneLogin(META, {
        ...h.codes({ openid: user.openid, phone: user.phone }),
        consents: h.consents(),
      });
      expect((await h.identity.silentLogin(META, { loginCode: again() })).needPhone).toBe(false);

      // 账号被禁用：同样只说 needPhone
      await prisma.merchantUser.update({
        where: { id: user.userId },
        data: { status: "disabled" },
      });
      expect((await h.identity.silentLogin(META, { loginCode: again() })).needPhone).toBe(true);
    },
    SLOW,
  );

  it(
    "同一微信身份的会话超过 5 条：挤掉最旧的（evicted）；I25 查不出违规",
    async () => {
      const user = await register();
      const tokens = [user.result.token];
      for (let n = 0; n < MAX_SESSIONS_PER_IDENTITY + 1; n += 1) {
        h.clock.advance(MINUTE);
        const { loginCode } = h.codes({ openid: user.openid, phone: user.phone });
        tokens.push((await h.identity.silentLogin(META, { loginCode })).token as string);
      }
      const states = await Promise.all(tokens.map((token) => check(token)));
      expect(states.map((state) => state.ok)).toEqual([false, false, true, true, true, true, true]);
      const evicted = await prisma.userSession.findMany({
        where: { merchantUserId: user.userId, revokedAt: { not: null } },
      });
      expect(evicted.map((row) => row.revokeReason)).toEqual(["evicted", "evicted"]);
      expect(await findI25Violations(prisma)).toEqual([]);
    },
    SLOW,
  );

  it(
    "当前账号：一次性提示按发生时间倒序、文案按北京时间拼；已关闭的不出",
    async () => {
      const user = await register();
      const at = new Date("2026-10-02T01:14:00.000Z");
      const notice = (occurredAt: Date, ackedAt: Date | null = null) =>
        prisma.merchantUserNotice.create({
          data: {
            id: uuidv7(),
            merchantUserId: user.userId,
            kind: "new_wechat_bound",
            occurredAt,
            ackedAt,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        });
      await notice(at);
      const newer = await notice(new Date(at.getTime() + DAY));
      await notice(new Date(at.getTime() + 2 * DAY), h.clock.now());
      const me = await h.identity.me(user.userId);
      expect(me.notices.map((item) => item.userNoticeId)).toHaveLength(2);
      expect(me.notices[0]?.userNoticeId).toBe(newer.id);
      expect(me.notices[1]).toMatchObject({
        kind: "new_wechat_bound",
        occurredAt: at.toISOString(),
        message:
          "您的账号于 10-02 09:14 在一个新的微信上登录。如非本人操作，请到 我的 › 设置 › 账号与安全 移除该微信。",
      });
      expect(JSON.stringify(me)).not.toContain(user.phone);
    },
    SLOW,
  );
});

describe("协议同意的门、版本门槛", () => {
  it(
    "指纹相等只比字符串、不查同意记录；新版本生效后列出待同意的；小修订复核通过并回写指纹",
    async () => {
      const user = await register();
      const principal = async () => {
        const state = await check(user.result.token);
        if (!state.ok) throw new Error("本该有效");
        return state.principal;
      };
      const lookups = h.pendingLookups();
      expect(await h.identity.pendingConsents(await principal())).toEqual([]);
      expect(await h.identity.pendingConsents(await principal())).toEqual([]);
      expect(h.pendingLookups()).toBe(lookups);

      // 一小时后生效的新版本（要重新同意）：缓存不跨过生效时刻，到点的第一次请求就拦
      const staff = await h.make.staff({ staffRoleKey: "super_admin" });
      const file = await h.make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
      const effectiveAt = new Date(h.clock.now().getTime() + 60 * MINUTE);
      const next = await h.make.agreementVersion({
        agreementKey: "privacy",
        status: "pending",
        effectiveAt,
        isReconsentRequired: true,
        createdByStaffId: staff.id,
        pdfFileId: file.id,
      });
      h.identity.consentGate.invalidate();
      expect(await h.identity.pendingConsents(await principal())).toEqual([]);
      h.clock.advance(60 * MINUTE - 1);
      expect(await h.identity.pendingConsents(await principal())).toEqual([]);
      h.clock.advance(1);
      const pending = await h.identity.pendingConsents(await principal());
      expect(pending).toMatchObject([{ agreementKey: "privacy", agreementVersionId: next.id }]);
      expect(h.pendingLookups()).toBe(lookups + 1);

      // 手机号登录带着新版本的同意：指纹写成新的，之后又只比字符串
      h.versions.privacy = next;
      await h.identity.phoneLogin(META, {
        ...h.codes({ openid: user.openid, phone: user.phone }),
        consents: h.consents(),
      });
      const settled = h.pendingLookups();
      expect(await h.identity.pendingConsents(await principal())).toEqual([]);
      expect(h.pendingLookups()).toBe(settled);

      // 小修订（不用重新同意）：指纹变了，复核通过即回写，下一次不再查
      const minor = await h.make.agreementVersion({
        agreementKey: "user",
        status: "pending",
        effectiveAt: h.clock.now(),
        isReconsentRequired: false,
        createdByStaffId: staff.id,
        pdfFileId: file.id,
      });
      h.versions.user = minor;
      h.clock.advance(MINUTE + 1);
      const stale = await principal();
      expect(await h.identity.pendingConsents(stale)).toEqual([]);
      expect(h.pendingLookups()).toBe(settled + 1);
      const fresh = await principal();
      expect(fresh.consentStamp).not.toBe(stale.consentStamp);
      expect(fresh.consentStamp).toBe((await h.docs.consentStamps(prisma)).user);
      expect(await h.identity.pendingConsents(fresh)).toEqual([]);
      expect(h.pendingLookups()).toBe(settled + 1);
    },
    SLOW,
  );

  it("版本门槛：低于最低版本即过低；没带、写法不对的版本号按 0.0.0 算；最低版本是 0.0.0 时都放行", async () => {
    expect(await h.identity.isClientOutdated(null)).toBe(false);
    expect(await h.identity.isClientOutdated("0.0.1")).toBe(false);
    h.minClientVersion = "1.4.0";
    try {
      expect(await h.identity.isClientOutdated("1.3.9")).toBe(true);
      expect(await h.identity.isClientOutdated("1.4.0")).toBe(false);
      expect(await h.identity.isClientOutdated("2.0.0")).toBe(false);
      expect(await h.identity.isClientOutdated(null)).toBe(true);
      expect(await h.identity.isClientOutdated("abc")).toBe(true);
    } finally {
      h.minClientVersion = "0.0.0";
    }
  });
});

describe("模块完整：五条不变量", () => {
  it(
    "跑完上面全部用例之后 0 违规；造出违规的行能查出来",
    async () => {
      expect(await findI8Violations(prisma)).toEqual([]);
      expect(await findI9Violations(prisma)).toEqual([]);
      expect(await findI22Violations(prisma)).toEqual([]);
      expect(await findI23Violations(prisma)).toEqual([]);
      expect(await findI25Violations(prisma)).toEqual([]);

      // I25：绕过用例直接插第 6 条未吊销的会话
      const user = await register();
      const identity = await identityOf(user.openid);
      const now = h.clock.now();
      for (let n = 0; n < MAX_SESSIONS_PER_IDENTITY; n += 1) {
        await prisma.userSession.create({
          data: {
            id: uuidv7(),
            merchantUserId: user.userId,
            wechatIdentityId: identity?.id as string,
            tokenHash: Buffer.alloc(32, n + 1),
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
            idleExpiresAt: new Date(now.getTime() + DAY),
            absoluteExpiresAt: new Date(now.getTime() + 2 * DAY),
            lastIp: "198.51.100.7",
          },
        });
      }
      expect(await findI25Violations(prisma)).toEqual([
        {
          subject: { type: "wechat_identity", id: identity?.id },
          detail: { limit: 5, liveSessions: 6 },
        },
      ]);
    },
    SLOW,
  );
});
