// 后台登录链路的接口层用例（任务书 W1-01a 第 7 节验收 8；a01 第 3.1–3.8、3.11 节；约定 C4、C7、C66、C86）。
// 连真库（库里先播种：员工行的外键指着 8 个角色），生产的处理器清单配生产的装配，后台鉴权链是真的那一条。
// 九条的 operationId 以字符串字面量写在这里（“已落地”的判定按它认“有接口层测试”）：
//   "admin.auth.login"、"admin.auth.verifyMfa"、"admin.auth.activate"、"admin.auth.setPassword"、
//   "admin.auth.enrollTotp"、"admin.auth.confirmTotp"、"admin.auth.stepUp"、"admin.auth.me.get"、
//   "admin.session.current.delete"
// 一条主线贯穿到底（引导 → 激活四步 → 当前员工 → 退出 → 登录两步 → 再验证与重放），几条用例共用一个应用、一只时钟：
// 时钟只往前拨；登录前的请求各换一个来源 IP，免得挤占“每 IP 每分钟 10 次”的额度。
import { STEP_UP_PERMISSION_KEYS } from "@liyoxi/contract";
import { authz, runSeed, uuidv7 } from "@liyoxi/services";
import { signInAsStaff, totpNow } from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { HANDLERS } from "../src/routes/index.js";
import { useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";

import { ADMIN_SAMPLE_HANDLERS, adminExecutions } from "./admin-fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 120_000 };
const MINUTE = 60_000;

const ORIGIN = "http://localhost";
const WRITE = { "x-lyx-admin": "1", origin: ORIGIN };
const PHONE = "13900010001";
// 合规的口令（至少 10 位、有字母有数字）；与 staff 的用例夹具用同一个
const PASSWORD = "Liyoxi-2026-ok";

let app: TestApi;
/** 主线上传下去的东西 */
const state = {
  activationCode: "",
  ticket: "",
  secret: "",
  cookie: "",
  deviceCookie: "",
  recoveryCodes: [] as string[],
};

let peerSeq = 0;
/** 登录前的请求：每次换一个来源 IP */
const freshPeer = (): string => `198.19.${Math.floor(peerSeq / 250)}.${(peerSeq++ % 250) + 1}`;

const post = (path: string, json: unknown, headers: Record<string, string> = WRITE) =>
  app.request(`/api/v1/admin${path}`, { method: "POST", json, headers, peer: freshPeer() });

const errorOf = async (response: Response) => {
  const body = (await response.json()) as { error: string; message: string; details?: unknown };
  return { status: response.status, error: body.error, message: body.message, body };
};
const dataOf = async <T>(response: Response): Promise<T> => {
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: T }).data;
};

/** Set-Cookie 里某个 Cookie 的那一行 */
const setCookieOf = (response: Response, name: string): string | undefined =>
  response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
const valueOf = (line: string | undefined): string => (line ?? "").split(";")[0] ?? "";

beforeAll(async () => {
  app = await testApi.start({ handlers: [...HANDLERS, ...ADMIN_SAMPLE_HANDLERS] });
  await runSeed({ tx: app.runtime.tx, clock: app.clock });
  const first = await app.runtime.staffAuth.bootstrap({ name: "首位管理员", phone: PHONE });
  state.activationCode = first.activationCode;
}, 120_000);

describe("防跨站：后台的非 GET 请求", () => {
  it(
    "缺 X-LYX-Admin、缺 Origin、Origin 不同源：403 ORIGIN_REJECTED，登录前的接口也一样",
    TIMEOUT,
    async () => {
      const body = { phone: PHONE, password: "whatever-1" };
      const variants: Record<string, string>[] = [
        { origin: ORIGIN },
        { "x-lyx-admin": "1" },
        { "x-lyx-admin": "1", origin: "http://evil.example" },
        { "x-lyx-admin": "1", origin: "http://localhost.evil.example" },
        { "x-lyx-admin": "1", origin: "null" },
        { "x-lyx-admin": "0", origin: ORIGIN },
      ];
      for (const headers of variants) {
        expect(await errorOf(await post("/auth/login", body, headers))).toMatchObject({
          status: 403,
          error: "ORIGIN_REJECTED",
        });
      }
      // 域名属于后台才算同源：api 域名带着自己的 Origin 也不行（host-guard 先回 404）
      const wrongSurface = await app.request("/api/v1/admin/auth/login", {
        method: "POST",
        json: body,
        headers: { "x-lyx-admin": "1", host: "api.lyxtest.cn", origin: "https://api.lyxtest.cn" },
        peer: freshPeer(),
      });
      expect(wrongSurface.status).toBe(404);
      // 后台域名、同源：过得了这一关（密码不对，401）
      const adminHost = await app.request("/api/v1/admin/auth/login", {
        method: "POST",
        json: body,
        headers: {
          "x-lyx-admin": "1",
          host: "admin.lyxtest.cn",
          origin: "https://admin.lyxtest.cn",
        },
        peer: freshPeer(),
      });
      expect(await errorOf(adminHost)).toMatchObject({ status: 401, error: "AUTH_FAILED" });
      // 端口不比：本地整套环境走网关的 8080 端口，转给 api 的 Host 不带端口，浏览器的 Origin 带
      const viaGateway = await app.request("/api/v1/admin/auth/login", {
        method: "POST",
        json: { phone: "13900019998", password: "whatever-1" },
        headers: {
          "x-lyx-admin": "1",
          host: "admin.localhost",
          origin: "http://admin.localhost:8080",
        },
        peer: freshPeer(),
      });
      expect(await errorOf(viaGateway)).toMatchObject({ status: 401, error: "AUTH_FAILED" });
    },
  );
});

describe("激活四步", () => {
  it(
    "admin.auth.activate：激活码不对 401 AUTH_FAILED；对了给 set_password 票据",
    TIMEOUT,
    async () => {
      expect(
        await errorOf(await post("/auth/activate", { phone: PHONE, activationCode: "ZZZZ9999" })),
      ).toMatchObject({ status: 401, error: "AUTH_FAILED" });
      const response = await post("/auth/activate", {
        phone: PHONE,
        activationCode: state.activationCode.toLowerCase(),
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const next = await dataOf<{ next: string; ticket: string; methods: string[] }>(response);
      expect(next).toMatchObject({ next: "set_password", methods: [] });
      state.ticket = next.ticket;
    },
  );

  it(
    "admin.auth.setPassword：口令不合规 400 并列出规则；合规给 enroll_totp 票据；票据不对 401",
    TIMEOUT,
    async () => {
      expect(
        await errorOf(
          await post("/auth/set-password", { ticket: state.ticket, newPassword: "short1" }),
        ),
      ).toMatchObject({
        status: 400,
        error: "PASSWORD_POLICY_VIOLATED",
        body: { details: { rules: ["min_length"] } },
      });
      expect(
        await errorOf(
          await post("/auth/set-password", { ticket: "not-a-ticket", newPassword: PASSWORD }),
        ),
      ).toMatchObject({ status: 401, error: "AUTH_TICKET_INVALID" });
      const next = await dataOf<{ next: string; ticket: string }>(
        await post("/auth/set-password", { ticket: state.ticket, newPassword: PASSWORD }),
      );
      expect(next.next).toBe("enroll_totp");
      state.ticket = next.ticket;
    },
  );

  it("admin.auth.enrollTotp：给密钥与扫码地址，不缓存", TIMEOUT, async () => {
    const response = await post("/auth/enroll-totp", { ticket: state.ticket });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const enrollment = await dataOf<{ otpauthUri: string; secret: string; ticket: string }>(
      response,
    );
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.otpauthUri).toContain(`secret=${enrollment.secret}`);
    state.secret = enrollment.secret;
    state.ticket = enrollment.ticket;
  });

  it(
    "admin.auth.confirmTotp：口令不对 400 可重输；对了建会话、写两个 Cookie、给 10 个恢复码",
    TIMEOUT,
    async () => {
      expect(
        await errorOf(await post("/auth/confirm-totp", { ticket: state.ticket, code: "000000" })),
      ).toMatchObject({ status: 400, error: "MFA_CODE_INVALID" });
      const response = await post("/auth/confirm-totp", {
        ticket: state.ticket,
        code: totpNow(state.secret, app.clock),
      });
      const result = await dataOf<{
        me: {
          staff: { roleKey: string; status: string };
          permissions: string[];
          dataScope: string;
        };
        recoveryCodes: string[];
      }>(response);
      expect(result.recoveryCodes).toHaveLength(10);
      expect(result.me).toMatchObject({
        staff: { roleKey: "super_admin", status: "active" },
        dataScope: "all",
      });
      // 超级管理员持有 V1.0 的全部权限点
      expect(result.me.permissions).toEqual([...authz.V1_PERMISSION_KEYS].sort());

      const session = setCookieOf(response, "lyx_admin");
      const device = setCookieOf(response, "lyx_dev");
      expect(session).toMatch(/; Path=\/; HttpOnly; SameSite=Strict$/);
      expect(session).not.toMatch(/Max-Age|Expires/);
      expect(device).toMatch(/Max-Age=7776000; Path=\/; HttpOnly; SameSite=Strict$/);
      state.cookie = valueOf(session);
      state.deviceCookie = valueOf(device);
      state.recoveryCodes = result.recoveryCodes;
    },
  );
});

describe("会话", () => {
  it(
    "admin.auth.me.get：带会话 Cookie 给当前员工；没带 401 AUTH_REQUIRED；拿票据当 Cookie 401 SESSION_INVALID",
    TIMEOUT,
    async () => {
      const response = await app.request("/api/v1/admin/auth/me", {
        headers: { cookie: state.cookie },
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const me = await dataOf<Record<string, unknown>>(response);
      expect(me).toMatchObject({
        staff: { name: "首位管理员", roleKey: "super_admin", isLead: false, status: "active" },
        phoneMask: "139****0001",
        roleName: "超级管理员",
        staffGroup: { name: "管理员组" },
        moduleLevels: { system: "e", report: "v" },
        dataScope: "all",
        wecomBindStatus: "none",
        mustChangePassword: false,
        recoveryCodesLeft: 10,
        session: { authMethod: "password+totp" },
        flags: { "release.partner": false, "export.enabled": true },
        serverTime: app.clock.now().toISOString(),
      });
      expect(Object.keys(me.moduleLevels as object)).toHaveLength(13);

      expect(await errorOf(await app.request("/api/v1/admin/auth/me"))).toMatchObject({
        status: 401,
        error: "AUTH_REQUIRED",
      });
      // 票据不是会话：访问不了业务接口
      const login = await dataOf<{ ticket: string }>(
        await post("/auth/login", { phone: PHONE, password: PASSWORD }),
      );
      for (const cookie of [`lyx_admin=${login.ticket}`, "lyx_admin=not-a-session"]) {
        expect(
          await errorOf(await app.request("/api/v1/admin/auth/me", { headers: { cookie } })),
        ).toMatchObject({ status: 401, error: "SESSION_INVALID" });
      }
    },
  );

  it(
    "admin.session.current.delete：缺请求头 403；退出后清掉会话 Cookie，旧 Cookie 下一次即 401",
    TIMEOUT,
    async () => {
      const path = "/api/v1/admin/sessions/current";
      expect(
        await errorOf(
          await app.request(path, { method: "DELETE", headers: { cookie: state.cookie } }),
        ),
      ).toMatchObject({ status: 403, error: "ORIGIN_REJECTED" });

      const response = await app.request(path, {
        method: "DELETE",
        headers: { ...WRITE, cookie: state.cookie },
      });
      expect(await dataOf<null>(response)).toBeNull();
      expect(setCookieOf(response, "lyx_admin")).toMatch(/^lyx_admin=; Max-Age=0; Path=\//);
      expect(setCookieOf(response, "lyx_dev")).toBeUndefined();
      expect(
        await errorOf(
          await app.request("/api/v1/admin/auth/me", { headers: { cookie: state.cookie } }),
        ),
      ).toMatchObject({ status: 401, error: "SESSION_INVALID" });
    },
  );
});

describe("登录两步", () => {
  it(
    "admin.auth.login：账号不存在与密码错同一个 401、同一文案；密码对了给 mfa 票据",
    TIMEOUT,
    async () => {
      const wrong = await errorOf(
        await post("/auth/login", { phone: PHONE, password: "nope-12345" }),
      );
      const unknown = await errorOf(
        await post("/auth/login", { phone: "13900019999", password: PASSWORD }),
      );
      expect(wrong).toMatchObject({ status: 401, error: "AUTH_FAILED" });
      expect({ ...unknown.body, requestId: "" }).toEqual({ ...wrong.body, requestId: "" });

      const next = await dataOf<{ next: string; ticket: string; methods: string[] }>(
        await post(
          "/auth/login",
          { phone: PHONE, password: PASSWORD },
          { ...WRITE, cookie: state.deviceCookie },
        ),
      );
      expect(next).toMatchObject({ next: "mfa", methods: ["totp", "recovery"] });
      state.ticket = next.ticket;
    },
  );

  it(
    "admin.auth.verifyMfa：同一时间步的口令重放 401；下一步的口令建会话，回 StaffMe 与 Cookie",
    TIMEOUT,
    async () => {
      // 确认绑定时用掉了当前这一步
      expect(
        await errorOf(
          await post("/auth/verify-mfa", {
            ticket: state.ticket,
            method: "totp",
            code: totpNow(state.secret, app.clock),
          }),
        ),
      ).toMatchObject({ status: 401, error: "AUTH_FAILED" });

      app.clock.advance(31_000);
      const response = await post(
        "/auth/verify-mfa",
        { ticket: state.ticket, method: "totp", code: totpNow(state.secret, app.clock) },
        { ...WRITE, cookie: state.deviceCookie },
      );
      const me = await dataOf<{
        staff: { roleKey: string };
        session: { stepUpValidUntil: string };
      }>(response);
      expect(me.staff.roleKey).toBe("super_admin");
      // 登录本身算一次第二因子验证
      expect(me.session.stepUpValidUntil).toBe(
        new Date(app.clock.now().getTime() + 10 * MINUTE).toISOString(),
      );
      state.cookie = valueOf(setCookieOf(response, "lyx_admin"));
      expect(state.cookie).not.toBe("");
    },
  );
});

describe("再验证", () => {
  const replace = (key: string, thingId: string) =>
    app.request(`/api/v1/admin/lyxtest-roles/${thingId}`, {
      method: "PUT",
      headers: { ...WRITE, cookie: state.cookie, "Idempotency-Key": key },
    });
  const signedPost = (path: string) =>
    app.request(`/api/v1/admin${path}`, {
      method: "POST",
      headers: { ...WRITE, cookie: state.cookie },
    });

  it(
    "登录后 10 分钟内标了再验证的权限点不用再验证；超出窗口 403 STEP_UP_REQUIRED，处理器没有执行",
    TIMEOUT,
    async () => {
      expect(STEP_UP_PERMISSION_KEYS).toContain("sys.role.edit");
      const before = adminExecutions.stepUp;
      expect((await replace(`replace:${uuidv7()}`, uuidv7())).status).toBe(200);
      expect(adminExecutions.stepUp).toBe(before + 1);

      app.clock.advance(11 * MINUTE);
      expect(await errorOf(await replace(`replace:${uuidv7()}`, uuidv7()))).toMatchObject({
        status: 403,
        error: "STEP_UP_REQUIRED",
      });
      expect(adminExecutions.stepUp).toBe(before + 1);
    },
  );

  it("x-step-up: skip 的路由不查；处理器内判定的查同一个窗口", TIMEOUT, async () => {
    expect((await signedPost(`/lyxtest-roles/${uuidv7()}/reject`)).status).toBe(200);
    expect(await errorOf(await signedPost(`/lyxtest-roles/${uuidv7()}/reveal`))).toMatchObject({
      status: 403,
      error: "STEP_UP_REQUIRED",
    });
  });

  it(
    "admin.auth.stepUp：口令不对 400 不吊销会话；验证后用原幂等键重放成功，再重放不再执行",
    TIMEOUT,
    async () => {
      const key = `replace:${uuidv7()}`;
      const thingId = uuidv7();
      expect(await errorOf(await replace(key, thingId))).toMatchObject({
        error: "STEP_UP_REQUIRED",
      });

      const stepUp = (code: string) =>
        app.request("/api/v1/admin/auth/step-up", {
          method: "POST",
          json: { method: "totp", code },
          headers: { ...WRITE, cookie: state.cookie },
        });
      expect(await errorOf(await stepUp("000000"))).toMatchObject({
        status: 400,
        error: "MFA_CODE_INVALID",
      });
      const result = await dataOf<{ stepUpValidUntil: string }>(
        await stepUp(totpNow(state.secret, app.clock)),
      );
      expect(result.stepUpValidUntil).toBe(
        new Date(app.clock.now().getTime() + 10 * MINUTE).toISOString(),
      );

      const before = adminExecutions.stepUp;
      const first = await replace(key, thingId);
      expect(first.status).toBe(200);
      expect(first.headers.get("Idempotent-Replayed")).toBeNull();
      const replayed = await replace(key, thingId);
      expect(replayed.status).toBe(200);
      expect(replayed.headers.get("Idempotent-Replayed")).toBe("true");
      expect(await replayed.json()).toEqual(await first.json());
      expect(adminExecutions.stepUp).toBe(before + 1);
      // 处理器内判定的那条现在也过了
      expect((await signedPost(`/lyxtest-roles/${uuidv7()}/reveal`)).status).toBe(200);
    },
  );

  it("恢复码也能再验证，用掉即少一个", TIMEOUT, async () => {
    const response = await app.request("/api/v1/admin/auth/step-up", {
      method: "POST",
      json: { method: "recovery", code: state.recoveryCodes[0] },
      headers: { ...WRITE, cookie: state.cookie },
    });
    expect(response.status).toBe(200);
    const me = await dataOf<{ recoveryCodesLeft: number }>(
      await app.request("/api/v1/admin/auth/me", { headers: { cookie: state.cookie } }),
    );
    expect(me.recoveryCodesLeft).toBe(9);
  });
});

describe("defineAdminHandler 给处理器的范围", () => {
  it(
    "模块等级是“本人任务”时 taskScope 只含本人、不带待分配池；别的等级就是数据范围本身",
    TIMEOUT,
    async () => {
      const prisma = await testApi.db.prisma();
      const submit = async (headers: Record<string, string>) =>
        dataOf<{ scope: unknown; taskScope: unknown }>(
          await app.request(`/api/v1/admin/lyxtest-delivery/${uuidv7()}/submit`, {
            method: "POST",
            headers,
          }),
        );
      // 剪辑师主管：交付模块是“本人任务”，数据范围是本组（组里另有一位剪辑师）
      const peer = await signInAsStaff(prisma, { roleKey: "editor", now: app.clock.now() });
      const editor = await signInAsStaff(prisma, {
        roleKey: "editor",
        isLead: true,
        now: app.clock.now(),
      });
      const own = await submit(editor.headers);
      expect(own.taskScope).toEqual({ kind: "staff", staffIds: [editor.staff.id], unassigned: [] });
      expect(own.scope).toMatchObject({
        kind: "staff",
        staffIds: expect.arrayContaining([editor.staff.id, peer.staff.id]),
      });
      // 交付经理：交付模块是编辑，两者相同
      const manager = await signInAsStaff(prisma, {
        roleKey: "delivery_manager",
        now: app.clock.now(),
      });
      const edit = await submit(manager.headers);
      expect(edit.taskScope).toEqual(edit.scope);
    },
  );
});
