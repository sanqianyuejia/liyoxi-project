# docs：协议与同意

协议的“当前版本”、协议清单与版本正文的读、同意记录的写入、待同意与指纹、已签署协议（W1-03）。依据：[m01](../../../../docs/api/m01-account.md) 第 2.5、2.7、2.9–2.11、3.12–3.16 节；[13 分组](../../../../docs/data-model/13-notify-docs.md) 第 2.10–2.12、5.2、5.4 节。协议管理的写侧（新建版本、保存为待生效、撤回）、`docs.sweep`、同意记录日摘要随 M2；授权书随 M5。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `service.ts` | `createDocs({ tx, clock })`：装配入口，给出下面全部函数 |
| `versions.ts` | 当前版本的唯一解析口径 |
| `read.ts` | 协议清单、版本正文（两条公开接口的取数） |
| `consents.ts` | `assertConsents`：同意记录的唯一写入口 |
| `pending.ts` | 待同意的计算、两个指纹 |
| `signed.ts` | 已签署协议：老板、店员两种形状，计数 |
| `invariants.ts`、`register.ts` | `docs.N4`、`docs.N13` 的查询与登记 |
| `seed.ts` | 六份协议的清单（W0-21，`pnpm db:seed`） |
| `demo-seed.ts` | 六份占位版本（演示种子；只进本地与预发） |

## 2. 怎么用

```ts
const docs = createDocs({ tx: runtime.tx, clock: runtime.clock }); // api、worker 启动时各建一次

await docs.listAgreements({ scene: "plan_purchase", limit: 20 }); // 用例函数：自己开事务
await docs.getAgreementVersion(agreementVersionId); // 草稿、已撤回、不存在都是 NOT_FOUND

// 别的域在自己的事务里
const current = await docs.currentVersions(tx); // 协议键 → 当前版本；报价、付款单要给端上版本 id 就取它
const result = await docs.assertConsents(tx, ctx, {
  scene: "order_submit",
  consents: [{ agreementVersionId }], // 交易接口只有版本 id，协议键由版本行补
  signer, // 手机号密文与脱敏串、称呼脱敏串、角色、appid 与 openid 的 HMAC：调用方带入
  entity: { entityId, entityName, usccEnc, usccMask, storeId },
  biz: { type: "drama_order", id: dramaOrderId, no: orderNo },
});
// result.consents[n].agreementConsentId 写进单据；result.complete、result.stamp 给 identity 写 consent_stamp
```

- **当前版本** = 同一协议在 `pending`、`active` 中 `effective_at <= now` 的最新一条，不看簿记列 `status`。全仓只有 `versions.ts` 这一处，别处一律调 `docs.currentVersions`，不要自己按 `status = 'active'` 取。
- **`assertConsents`**：每份协议一行，命中唯一索引返回已有记录（同一账号同一版本、同一单据只一条）。协议键与版本不一致、用户级场景里混进别的协议回 `VALIDATION_FAILED`；不是此刻的当前版本回 `AGREEMENT_VERSION_STALE`，`details` 带当前版本 id（交易接口只交版本 id，交成别的协议的版本也按过期处理）。`login`、`reconsent`、`member_join` 只收用户级协议、不带主体与单据；四个交易场景必带主体快照与单据（组合不对抛 `TypeError`，是调用方的代码缺陷）。同意方式不给即取协议清单上的（勾选或付款即同意）；`prior_consent` 由广告需求显式给。
- docs 不读身份表与主体表，也不写 `merchant_user.consent_stamp`：快照由调用方带入，指纹由 identity 写。
- **待同意**现算、只读：对每份用户级协议，本人有当前版本的同意记录即已同意；当前版本关了“需重新同意”且本人同意过更早的版本也算。
- **指纹**两个：`consentStamps(db).user`（用户级协议当前版本集合，协议同意中间件用）、`.all`（全部协议，引导数据用）。
- **已签署协议**一行一份协议。函数按观察者角色返回两种形状（店员的记录里没有 `bizType`、`bizNo`、`bizTitle`）；接口层最后一道裁剪在 W1-04。

## 3. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/docs/
```

连真库，走带种子的测试库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

## 4. 已知的限度

- 版本正文的 `pdf.url` 是空串：签名读地址要经 media 现签，docs → media 不在同层白名单里，走法随 G2-B 定（留桩）。
- 已签署协议里的 `bizTitle` 恒为 `null`：付款单的标题要经 billing 取，随 G4-C（留桩）。
- `docs.N5`（单据都对得上同意记录）没有登记：它要查付款单、订购单、广告三张上层表，docs 在 L1 读不到，归属随 G2-C 定。
- `docs.N4` 的哈希一项只比“版本行的内容哈希”与“文件登记行上的哈希”，文件行没有哈希的不比；不读对象存储里的文件本身。
- 登记给框架的两条不变量拿不到注入的时钟，“现在”取数据库时间。
- 取不到来源 IP、请求号的同意记录写 `unknown`，不拦业务。
