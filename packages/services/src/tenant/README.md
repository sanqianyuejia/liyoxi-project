# tenant：主体、门店与成员关系

W1-03 交最小集：懒创建主体、成员关系解析、门店列表与额度、记住当前门店、给 profile 的三个写函数、计费账户端口。依据：[m02](../../../../docs/api/m02-tenant.md) 第 1、2.1–2.3、2.7、3.1、3.2、3.7 节；[02 分组](../../../../docs/data-model/02-identity-tenant.md) 第 2.9–2.12、5 节；D4 第 5.1 节。新增门店、停用与恢复、成员、邀请、空草稿让位、主体关闭、资质的 `change` 轮次随 M2。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `service.ts` | `createTenant({ tx, clock, flow, assembly })`：装配入口，给出下面全部函数 |
| `create-entity.ts` | 建主体的事务 |
| `membership.ts` | 成员关系解析 |
| `quota.ts` | 额度与名额的唯一口径 |
| `stores.ts` | 门店列表、记住当前门店 |
| `qualification.ts` | 给 profile 的三个写函数 |
| `machines.ts` | 五条状态链的登记：随迁列、活动流默认描述、本包十行迁移的守卫 |
| `ports.ts`、`billing-account-stub.ts` | 计费账户端口与它的桩 |
| `invariants.ts`、`register.ts` | `tenant.I1`、`I7`、`I27`、`I29` 与本模块的登记 |
| `repo.ts` | 本模块的查询 |

## 2. 怎么用

```ts
const tenant = createTenant({ tx, clock, flow, assembly }); // api、worker 启动时各建一次，createFlow 之后

// 用例函数：自己开事务
const result = await tenant.createEntity(ctx, { idem }); // 操作人须是商家用户
const list = await tenant.listStores({ merchantUserId }); // viewerRole：owner、clerk、none
await tenant.rememberCurrentStore({ merchantUserId, storeId }, { idem });

// 在调用方的事务里
const membership = await tenant.resolveMembership(tx, { merchantUserId, storeId }); // 进不去即 null
const usage = await tenant.getQuotaUsage(tx, entityId);
await tenant.setStoreName(tx, ctx, { storeId, name });
await tenant.setStoreQualification(tx, ctx, { storeId, round: "initial", action: "submit" });
await tenant.setDeliveryManager(tx, ctx, { storeId, staffId });
```

- **建主体**：一个事务里建主体、首店、老板成员关系各一行，三条迁移经 `flow.transition()`，发 `entity.created`、`store.created`，经端口建计费账户。已是老板返回已有主体（`isNew = false`）；别家的有效店员抛 `ALREADY_IN_ENTITY`，`details.storeName` 是他所在的门店。先锁账号行（80），同一账号的并发请求在这里排队；撞 `uq_entity_member_one_entity` 只作兜底。
- **成员关系解析**：老板能进本主体启用中的门店；自己停用的（`by_owner`）给收尾上下文（`storeMode = "archived"`）；草稿删除的、随主体停用的进不去。店员只能进 `store_member` 里的门店。主体不是 `active`、门店不存在都按进不去。403 的两个码由门店上下文中间件回（W1-04）。
- **额度**读时现算、不落库：主体上的覆盖值优先；否则订阅生效取套餐的上限，未开通或已过期取参数 `tenant.default_store_limit`、`tenant.default_member_limit`。订阅的事实经事实端口的 `billing` 键取，没人注册即“未开通”。
- **门店列表**：tenant 自己的字段做全；城市、品类、审核时间、完整度、上线中与交付中、待办数、素材数、当前套餐经事实端口取（[kernel/ports](../kernel/ports/README.md)），对应的模块没注册时是 0 或 `null`。按观察者角色返回两种形状，接口层最后一道裁剪在 W1-04。
- **三个写函数**（profile 调）：`setStoreQualification` 只做 `initial` 轮次的提交、通过、驳回、撤回，门店与主体两条链同事务各写一行状态历史；通过时主体的认证字段（名称、类型、信用代码三件套、法定代表人）由调用方做好传入；出站事件由 profile 发。`setStoreName` 只在资质未提交或被驳回时可改。`setDeliveryManager` 写一条 `ops` 审计。加锁：主体（100）→ 门店（130）。
- 通过时两个主体的信用代码撞了唯一索引 `uq_entity_uscc_bidx_verified`：数据库报唯一冲突，事务中止。调用方要接它就把这一步包在 `savepoint` 里，用 `isUniqueViolation` 认。

## 3. 计费账户端口

`billingAccountPort`（`ports.ts`）由 tenant 定义、billing 实现，建主体的事务里调一次。没有默认实现：没人实现就装配失败。W1-11a 合并之前由 `billing-account-stub.ts` 顶着（什么都不建）；它注册真实现时删掉桩文件与 `register.ts` 里登记它的那一行。测试里换实现：`assembleForTest({ withoutRealPorts: [billingAccountPort], extra: [样例登记] })`。

## 4. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/tenant/
```

连真库，走带种子的测试库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

## 5. 已知的限度

- 没登记守卫的迁移行（门店停用与恢复、主体放弃与关闭、成员加入与移除、`change` 轮次）迁移即抛 `FlowError`，随 M2 补。`store.create` 的守卫现在只认建主体时的首家门店。
- 门店卡的 `actions` 只按“是不是最后一家启用中的门店、有没有提交过资质”给；有没有业务数据、在办事项的判断在停用与删除的接口里（M2）。
- 撤回回到“提交前的值”取自本链的状态历史（最近一次进入 `pending` 的那一行）。
- 资质撤回的守卫只认“操作人是系统”；主体关闭或放弃的联动随 M2 接上时再核对触发条件。
