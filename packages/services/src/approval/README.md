# approval：统一审批单的执行器框架

各域的“申请—审批”共用的做法（W1-06）：审批单的状态、状态历史、审计、事件由本模块写，领域的效果由该类型登记的处理器在同一个事务里做。依据：[03 分组](../../../../docs/data-model/03-staff-authz-audit.md) 第 2.12、3.2、4 节；[约定](../../../../docs/api/00-conventions.md) C67、C86、C53；[a03](../../../../docs/api/a03-merchant.md) 第 1.1 节“审批决定的守卫顺序”“留痕”；[x01](../../../../docs/api/x01-events-jobs.md) 第 3.3 节；D4 第 7.6 节。

第一个 PR 交写侧，第二个 PR 交读侧三条接口（`admin.approval.list`、`summary`、`get`）、`countTodo`、`decisionView`，以及后台原因下拉 `admin.dictItem.list`。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `runtime.ts` | `createApproval`：装配入口，给出四个写函数与 `recordExecuted`；`approvalKindsOf`：登记的校验 |
| `kinds.ts` | 按键端口 `approvalKindPort`（键是 `kind`）与登记类型 `ApprovalKindRegistration` |
| `submit.ts` | `submit` |
| `decide.ts` | `approve`、`reject`、`withdraw` 与守卫 |
| `execute.ts` | `recordExecuted` |
| `machine.ts` | 审批单状态机在 flow 上的登记：守卫、处理器的挂点、随迁列 |
| `invariants.ts`、`sla-invariants.ts`、`register.ts` | `approval.I1`–`I5` 的查询与登记；端口的声明 |
| `repo.ts` | 本模块读写库的语句 |
| `read.ts` | 可读类型与数据范围、当前动作、列表、计数与详情；GET 不写库 |
| `errors.ts` | `ApprovalError`：内部错误 |
| `sla.ts`、`touch.ts` | 决定时限、日历订阅、超期 timer；待审内容更正只升版本 |

## 2. 装配

```ts
const flow = createFlow({ assembly, clock, events });
const approval = createApproval({ assembly, clock, flow, events, bizNo, sla, timers }); // api、worker 启动时各一次
const unbindSla = bindApprovalSla({ clock, flow, events, sla, timers, kinds: approval.kinds });
```

构造时把各模块登记的审批类型对照 03 分组 第 3.2 节校验一遍（键是不是 12 个类型之一、大类、有无执行步、去重键的有无、单号前缀、表名写法），写错的一次列全，抛 `ApprovalError`。worker 也要建：`approval.I1` 要的领域表取自这里绑上的登记，没建的进程里 I1 没有可查的类型。

## 3. 登记一个审批类型

拥有领域表的模块在自己的 `register.ts` 里：

```ts
import { approvalKindPort, defineApprovalKind } from "../approval/index.js";

export const registration = defineRegistration("profile", {
  portImplementations: [
    implementKeyed(
      approvalKindPort,
      "qualification",
      defineApprovalKind<{ submissionId: string; roundNo: number }>({
        category: "review", // 审核类写 activity 流；员工发起的审批写 ops 流
        domain: { table: "qualification_submission", column: "approval_request_id" },
        viewModules: ["merchant"], // 查看所需的模块等级：有一个不低于“查看”即可读
        decidePermission: "merchant.qualification.review",
        groupBound: false, // 仅限发起人所在组的主管审批（补偿延长）
        hasExecution: false,
        numberPrefix: null, // TK、TZ、YQ、ZH 或 null
        dedupeKey: (s) => `qualification:${String(s.storeId)}`, // 有执行步的四类不给
        roundNo: (_tx, s) => Promise.resolve(s.input.roundNo), // 不给即 1
        operations: { get: "admin.qualificationSubmission.get", approve: "…", reject: "…", withdraw: null },
        validate: async (tx, s) => {}, // 提交前校验，不满足抛 AppError
        summarize: async (tx, s) => ({ title: "…", lines: [], domain: { type: "qualification_submission", id: s.input.submissionId } }),
        revalidate: async (tx, row, args) => {}, // 通过前重算业务前提：变了抛 AppError("PRECONDITION_CHANGED")
        onApproved: async (tx, row, decision) => {}, // 领域行自己锁、自己改
        onRejected: async (tx, row, decision) => {},
        onWithdrawn: async (tx, row, decision) => {},
        // 可选：roleQueue（角色队列，不套数据范围）、badges（读队列时的角标）、handlerOf（当前处理人）
      }),
    ),
  ],
});
```

- 六个处理器都在审批单迁移的同一个事务里调。次序：守卫 → `revalidate`（只在通过时）→ 改状态、写状态历史 → `onApproved` / `onRejected` / `onWithdrawn` → 审计 → 事件。任何一步抛错，调用方的事务回滚，审批单保持原状。
- 摘要按契约的 `ApprovalSummary` 校验（`title` 必有；不收登记之外的键）：不放证照号、银行账号等明文。
- 没登记的 `kind` 调 `submit` 抛 `ApprovalError`。本模块不登记任何真实类型：`qualification` 归 profile，`channel_account`、`launch_link` 归 publish，其余随各自的里程碑。

## 4. 四个写函数

第一个参数都是事务句柄：本模块不开事务、不挂写路由。决定与撤回的路由在各领域资源上，领域用例开事务后调进来（约定 C67）。

```ts
await tx.run(async (handle) => {
  // 先调 approval，再锁自己的行：员工行（20）→ 审批单（30）→ 领域行
  const { approvalId, requestNo } = await approval.submit(handle, ctx, {
    kind: "points_adjust",
    subjectType: "billing_account",
    subjectId: entityId,
    entityId,
    input: { requestId, points }, // 交给处理器，本模块不看
  });
  await insertDomainRow(handle, { approvalRequestId: approvalId, … });
});

await tx.run((handle) =>
  approval.approve(handle, ctx, { approvalId, staff, lockVersion, note, confirmChecks, checklist, args }),
);
await tx.run((handle) => approval.reject(handle, ctx, { approvalId, staff, note, reasonCodes }));
await tx.run((handle) => approval.withdraw(handle, ctx, { approvalId, staff, note }));
```

- `ctx` 是身份上下文（操作人、请求号），`staff` 是这名员工的员工上下文（authz 的 `StaffContext`：权限点与数据范围）。员工操作两样都要给，且是同一个人；系统动作、商家撤回不给 `staff`。没有请求上下文的地方（演示种子、用例）照样能调：两样都由调用方造，时间取注入的时钟。
- 提交不查权限点：各类型的发起权限由领域接口判。员工提交时发起人就是操作人；系统代某员工生成时另给 `requesterStaffId`。
- 领域用例要自己写审计内容时传 `audit`，本模块就不写缺省的那一行；请求元信息（登录方式、会话、员工姓名与角色名）经 `meta` 传。

决定的守卫，先后固定：

| # | 查什么 | 不过时 |
| --- | --- | --- |
| 1 | 审批单是 `pending` | 409 `APPROVAL_NOT_PENDING`，`details` 带状态与决定时间 |
| 2 | 审批人不是发起人（超级管理员也不例外） | 403 `APPROVAL_SELF_FORBIDDEN` |
| 3 | 员工在职；持决定权限点（“仅主管”已算在内）；绑定发起人所在组的类型要是那一组的主管（超级管理员兜底）；对象在数据范围内（角色队列除外） | 403 `PERMISSION_DENIED` |
| 4 | 通过时 `lockVersion` 与库里一致（驳回不校验） | 409 `VERSION_CONFLICT`，`details` 带最新值 |
| 5 | 驳回：说明必填；审核类由员工驳回至少一项原因；原因都是字典 `reject_reason` 的启用项。通过带清单时：模板是当前启用的版本，不通过的条目有说明 | 400 `VALIDATION_FAILED`；清单换了版本 409 `PRECONDITION_CHANGED` |
| 6 | `revalidate`（只在通过时） | 处理器抛什么是什么，通常 409 `PRECONDITION_CHANGED` |

- 再验证、`confirm` 回显、路由级的模块等级不在这里：由路由侧与各领域接口做（authz 的 `authorize`、`assertConfirm`）。
- 撤回：提交人本人；发起人已不是启用状态时由能决定这一张的员工代撤；对象失效时归属模块以系统身份调。其余 403 `APPROVAL_WITHDRAW_FORBIDDEN`。
- 系统决定（免审批、同信用代码自动驳回、系统代撤）：`ctx.actor.type` 是 `system` 即是，不查第 2、3 步，`decided_by_staff_id` 为空、`is_decided_by_system = true`。
- 同对象已有在途单：`submit` 抛 409 `APPROVAL_ALREADY_PENDING`，`details` 指向在审的那一张。并发的两个提交，后到的等前一个提交后同样得到它。
- 加锁次序：员工行（20，共享锁）→ 审批单（30）→ 领域行（处理器自己锁）。员工操作要锁员工行，所以调 `approve`、`reject`、`withdraw` 之前不要锁次序更大的行（门店、订购单、领域行），锁序断言会拦；员工提交时的 `submit` 同理。系统动作与商家撤回不锁员工行：归属模块可以先 `lockRows(tx, "approval_request", [id])`、再锁自己的行，最后才调进来。本事务里刚 `submit` 的那一张不再加锁，提交后同一事务里的免审批通过不受这条限制。

## 5. 有执行步的类型

`order_cancel`、`ad_cancel`、`qualification_cancel`、`plan_refund`：通过后审批单停在 `approved`，执行是领域用例的另一个事务。执行成功时在那个事务里调：

```ts
await approval.recordExecuted(handle, ctx, { approvalId, domain: { type: "cancel_request", id } });
```

它只发 `approval.executed`（去重键 `approval.executed:{审批单 id}`，重复记不多发），不动审批单、不写状态历史与审计。执行失败本模块什么都不写，审批结论不变。

## 6. 每日校验

| 编号 | 查什么 |
| --- | --- |
| `approval.I1` | 登记了领域表的类型，每张审批单恰有一行领域行指向它；领域行不指向别的类型；有执行步的类型领域行状态与审批单对应 |
| `approval.I2` | 审批人 ≠ 发起人；同一对象至多一张在途的同类申请（有去重键的按键，没有的按“类型 + 对象”） |
| `approval.I4` | 驳回原因都在字典 `reject_reason` 里；清单编码与版本号指向存在的清单模板版本 |

W2-05 增加两项：`approval.I3` 交叉核对业务行、决定/执行用途键、当前批次、期限、参数载荷与活跃 timer 数量；`approval.I5` 独立重算合法快照并发现坏快照或 due_at 偏移，避免超期读侧被污染的期限隐藏。日历窗口中尚未消费的更新允许旧快照暂时存在。五项均为 P2、只在 full 运行里查，各至多报 500 条。

### 决定时限与日历批次

actual runtime 必须给 `createApproval` 成对注入 `sla` 与 `timers`，并调用 `bindApprovalSla`，关闭时调用其返回的解绑函数。旧的单模块测试样例可均不注入，不能只传其一。

资质、账号、链接审核使用各自 `sla.review.*`；四类取消与退款决定使用 `sla.review.refund_approve`。策略、数量、单位取提交时参数，工作时段取提交时生效的 work.start/end。due_at、sla_snapshot 与决定 timer 同事务保存。A93 的积分调整、补偿延长、受控财务配置、对公二人复核不设决定时限；没有登记决定策略的账号变更继续用升级读侧。

决定 timer 键为 `sla.breach:approval_request:{id}:decision:{calendarVersion}`。决定或撤回同事务取消该对象决定用途的活跃 timer。日历重算保留原策略参数和历史工时，通过带品牌守卫的 `sla.recalculated` 同态 flow 写期限、快照、锁版本、状态历史与差异审计，取消旧批次并登记新批次。已触发记录留存，旧派发按当前状态、当前批次和当前期限跳过。日历与计算共用公开 `lockCalendarImport` 咨询锁；最新事件按窗口中尚未消费的真实 kind 批次变化补齐更正，重复/旧事件无副作用。

### 待审内容更正

`approval.touchPending(tx, { approvalId, lockVersion })` 在原 FOR UPDATE 锁下核对 pending 与版本，再只升 lock_version/updated_at；没有迁移、决定、审计或事件记录。下游领域用例在同一事务先调用它，再锁领域行并写自身内容与审计。旧版本返回 `VERSION_CONFLICT`（details.lockVersion），已决定返回 `APPROVAL_NOT_PENDING`（details.status/decidedAt）。资质识别字段更正由 W3-16 接入。

### 执行用途移交

现有 `approval.kind` 登记可增加 `executionSla(tx, approvalRow)`，返回领域真实 status、exec_due_at 与是否已建立过执行交易，缺行返回 null。执行超期只在 approved、领域仍 pending_execution、未执行、当前期限到点时发 `approval.sla_breached`。I3 只校验实际登记的执行来源；出现执行 timer 却没有真实来源会报 execution_source_missing。W4-08/W4-10/W4-13 负责领域 producer、执行前取消、失败回待执行不重新计时与晚到回调取消，本包不创造执行事实。其他尚未接入的 sla.breach 主体返回 skipped，后续 owner 须扩展统一派发。

### 审批读侧

`approval.list(tx, staff, query)`、`summary(tx, staff, filter)`、`get(tx, staff, id)` 都只读。先按登记的 `viewModules` 筛可读类型，再套 authz 的本人、本组或全部范围；发起人自读只越过范围，账号核验的角色队列凭 `publish.account.verify` 可跨范围。列表显式传不可读类型回 403，计数忽略，详情回 404。

`handlerOf` 有当前处理人时用处理人套范围，其他类型用门店、主体；all与有权限的roleQueue不靠处理人判范围，延迟到实际分页/详情项才真实解析处理人，计数不解析未消费的处理人字段。非all范围即时解析保持不变；展示的员工姓名、角色与状态是仓储批量查询的当前值，没有调用同层 staff。`badges` 从登记的读函数取得，另加 `overdue`：待审且超过 `dueAt`，或没有时限时超过 `approval.escalate_workdays` 个工作日。后一项只读 sla 的日历和工时，调用 shared 的纯计算，不触发日历缺失告警写入。

`todo` 必须是当前能决定的待审单，发起人不算；`submitted` 看发起员工；`done_today` 按北京时间决定日；`all` 看全部可读单。列表和计数的 todo 均调用同一个 `countTodo`。上层可调用 `approval.countTodo(tx, staff, filter)` 做菜单角标，或 `decisionView(tx, staff, id)` 返回与详情同源的决定面板。领域类型须在摘要里给 `domain`；a 写侧允许缺省，历史缺省摘要读回时使用对象引用。

## 7. 测试里怎么用

```ts
import { createSampleApproval, SAMPLE_APPROVAL_DDL, sampleStaffContext, sampleStaffIdentity } from "@liyoxi/services/testing";

const sample = createSampleApproval(prisma); // 测试装配 + events + flow + approval + 五个样例类型
const { approvalId } = await sample.submit(sampleStaffIdentity(staffId), { kind: "points_adjust", … });
await sample.approve(sampleStaffIdentity(otherId), { approvalId, staff: await sampleStaffContext(prisma, otherId), lockVersion: 0 });
(await sample.trace(approvalId)).domain?.approved; // 处理器被调了几次
```

样例类型借用五个真实的 `kind` 取值（库的 CHECK 只收那 12 个），领域行在探针表 `lyx_sample_approval_domain` 上：先用属主身份的连接执行 `SAMPLE_APPROVAL_DDL`（写法见 `__fixtures__/world.ts`）。要用带种子的库（角色、字典、清单模板）。

```sh
pnpm --filter @liyoxi/services exec vitest run src/approval/
LYX_FC_RUNS=2000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/approval/lifecycle.property.test.ts
```

都连库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

## 8. 已知的限度

- 审批单按 `FOR UPDATE` 锁（kernel 的 `lockRows` 与 `flow.transition` 都只有这一种排他锁），03 分组写的是 `FOR NO KEY UPDATE`。差别只在并发：别的事务往领域表插一行、指向一张正在被决定的审批单时，要等决定的事务结束。
- 执行类领域 producer 尚未接入；I3 只校验有真实 `executionSla` 登记的来源，其他 timer 主体由后续所属模块接入统一派发。
- 通知：事件照发，`s.approval_pending`、`s.approval_decided` 的场景解析没有登记（M2）。
- 驳回原因只核对“是字典 `reject_reason` 的启用项”，不核对它属于这个类型的场景。
- `approval.I1` 靠 `createApproval` 把登记绑到本模块：一个进程一份，没建 approval 的进程里它查不到任何类型。
