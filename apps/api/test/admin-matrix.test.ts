// 权限矩阵回放（任务书 W1-01a 第 7 节验收 9；D4 第 11.3 节）。
// 已挂载、要会话的后台路由 × 8 个角色 × 主管与否：期望由声明算出（模块等级取 defineAdminHandler 的声明，
// 权限点取路由的 x-permission，角色取代码默认配置），先与黄金文件逐字比对，再对应用逐格发请求，
// 比“是不是 403 PERMISSION_DENIED”。回放时处理器换成空壳：只看鉴权链的结论，不执行业务。
//
// 黄金文件 golden/admin-permission-matrix.txt 一条路由一行。之后每个后台接口包合并时只增自己路由的行，不手改：
//   LYX_UPDATE_GOLDEN=1 pnpm exec vitest run --project api test/admin-matrix.test.ts
// 已有的行变了（改了某条路由的模块要求或权限点、改了角色的默认配置）要在 PR 描述里说明。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  adminRoute,
  defaultRoleActions,
  okResponse,
  STAFF_ROLE_DEFAULTS,
  z,
} from "@liyoxi/contract";
import type { StaffRoleKey } from "@liyoxi/contract";
import { authz, uuidv7 } from "@liyoxi/services";
import type { StaffContext } from "@liyoxi/services";
import { signInAsStaff } from "@liyoxi/services/testing";
import { describe, expect, it } from "vitest";

import { accessRequirementOf } from "../src/http/admin/authz.js";
import { ok } from "../src/http/errors.js";
import { HANDLERS } from "../src/routes/index.js";
import { defineAdminHandler } from "../src/routing/admin.js";
import { defineHandler } from "../src/routing/define.js";
import type { HandlerEntry } from "../src/routing/define.js";
import { MountError } from "../src/routing/mount.js";
import { useTestApi } from "../src/testing/index.js";

import { ADMIN_SAMPLE_HANDLERS } from "./admin-fixtures.js";

const GOLDEN = fileURLToPath(new URL("../golden/admin-permission-matrix.txt", import.meta.url));
const HEADER = [
  "# 后台权限矩阵的黄金文件（W1-01a；D4 第 11.3 节）。已挂载、要会话的后台路由一条一行，按 operationId 排。",
  "# 各栏：operationId | 模块要求（模块:view 或 edit；没有写 -）| 权限点（没有写 -）| 8 个角色各两格（非主管、主管）：1 放行，0 拒绝",
  `# 角色的先后：${STAFF_ROLE_DEFAULTS.map((role) => role.key).join(" ")}（按角色的代码默认配置算）`,
  "# 不手改，用命令重写：LYX_UPDATE_GOLDEN=1 pnpm exec vitest run --project api test/admin-matrix.test.ts",
];

const testApi = useTestApi();
const TIMEOUT = { timeout: 180_000 };

interface Cell {
  readonly roleKey: StaffRoleKey;
  readonly isLead: boolean;
}
/** 16 格：角色照登记的先后，每个角色先非主管、后主管 */
const CELLS: readonly Cell[] = STAFF_ROLE_DEFAULTS.flatMap((role) => [
  { roleKey: role.key, isLead: false },
  { roleKey: role.key, isLead: true },
]);

/** 按代码默认配置建这一格的员工上下文 */
function contextOf(cell: Cell): StaffContext {
  const base = STAFF_ROLE_DEFAULTS.find((role) => role.key === cell.roleKey);
  if (base === undefined) throw new Error(`没有这个角色：${cell.roleKey}`);
  return authz.buildStaffContext({
    staff: { id: uuidv7(), roleKey: cell.roleKey, isLead: cell.isLead, staffGroupId: null },
    role: authz.normalizeRoleConfig(cell.roleKey, {
      moduleLevels: base.moduleLevels,
      actions: defaultRoleActions(cell.roleKey),
      dataScope: base.dataScope,
    }),
    groupStaffIds: [],
    stepUpAt: null,
  });
}
const CONTEXTS = CELLS.map(contextOf);

/** 进矩阵的路由：后台、要会话 */
const staffRoutes = (entries: readonly HandlerEntry[]): HandlerEntry[] =>
  entries
    .filter((entry) => entry.route.operationId.startsWith("admin."))
    .filter((entry) => entry.route["x-auth"] === "staff")
    .sort((a, b) => (a.route.operationId < b.route.operationId ? -1 : 1));

/** 一条路由的 16 格期望：true 放行 */
const expectedOf = (entry: HandlerEntry): boolean[] =>
  CONTEXTS.map((ctx) => authz.decideAccess(ctx, accessRequirementOf(entry.route)).allowed);

function lineOf(entry: HandlerEntry): string {
  const { module, permission } = accessRequirementOf(entry.route);
  const cells = expectedOf(entry).map((allowed) => (allowed ? "1" : "0"));
  const pairs = STAFF_ROLE_DEFAULTS.map((_, index) =>
    cells.slice(index * 2, index * 2 + 2).join(""),
  );
  return [
    entry.route.operationId,
    module === null ? "-" : `${module.module}:${module.need}`,
    permission ?? "-",
    pairs.join(" "),
  ].join(" | ");
}

const render = (entries: readonly HandlerEntry[]): string =>
  [...HEADER, ...staffRoutes(entries).map(lineOf), ""].join("\n");

/** 对应用逐格发请求，返回每条路由 16 格“是否放行”（不是 403 PERMISSION_DENIED 即放行） */
async function replay(entries: readonly HandlerEntry[]): Promise<Record<string, boolean[]>> {
  const routes = staffRoutes(entries);
  // 处理器换成空壳：声明（路由对象与 defineAdminHandler 登记的模块要求）原样，业务不执行
  const { request } = await testApi.start({
    handlers: routes.map((entry) => ({
      route: entry.route,
      handler: (c) => c.json({ code: 0, message: "ok", data: null }),
    })),
  });
  const prisma = await testApi.db.prisma();
  const sessions = [];
  for (const cell of CELLS) sessions.push(await signInAsStaff(prisma, cell));

  const actual: Record<string, boolean[]> = {};
  for (const { route } of routes) {
    const path = route.path.replace(/\{[A-Za-z0-9]+\}/g, () => uuidv7());
    const row: boolean[] = [];
    for (const session of sessions) {
      const response = await request(path, {
        method: route.method.toUpperCase(),
        headers: session.headers,
      });
      const denied =
        response.status === 403 &&
        ((await response.json()) as { error?: string }).error === "PERMISSION_DENIED";
      row.push(!denied);
    }
    actual[route.operationId] = row;
  }
  return actual;
}

const expectedTable = (entries: readonly HandlerEntry[]): Record<string, boolean[]> =>
  Object.fromEntries(
    staffRoutes(entries).map((entry) => [entry.route.operationId, expectedOf(entry)]),
  );

describe("权限矩阵回放", () => {
  it("生产清单里的后台路由：期望与黄金文件一致，逐格请求与期望一致", TIMEOUT, async () => {
    const rendered = render(HANDLERS);
    if (process.env.LYX_UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, rendered);
    expect(rendered).toBe(readFileSync(GOLDEN, "utf8"));
    // 进矩阵的就是生产清单里全部要会话的后台路由
    expect(staffRoutes(HANDLERS).map((entry) => entry.route.operationId)).toEqual(
      expect.arrayContaining([
        "admin.auth.me.get",
        "admin.auth.stepUp",
        "admin.session.current.delete",
      ]),
    );
    expect(await replay(HANDLERS)).toEqual(expectedTable(HANDLERS));
  });

  it(
    "样例路由（模块等级、权限点、仅主管、处理器内判定）：逐格请求与由声明算出的期望一致，且确有拒绝的格",
    TIMEOUT,
    async () => {
      const expected = expectedTable(ADMIN_SAMPLE_HANDLERS);
      const row = (operationId: string): string =>
        (expected[operationId] ?? []).map((allowed) => (allowed ? "1" : "0")).join("");
      // 期望本身先对几行手算的：财务模块查看；交付模块编辑（含“本人任务”）；仅主管的权限点；只有超级管理员持有的权限点
      expect(row("admin.lyxtestFinance.list")).toBe("1100000000000011");
      expect(row("admin.lyxtestDelivery.submit")).toBe("1100111100000000");
      expect(row("admin.lyxtestLink.revoke")).toBe("1100010001000000");
      expect(row("admin.lyxtestRole.replace")).toBe("1100000000000000");
      // 处理器内判定的路由，中间件不拦
      expect(row("admin.lyxtestRole.reveal")).toBe("1".repeat(16));
      expect(await replay(ADMIN_SAMPLE_HANDLERS)).toEqual(expected);
    },
  );
});

describe("后台路由的登记", () => {
  const route = (operationId: string, auth: "staff" | "public") =>
    adminRoute({
      method: "get",
      path: `/admin/lyxtest-unregistered/${auth}`,
      operationId,
      "x-auth": auth,
      "x-permission": null,
      responses: okResponse(z.null()),
    });

  it("要会话的后台路由没用 defineAdminHandler 登记：建应用即失败", TIMEOUT, async () => {
    const plain = defineHandler(route("admin.lyxtestUnregistered.get", "staff"), (c) =>
      ok(c, null),
    );
    const failure = await testApi.start({ handlers: [plain] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MountError);
    expect((failure as MountError).issues).toEqual([
      "admin.lyxtestUnregistered.get：中间件 authz 配不上：要会话的后台路由须用 defineAdminHandler 登记并声明模块等级（没有模块要求写 null）",
    ]);
  });

  it("公开的后台路由不能用 defineAdminHandler 登记", () => {
    expect(() =>
      defineAdminHandler(route("admin.lyxtestUnregistered.list", "public"), null, (c) =>
        ok(c, null),
      ),
    ).toThrow(/只登记 x-auth: staff 的后台路由/);
  });
});
