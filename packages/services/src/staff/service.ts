// staff 凭据与会话的装配入口（W1-01a）：进程启动时调一次 createStaffAuth，拿到九个接口对应的用例与引导用例。
// 接口层（第三个 PR）只做薄壳：解析 Cookie 与请求体、调这里、把结果写成响应与 Set-Cookie。
import { recordAuthEvent } from "../audit/index.js";
import { activate, confirmTotp, enrollTotp, setPassword } from "./activation.js";
import type { TotpEnrollment } from "./activation.js";
import { bootstrap } from "./bootstrap.js";
import type { BootstrapResult } from "./bootstrap.js";
import { login, stepUp, verifyMfa } from "./login.js";
import type { LoginInput, StepUpInput, VerifyMfaInput } from "./login.js";
import { createRoleCache } from "./roles.js";
import type { RoleCache } from "./roles.js";
import { authenticate, revokeSession } from "./session.js";
import type {
  AuthNext,
  RequestMeta,
  SignedIn,
  StaffAuthContext,
  StaffAuthDeps,
  StaffPrincipal,
} from "./types.js";

export interface StaffAuth {
  /** admin.auth.login：登录第一步 */
  login(input: LoginInput): Promise<AuthNext>;
  /** admin.auth.verifyMfa：登录第二步，建会话 */
  verifyMfa(input: VerifyMfaInput): Promise<SignedIn>;
  /** admin.auth.activate：凭激活码换设置密码的票据 */
  activate(input: { phone: string; activationCode: string }): Promise<AuthNext>;
  /** admin.auth.setPassword */
  setPassword(input: { ticket: string; newPassword: string; meta: RequestMeta }): Promise<AuthNext>;
  /** admin.auth.enrollTotp：生成动态口令密钥 */
  enrollTotp(input: { ticket: string }): Promise<TotpEnrollment>;
  /** admin.auth.confirmTotp：确认绑定并建会话；恢复码明文只出现这一次 */
  confirmTotp(input: {
    ticket: string;
    code: string;
    meta: RequestMeta;
  }): Promise<SignedIn & { recoveryCodes: string[] }>;
  /** admin.auth.stepUp：再验证 */
  stepUp(input: StepUpInput): Promise<{ stepUpValidUntil: Date }>;
  /** 每请求的会话校验（会话中间件调）；admin.auth.me.get 的数据也是它。失效即 401 SESSION_INVALID */
  authenticate(sessionToken: string): Promise<StaffPrincipal>;
  /** admin.session.current.delete：退出登录。重复退出无副作用 */
  logout(input: {
    principal: Pick<StaffPrincipal, "staff" | "session">;
    meta: RequestMeta;
  }): Promise<void>;
  /** 命令行 staff:bootstrap：建第一位超级管理员 */
  bootstrap(input: { name: string; phone: string }): Promise<BootstrapResult>;
  /** 角色与本组成员的缓存：本进程改过角色或分组之后调 invalidate() */
  readonly roles: RoleCache;
}

export function createStaffAuth(deps: StaffAuthDeps): StaffAuth {
  const roles = createRoleCache({
    db: deps.db,
    clock: deps.clock,
    ...(deps.roleCacheTtlMs === undefined ? {} : { ttlMs: deps.roleCacheTtlMs }),
  });
  const ctx: StaffAuthContext = { ...deps, roles };
  return {
    login: (input) => login(ctx, input),
    verifyMfa: (input) => verifyMfa(ctx, input),
    activate: (input) => activate(ctx, input),
    setPassword: (input) => setPassword(ctx, input),
    enrollTotp: (input) => enrollTotp(ctx, input),
    confirmTotp: (input) => confirmTotp(ctx, input),
    stepUp: (input) => stepUp(ctx, input),
    authenticate: (sessionToken) => authenticate(ctx, sessionToken),
    async logout({ principal, meta }) {
      const now = ctx.clock.now();
      await ctx.tx.run(async (handle) => {
        const revoked = await revokeSession(handle, {
          sessionId: principal.session.id,
          reason: "logout",
          now,
        });
        if (!revoked) return;
        await recordAuthEvent(handle, {
          space: "staff",
          subjectId: principal.staff.id,
          event: "logout",
          method: principal.session.authMethod,
          ip: meta.ip,
          userAgent: meta.userAgent ?? null,
          detail: { sessionId: principal.session.id, requestId: meta.requestId ?? null },
          at: now,
        });
      });
    },
    bootstrap: (input) => bootstrap(ctx, input),
    roles,
  };
}
