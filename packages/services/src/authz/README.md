# authz：后台的判定与数据范围

由 W1-01a 的第一个 PR 交付。依据：[D4](../../../../docs/appendix/design/d4-identity.md) 第 7.1–7.5、11.1 节；[约定](../../../../docs/api/00-conventions.md) C7、C54、C58、C66、C86；[a01](../../../../docs/api/a01-system.md) 第 2.3、2.9 节；[03 分组](../../../../docs/data-model/03-staff-authz-audit.md) 第 2.1、4 节。

后台每条接口的判权 = 模块等级 × 权限点（可带“仅主管”）× 数据范围，另有再验证与二次确认回显。本模块只做判定：全是纯函数，不读库、不开事务。员工行、角色行、本组成员由 `staff` 模块加载（会话校验时一并读出，角色与组员进程内缓存 5 秒），建成上下文后往下传。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `role-config.ts` | `normalizeRoleConfig`：把 `staff_role` 一行的三列规整成判定用的形状；`effectivePermissions`：此刻生效的权限点 |
| `context.ts` | `buildStaffContext`：一次请求的员工上下文 `StaffContext` |
| `decide.ts` | `decideAccess`、`assertAccess`、`authorize`、`assertPermission`、`hasPermission` |
| `step-up.ts` | 再验证：`assertStepUp`、`requiresStepUp`、`stepUpValidUntil`，窗口 `STEP_UP_TTL_MS`（10 分钟） |
| `confirm.ts` | 二次确认回显：`assertConfirm` |
| `data-scope.ts` | `DataScope` 与它的唯一产生处 `scopeOf`；`SYSTEM_SCOPE`、`ownTaskScope`、`scopeCovers`、`scopeSnapshot` |
| `scope.ts` | 范围谓词：`managedStore`、`storeScope`、`entityScope`、`byStore`、`byEntity`、`taskScope` |

## 2. 建上下文（staff 模块、测试支架用）

```ts
const role = authz.normalizeRoleConfig(roleKey, roleRow); // roleRow 是 staff_role 那一行，jsonb 原样给；可按角色缓存
const ctx = authz.buildStaffContext({
  staff: { id, roleKey, isLead, staffGroupId },
  role,
  groupStaffIds, // 本组成员的 id；没有分组给 []
  stepUpAt, // 会话的 stepup_at
});
// ctx.moduleLevels、ctx.permissions、ctx.dataScope（own / group / all）正是 StaffMe 要的三项；ctx.scope 交给仓储
```

规整的规矩（任何输入都不抛错，问题记在 `role.issues` 里，加载方打日志）：

- 缺的键取代码默认值（契约的 `STAFF_ROLE_DEFAULTS`、`defaultRoleActions`）；写坏的值当作缺。
- 注册表外的键丢弃。对这个角色不适用的权限点（注册表没给它登记默认值的键，如给客服开 `sys.role.edit`）同样丢弃：保存接口本来就不收（a01 第 3.35 节），读的一侧再拦一道。
- “本人任务”（`o`）写在交付、发布之外按写坏处理。
- 超级管理员持有 V1.0 的全部权限点，不看库里的 `actions`；模块等级照它那一行判（默认配置里数据报表只有查看）。
- V1.1 的键 V1.0 谁都不持有。`self.mfa.reset` 这种“全体员工”标记人人持有。

## 3. 判权（权限中间件、处理器用）

```ts
// 中间件：路由声明的要求。module 取自 defineAdminHandler 的第二个参数，permission 取自路由的 x-permission
authz.authorize(ctx, { module: { module: "finance", need: "view" }, permission: "finance.refund.execute" }, clock.now(), {
  skipStepUp: route["x-step-up"] === "skip", // 约定 C86 登记的驳回接口
});

// 处理器（x-permission: assert-in-handler）：权限点取决于对象或请求体，取到之后调
authz.assertPermission(ctx, "export.unmasked", clock.now());

// 事务里、锁住对象之后：二次确认回显。比哪几个字段由接口自己列
authz.assertConfirm(body.confirm, { refundNo: refund.refundNo, amountFen: refund.amountFen });
```

| 函数 | 不过时 |
| --- | --- |
| `authorize`：先模块等级与权限点，再按注册表查再验证 | 403 `PERMISSION_DENIED`；403 `STEP_UP_REQUIRED` |
| `assertAccess`：只查模块等级与权限点 | 403 `PERMISSION_DENIED` |
| `assertPermission`：持有这个权限点，且（标了再验证时）再验证没过期 | 同 `authorize` |
| `assertStepUp`：只查再验证 | 403 `STEP_UP_REQUIRED` |
| `assertConfirm` | 409 `CONFIRM_MISMATCH` |
| `decideAccess`：不抛错，返回 `{ allowed }` 与原因 | 权限矩阵的期望由它算 |

- `need: "view"` 要求等级不是 `n`；`need: "edit"` 要求 `e` 或 `o`。没有模块要求写 `module: null`；不设权限点写 `permission: null`。
- 权限点独立于编辑等级：带权限点的路由通常只要求 `view`（交付经理对订单只有查看，照样能发起补偿延长）。
- 权限点键、模块键的类型来自契约的注册表，写错编译不过；绕过类型硬传进来的按不过算。
- 再验证跟注册表走，路由不另声明。这两步都排在幂等上下文之前（约定 C7），再验证之后可以拿原幂等键重放。

## 4. 数据范围

`DataScope` 只能由本模块给出：类型上带品牌，外面写不出对象字面量；谓词在运行时也核对（`as` 转出来的、JSON 读回来的都不认）。

| 来源 | 什么时候用 |
| --- | --- |
| `ctx.scope`（`scopeOf` 算的） | 后台请求。角色范围与主管标记取较大者；待分配池只给主管，按他持有的分配类权限点定 |
| `ownTaskScope(ctx.staff)` | 模块等级是 `o` 时的写操作：只含本人、不带池 |
| `SYSTEM_SCOPE` | 定时器、订阅者、周期任务。代某个员工执行的任务（导出）不用它，按那名员工此刻的状态重建上下文 |

仓储函数第一个参数收 `DataScope`，把谓词 `AND` 进 `where`；范围之外与不存在都是 404，不作区分：

```ts
export async function getStore(db: Db, scope: DataScope, id: string) {
  const store = await db.store.findFirst({ where: { AND: [{ id }, authz.storeScope(scope)] } });
  if (store === null) throw new AppError("NOT_FOUND");
  return store;
}

// 任务类资源：列名受类型约束，写错编译不过
const ticketScope = (scope: DataScope) =>
  authz.taskScope<Prisma.DeliveryTicketWhereInput>(scope, {
    assignees: [
      { col: "deliveryManagerId" },
      { col: "editorId", pool: "ticket_editor" },
      { col: "publisherId", pool: "ticket_publisher" },
    ],
  });
const adScope = (scope: DataScope) =>
  authz.taskScope<Prisma.AdWhereInput>(scope, {
    store: (where) => ({ store: where }), // 门店归我（们）负责的也算
    assignees: [{ col: "editorId", pool: "ad_editor" }],
  });
```

| 谓词 | 含义 |
| --- | --- |
| `managedStore` | 我（们）负责的门店；有 `store_manager` 池时加上待分配的营业中门店 |
| `storeScope` | 负责它，或名下有分派给我（们）、还没结束的任务（未归档未终止的工单的剪辑师或发布专员；未确认未取消的广告的剪辑师） |
| `entityScope` | 名下有可见门店的主体 |
| `byStore`、`byEntity` | 挂在门店、主体下的资源（模型上的关系字段叫 `store`、`entity`） |
| `taskScope` | 负责人列在集合内，或有对应的池且负责人为空；给了 `store` 时门店归我（们）负责的也算 |

要留意的：

- 门店级谓词只在 `scope.ts` 一处，别的模块不自己拼 `deliveryManagerId`、`IS NULL`。
- 带范围的仓储函数只返回资源自身的列与“向下”的子资源；主体下的门店、门店下的任务另调各自带范围的函数（不用 `include` 把兄弟数据带出来）。
- 交付工单用自己的三个负责人列，不给 `store`：转移交付经理时在办工单一并移交，已归档的保留原负责人。
- 待分配池是“这一列为空”的全部行，不分环节；要按环节收窄的由资源自己再 `AND` 条件。
- 指派时核对“被指派的人在我的范围内”用 `scopeCovers(ctx.scope, staffId)`。
- 审计与导出任务要记范围时用 `scopeSnapshot(scope)`；快照只作记录，变不回 `DataScope`。

## 5. 测试

```sh
pnpm --filter @liyoxi/services exec vitest run src/authz/
```

- `decide.test.ts`：8 角色 × 13 模块 × 两种需求、每个 V1.0 权限点 × 8 角色 × 主管与否，逐格对契约的等级矩阵与注册表的默认授予。
- `authz.property.test.ts`：性质，固定种子、每个性质 200 轮；加大或复现用 `LYX_FC_RUNS`、`LYX_FC_SEED`（写法见文件开头）。
- `scope.test.ts`、`scope.db.test.ts`：范围的取值与谓词的条件；连库的一份要本地的 PostgreSQL 与 `DATABASE_URL`，用带种子的库。
- `role-config.test.ts`、`step-up-confirm.test.ts`：规整、再验证、回显。

## 6. 还没有的

- 角色与本组成员的加载与缓存、会话、`signInAsStaff` 在 `staff` 模块；权限中间件、`defineAdminHandler`、权限矩阵回放与黄金文件在 `apps/api`（它的说明第 7 节）。包入口已给出本模块：`import { authz } from "@liyoxi/services"`。
- “本人任务”（`o`）的写操作用哪个范围，只在 `defineAdminHandler` 给处理器的 `taskScope` 一处定（等级是 `o` 时即 `ownTaskScope`），处理器与仓储不各自判断等级。
- 原生 SQL 用的范围片段（D4 第 7.3 节的 `scopeSql`）：没有做，第一个要写带范围的原生查询的包（报表）来加，与这里的谓词放在一处。
