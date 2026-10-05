# audit：审计日志的写入

由 W0-14 交付。依据：[03 分组](../../../../docs/data-model/03-staff-authz-audit.md) 第 2.10、3.3、4 节；[01](../../../../docs/01-architecture.md) 第 10.1 节；ADR-025；D4 第 8.2、8.3 节。`audit_log` 单表三条流，只追加，与业务写同事务。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `record.ts` | `record`：写一行；`toAuditRow`：规范化加清洗，算出要写的那一行（不碰库） |
| `sanitize.ts` | 文本的清洗与截断；任意值变成 jsonb 收得下的值；16KB 限长 |
| `sensitive.ts` | 敏感键清单：命中即剔除或脱敏。全仓只这一处 |
| `diff.ts` | `diffFields`：按字段白名单求差 |
| `invariants.ts` | 每日校验 `audit.I2`、`audit.I3`；对象类型的启动自检 `findUnknownAuditTargetTypes` |

类别编码、对象类型、登录方式的登记值与 `AuditDiff`、`AuditMeta` 在契约：`packages/contract/src/audit/`。

## 2. 用法

```ts
await tx.run(async (handle) => {
  await refundRepo.markExecuted(handle, refund.id); // 业务写
  await audit.record(handle, ctx.actor, meta, {
    stream: "ops", // ops 关键操作；activity 日常动作；access 查看明文与签发敏感文件读地址
    category: "refund", // 契约登记的类别
    action: "finance.refund.execute", // <领域>.<对象>.<动作>
    summary: "执行退款 TK20260105001，退回 199.00 元",
    target: { type: "refund_request", id: refund.id, label: "星河洗车 · TK20260105001" },
    entityId: refund.entityId,
    storeId: refund.storeId, // 给 storeId 必给 entityId
    before, // 传整对象；record 只记 fields 里变化的字段，并脱敏
    after,
    fields: ["status", "executedAt"],
    reason: { code: "merchant_request", text: "商家申请" },
    meta: { approvalStatus: "approved" },
  });
});
```

- 第一个参数只收事务句柄：审计行与业务写同事务，回滚则两者都不存在。`record` 自己不开事务。
- `meta`（请求元信息）是必传的：请求号、可信 IP、UA、登录方式、会话 id，没有就明写 `null`。员工的姓名与角色名由调用方放进 `actorName`、`actorRole`（L0 不查员工表）；不给时按操作人类型取“商家”“店员”“系统”等。
- 返回 `{ id, logNo }`。`id` 是应用生成的 UUID v7；`created_at`、`log_no` 由库的插入触发器写。

## 3. 永不因内容格式失败

业务对象里的任何内容都不会让 `record` 抛错：

- 文本去掉 NUL 与不成对的代理项；`summary` 截到 200 字、`target_label` 120、`actor_name` 32、`reason_text` 500、`user_agent` 512，超出以“…”结尾（连“…”在内不超过上限）。
- `before`、`after`、`meta` 里的 bigint、日期、Map、Set、二进制、循环引用、取属性会抛错的对象都有落法；嵌套超过 16 层的部分换成一句说明；序列化后超过 16KB 改存 `{ keys, length, sha256 }`。
- 敏感键（`sensitive.ts`）：口令、令牌、动态码、恢复码、密文与盲索引连键带值剔除；手机号、证照号、信用代码、税号、银行账号与收款账号、邮箱、法定代表人与负责人姓名存脱敏值，收件信息、企业微信外部联系人标识整个打码；复数写法（`phones`、`emails`）同单数。任何一层命中都处理。库里每个 `<名>_enc`、`<名>_bidx` 列的明文名都得命中，`sensitive.test.ts` 照 `schema.prisma` 逐个核对：新加密文列时那条用例会红，往 `sensitive.ts` 里加词。标题、对象标签、原因说明是调用方渲染好的文本，不做脱敏：不要把明文拼进去。
- 写入用一条手写的 `INSERT`，jsonb 三列以文本传：Prisma 对 Json 入参认 `$type`、`__proto__` 等键名，内容里碰上会抛错。

会抛错的只有两类：数据库不可用；登记值或 id 不合法（没登记的类别与对象类型、写法不对的动作、不是 UUID 的归属 id、给 `storeId` 不给 `entityId`、命令行没给命令名），抛 `TypeError`，是代码缺陷。

## 4. 规范化

列间关系库里不写 CHECK，由 `record` 按 03 分组 第 2.10 节的五条规则写，`audit.I3` 每日复核：

| 操作人 | `actor_id`、`client` | 会话、登录方式 | 其他 |
| --- | --- | --- | --- |
| 系统动作 | 都为空，即使请求带了客户端 | 会话为空，登录方式 `system` | `job_name` 取操作人的任务名；IP、UA 为空；名称“系统”、角色“自动任务” |
| 运维命令行（员工，`client` 是 `cli`） | 员工 id、`cli` | 都为空 | `job_name` 是 `cli.<命令>`，调用方给 `jobName` |
| 商家、员工 | 取自操作人 | 取自请求元信息 | — |

对象：`target.type` 必须是契约登记的表名；`target.id` 是 UUID 时写 `target_id`，否则写 `target_key`。新的对象类型往契约的 `AUDIT_TARGET_TYPES` 末尾加。

## 5. 只追加

本模块只有写入，没有改、删的入口。库里另有两道：应用角色对 `audit_log` 只有 `INSERT`、`SELECT`；触发器拦 `UPDATE`、`DELETE`、`TRUNCATE`（属主身份也拦）。

## 6. 还没接的

- 两条每日校验已登记进不变量框架（`register.ts`，W0-24），随 `invariant.full` 每日跑。对象类型的启动自检只导出了函数，由 W0-22、W0-23 接（`docs/plan/tasks/README.md` 第 5 节移交表第 1 行）。
- `audit.I1`（敏感操作与审计配对）随 M1；查询与导出、“先写 `access` 审计再给明文”随 G2-A；状态迁移补写活动流由 W0-16 调这里的 `record`。

## 7. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/audit/
LYX_FC_RUNS=2000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/audit/record.property.test.ts
```

三份用例都连真库，走测试支架：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。性质测试每一轮真的往库里写一行再读回来看。
