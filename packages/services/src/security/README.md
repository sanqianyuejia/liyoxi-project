# security：字段加密、盲索引、敏感字段三件套

由 W0-14 交付。依据：[06](../../../../docs/06-data-model.md) 第 3.2 节；[01](../../../../docs/01-architecture.md) 第 10.2 节；ADR-025；D4 第 9.2、9.3 节；D7 第 7.5 节。回调验签与收件箱也归本模块，随 G2-0。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `keyring.ts` | 密钥环：`createKeyring`、`keyringFromEnv`、盲索引用途 `BIDX_PURPOSES`、`SecurityError` |
| `crypto.ts` | `encryptField`、`decryptField`、`kidOf` |
| `bidx.ts` | `blindIndex` 与两个归一化函数 |
| `pii.ts` | 三件套：`sealPhone`、`sealUscc`、`sealBankAccount`、`phoneBidx`、`usccBidx`、`openField` |
| `selfcheck.ts` | 启动自检 `selfCheck`、`loadKeyring` |

## 2. 用法

```ts
const keyring = security.loadKeyring(env); // 进程启动时一次：造密钥环并自检，不过即抛错（W0-22、W0-23 接）

// 写：仓储层把三件套各写进各的列
const phone = security.sealPhone(keyring, "merchant_user.phone_enc", input.phone);
await tx.merchantUser.create({
  data: { phoneEnc: phone.enc, phoneBidx: phone.bidx, phoneMask: phone.mask, phoneLast4: phone.last4 /* … */ },
});

// 查：按盲索引等值查，+86 写法与纯数字写法查到同一行
await tx.merchantUser.findUnique({ where: { phoneBidx: security.phoneBidx(keyring, input.phone) } });

// 解：只有 security 与各模块的仓储层调
security.openField(keyring, "merchant_user.phone_enc", row.phoneEnc);
```

- 密文：`v1:<kid>:<base64url(iv ‖ 密文 ‖ tag)>`，AES-256-GCM，随机 12 字节 IV，存 `text`。
- AAD 是密文所在的列，写成 `表名.列名`（带 `_enc` 后缀，如 `merchant_user.phone_enc`）：密文挪到别的列解不开。加密与解密要给同一个写法。
- 盲索引：`HMAC-SHA256(K[用途], 归一化(值))`，32 字节，存 `bytea`。手机号只留数字并去掉 `+86`；信用代码去空白、转大写。只支持等值查询与唯一约束。
- 入库的明文是归一化之后的；脱敏串调 `@liyoxi/shared/mask`。密文与盲索引不出接口（约定 C15），接口只给脱敏串。
- 明文里有不成对的代理项时拒绝加密（它过不了 UTF-8）。

## 3. 密钥

- 只经 `loadEnv` 读：`DATA_KEYS_FILE`、`BIDX_KEYS_FILE` 两项成组，任何环境都只认文件路径，给明文变量 `DATA_KEYS`、`BIDX_KEYS` 即失败。文件格式与生成方法见仓库根 `.env.example` 的注释。
- 两项都不配时 `loadEnv` 照常通过（不用密钥的脚本不受影响），`loadKeyring` 报 `keyring_missing`：要用密钥的进程起不来。
- 数据密钥轮换：往 `keys` 里加新 `kid`，把 `current` 改成它。新密文用新密钥，旧密文照样能解；逐行重加密完成之后才能把旧 `kid` 拿掉（拿掉后解旧密文报 `unknown_kid`）。重加密任务不在本包，`kidOf` 可以用来挑出还在用旧密钥的行。
- 盲索引密钥轮换要重算整列（加新列、双写、回填、切换、删旧列），只进运维手册，不做自动化。
- 新的盲索引用途：往 `BIDX_PURPOSES` 末尾加一项、在 `bidx.ts` 的 `NORMALIZE` 里写它的归一化，密钥文件里加同名的一项。各把密钥要互不相同。
- 测试用固定字节现造的假密钥（`__fixtures__/keys.ts`），不读任何文件。

## 4. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/security/
LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/security/crypto.property.test.ts
```

`bidx.db.test.ts` 连真库（`merchant_user`），走测试支架：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

## 5. 回调框架（W2-01）

公共入口是 `security.createWebhooks({ tx, clock, events, sources, alerts? })`。
两进程分别通过 `RuntimeOptions.webhookSources`、`WorkerServicesOptions.webhookSources` 注入同一来源契约。
`WebhookSource` 提供 `provider/mode/verify/payload/restore/handle/reply`；一个 provider 只登记一份，验签器用 `operationId` 区分其端点，未登记或未启用来源拒绝。
本包不挂真实业务 hook；后继包把 Provider 的公开验签结果映射进该接口，不能深引私有实现。

- `prepare(provider, request)` 在事务外消费复制的原始字节，框架拒绝超过1MiB与有时间戳时超过五分钟偏差。来源必须先验签再解析，不能改原文、把解密明文写进日志或把网络调用藏进 `restore/handle`。
- `verify` 的 `kind: reply` 只供 GET 地址校验；POST 产生 `event` 或 `error`。h01第2.1节允许的两类免收件成功须显式返回 `skip`，原因只能为 `unregistered_event/passive_reply`，且仍先验签/校验时间戳。不属于本端点的已登记事件走正常收件后返回 `ignored`。
- `accept(prepared, systemContext)` 只认本实例的私有验证快照。inline 插入即 `processed`，自然去重和领域处理同事务；处理返回 `ignored` 则同事务改为已忽略。失败整个事务回滚，不能用“查到行”代替重处理失败行。
- inbox 原子提交 `received` 与 `webhook.received { v:1, webhookEventId, provider }`，重复不再发出站事件。`security.onWebhookReceived` 在既有 subscriber Tx 中调用 `process(tx,id,ctx)`；域段保存点失败只回滚该段，外层提交受控 `WEBHOOK_HANDLER_FAILED`、次数和下次时间。外层最终失败则失败记录也回滚，不嵌套 `tx.run`。
- `scan()` 由 `webhook_reprocess` 每分钟调用，按到期时间/id逐行独立事务、最多50条、`SKIP LOCKED`。缺来源或停用时保留可恢复行；1/5/15分钟、1/6小时退避，第8次 dead。支付第5次升级，其他来源可显式选 `escalateAfter:5`；告警只含 provider/attempts/id，W2-24 将该端口接到真实独立告警持久化；机器人/短信未配时不声称真实到达。
- 只有 `wechatpay/inline` 可显式 `fallbackToInbox:true`。其 payload 必有完整 `resourceCipher` 和 `keyVersion` 才能在首事务失败后用新短事务落 `failed/inbox`；收件时间保留，下一次按实际失败时间加1分钟。其他来源无此成功兜底。CI/ASR 的 inline payload 必须为 null；其他 inbox 须有可恢复最小载荷。
- 微信支付保留 `summary` 与密文180天，其他有载荷来源90天。`security.webhook_payload` 经既有每日 `ops.retention` 做限量 UPDATE，仅留 summary或置空并写 purgedAt；不删行、不改摘要/digest/来源/原收件举证列。`restore` 在载荷过期后必须受控失败，不制造恢复数据。

`apps/api/src/http/webhook.ts` 的 `receiveWebhook` 是后继 hooks handler 薄口：一次既有IP限流后有界读原文/验签，再进入 OpenAPI解析；协议回包不带公共JSON信封，强制 no-store，429保留 RATE_LIMITED/retryAfterSec 与 Retry-After。自然幂等不落客户端 idem 行。维护拦截仍只归网关三组，不给 hooks 增加维护门禁；本包 API 用三组维护替身核此隔离，真实维护配置由后继环境/运维能力验证。

## 6. 回调目标验证

`pnpm exec vitest run --project services packages/services/src/security/webhooks/` 跑真实DB、100轮固定种子20261007模型、53条双扫描并发、实际提交时延迟约束/23505保存点/40001重试、8次死信及180/90天清理。
`pnpm exec vitest run --project api apps/api/test/webhook-framework.test.ts` 跑完整接收链；`pnpm exec vitest run --project worker apps/worker/test/webhook-reprocess.test.ts` 跑真实worker装配/消费/循环和等待在途后解绑。
所有来源/媒体/支付事实都是显式本地替身；真平台地址、密钥、解密适配与业务处理由接收方另验。

## 后台来源拒绝（W2-24）

公开 `recordOffnetDenied({tx,clock,logger}, {ip,requestId,userAgent?})` 在身份认证前单独写 auth_event，space=staff、subjectId/authMethod=null，event=offnet_denied。写失败固定脱敏日志，仍拒绝来源，不改变员工失败次数/锁定。应用仅调用这个owned公口。ADMIN_IP_ALLOWLIST 默认空；非空由可信clientIP解析后检查IPv4/IPv6/CIDR（含IPv4 mapped IPv6），不接受原始未信任XFF，已登录也拒绝。此包没有改登录会话或再验证流程。
