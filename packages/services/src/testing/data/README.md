# 测试数据支撑

写服务层、接口层用例时反复要用的四样：带种子的干净库、造数据的工厂、表快照比较器、假 Provider 支架。由 W0-25 交付。依据：[01](../../../../../docs/01-architecture.md) 第 12 节；[D7](../../../../../docs/appendix/design/d7-platform.md) 第 10.1、10.2 节；任务书 `docs/plan/tasks/W0-25.md`。

全部从 `@liyoxi/services/testing` 引。只给测试用，不进生产装配。测试库支架、可拨时钟、故障注入的说明在[上一级的 README](../README.md)。

## 1. 典型的开头

```ts
import {
  createClock,
  createFactories,
  createProviderHarness,
  useSeededDatabase,
} from "@liyoxi/services/testing";

const db = useSeededDatabase("services"); // 测试文件顶层；包名取 db、services、api、worker
const clock = createClock();

it("……", async () => {
  const prisma = await db.prisma(); // 首次取连接时才建库
  const make = createFactories({ db: prisma, clock });
  const harness = createProviderHarness({ clock });

  const { entity, store, user } = await make.subscribedMerchant();
  // 调被测的用例函数：要 Providers 的地方传 harness.providers
  harness.assertCalls(["wechat.checkText"]);
});
```

## 2. 带种子的干净库

库里是“全部迁移 + W0-21 的种子”（8 个角色、套餐与价目、协议清单、字典、开关等，调的就是 `runSeed`）。

| 要什么 | 怎么拿 |
| --- | --- |
| 测试文件里 | `const db = useSeededDatabase("services")`。用法与 `useTestDatabase` 完全相同：首次取连接时建库，全过即删，失败留库，`db.reset()` 删库重建（重建出来种子也在）。包的 `vitest.config.ts` 同样要挂 globalSetup |
| 一轮测试之外（演示、手工排查） | `pnpm test:db:seeded`，见下 |
| 脚本里 | `createSeededDatabase(name?)`（从 `packages/services/src/testing/data/seeded-db.ts` 引，这个文件不带 Vitest） |

- 种子在一轮测试里只播一次。第一次用到时，从迁移模板库拷一份、播种、关掉连接入口，成为带种子的模板库 `lyx_test_tpl_<会话标识>_seed`；之后每个测试文件的库从它拷，与不带种子的库一样只付一次拷库。几个 worker 同时要，靠一把咨询锁排队。一轮结束由 globalSetup 连同迁移模板库一起删。
- 播种的时刻是可拨时钟的缺省起点（`DEFAULT_CLOCK_START`，2026-01-05 12:00 北京时间）。用例的时钟不往回拨，种子就都已生效；要拨到这之前，自己留意套餐价目、站点配置这些“到点生效”的行。
- 播完跑六条配置类断言，有违规即抛错。
- 不需要种子的用例照旧用 `useTestDatabase`：少拷 900 多行。

### 命令：`pnpm test:db:seeded`

```sh
DATABASE_URL=… pnpm test:db:seeded                       # 库名缺省 lyx_test_services_<会话标识>_0_seeded
DATABASE_URL=… pnpm test:db:seeded --name lyx_test_demo
```

- 同名的库已存在即删掉重建：每次得到的都是干净的。打印库名，不打印连接串。
- 只建 `lyx_test_` 开头的库（过测试库的守卫）。主机与账号取 `DATABASE_URL`（取值见 `CLAUDE.md` 第 9 节）。
- 连它：把 `DATABASE_URL` 里的库名换掉；要应用角色的权限，连接串后面加 `?options=-c%20role%3Dlyx_app`。
- 用完清理：`pnpm test:db:prune`（缺省名的库属于本会话；`--name` 起的别的名字用 `--all`，或自己删）。
- 退出码：0 建好；1 播种后断言有违规；2 参数、库名不对或连不上库。

## 3. 工厂

```ts
const make = createFactories({ db: prisma, clock }); // db 也可以是 tx.run 给的事务句柄

const ticket = await make.deliveryTicket(); // 上级行（订单项、订购单、商家、短剧……）自动造好
const store = await make.store({ entityId, name: "解放路店" }); // 给了的照用，其余取缺省
const user = await make.merchantUser({ phone: "13800135678" }); // 明文手机号，工厂做成三件套
```

- 一张表一个工厂，各插一行并返回它（Prisma 的模型类型）。缺省值过得了库的 CHECK、外键与唯一索引；主键 UUID v7；时间列取注入的时钟。
- 覆盖字段的类型是 Prisma 的 `…CreateManyInput`：只有这张表自己的列，外键写 `…Id`。写 `undefined` 等于没写。
- 没给的上级行按外键顺序现造，并保证同属一个主体；给了的就在它上面补齐，不另起一串。
- 换了状态，跟着状态走的列会补上（见下表“缺省”一栏）。别的列之间的约束自己负责：库会拒掉不合法的组合，报错里有约束名。
- 工厂只插行：不调服务函数、不写审计、不发事件、不写状态历史、不动账本（批次、分摊、流水、账户上的余额缓存）。要这些都自洽的数据，经对应的服务函数造。
- `staff`、`subscriptionTerm`、`agreementVersion`（以及要用到它们的工厂）依赖种子里的角色、套餐、协议清单：配 `useSeededDatabase` 用。

| 工厂 | 表 | 缺省 | 没给时自动造的上级 |
| --- | --- | --- | --- |
| `merchantUser` | `merchant_user` | 正常状态、自然来源，一个新的假手机号 | — |
| `entity` | `entity` | 未提交认证。`verificationStatus: "verified"` 时补名称、类型、信用代码三件套、认证时间 | 创建人 |
| `store` | `store` | 营业中、资质未提交、不是首家门店 | 主体 |
| `entityMember` | `entity_member` | 没给主体：老板（主体的创建人）。给了主体：店员 | 主体、用户 |
| `storeMember` | `store_member` | 四个外键同属一个主体；“谁加的”取这个主体现任的老板 | 店员、门店、老板 |
| `staff` | `staff` | 在职的交付经理；工号由库里的序列给 | —（角色是种子） |
| `fileObject` | `file_object` | 平台范围、系统上传、已入库的一张海报图。只是登记行，对象存储里没有东西 | — |
| `billingAccount` | `billing_account` | 没有订阅、余额 0 | 主体 |
| `paymentTxn` | `payment_txn` | 微信支付成功的一笔流水，还没归到付款单 | 主体 |
| `billingOrder` | `billing_order` | 新购套餐、微信支付、已支付已履约，带一条指回来的成功流水。`pending_payment`、`cancelled`、`refunded` 各自补齐 | 主体、支付流水 |
| `subscriptionTerm` | `subscription_term` | 今天起一个月、生效中；权益抄自档次最低的套餐的最新价目 | 主体、付款单（套餐是种子） |
| `pointHold` | `point_hold` | 给订单项冻结 100 积分，冻结中；换状态时补扣减、关闭时间 | 主体、门店、订阅周期（先找生效中的） |
| `drama` | `drama` | 已上架、3 集。`draft` 没有上架时间；`delisted` 补下架时间与原因 | 建剧人（内容运营） |
| `dramaEpisode` | `drama_episode` | 这部剧的下一集，一分钟 | 短剧 |
| `agreementVersion` | `agreement_version` | 《定制内容授权使用协议》的一个生效版本，带登记了的 PDF 与正文指纹 | 员工、文件（协议清单是种子） |
| `agreementConsent` | `agreement_consent` | 提交订购时的一条同意记录。换 `scene` 时协议、同意方式、单据类型跟着走 | 协议版本（先找生效中的）、主体、门店、用户 |
| `dramaOrder` | `drama_order` | 待开工、1 项 100 积分。换状态时补子状态、开工与结束时间 | 已认证已开通套餐的商家、同意记录 |
| `orderItem` | `order_item` | 待开工、3 集、100 积分，带一张冻结单。换阶段时补扣减时间等，冻结单状态跟着走 | 订购单、短剧、冻结单 |
| `deliveryTicket` | `delivery_ticket` | 待指派。环节要交付经理时造一位 | 制作中的订单项（连带订购单） |

另有两个组合，一次造好几张表上互相对得上的行：

| 组合 | 给什么 |
| --- | --- |
| `make.merchant({ verified? })` | `{ user, entity, store, owner, billingAccount }`：一位老板、他的主体、首家门店、老板的成员关系、计费账户 |
| `make.subscribedMerchant()` | 上面那些（已认证）加 `term`：一期生效的订阅，计费账户指着它 |

要留意的几处：

- 手机号、单号、名字里的序号在一个进程里递增，不重复。假手机号 `139` 开头；假单号的流水从 90001 起，不动 `biz_sequence`，与真实取号（从 1 起）撞不上。
- 一个主体同时只能有一期生效的订阅、一位老板、一家首家门店；一份协议同时只能有一个生效版本。缺省值踩到这些唯一索引时库会拒掉：把已有的那一行的 id 传进来，或给别的状态。
- 一张订购单要几个订单项就调几次 `make.orderItem({ dramaOrderId })`，并在造订购单时把 `itemCount`、`totalChargePoints` 写成对得上的数（这两列写入后不可改）。
- 会员协议、积分规则（`member`、`points`）的非草稿版本库里要求挂公告，公告没有工厂：自己给 `siteNoticeId`，或写 `status: "draft"`。
- `agreement_consent`、`file_object`、`drama` 插了删不掉（只增或禁删）：要干净的库用 `db.reset()`。

### 敏感字段

手机号、统一社会信用代码这些列存的是三件套（密文、盲索引、脱敏串）。工厂不自己拼，调注入进来的 `seal`：

```ts
createFactories({ db, clock, seal: mySealer }); // FactorySealer：phone、uscc、text 三个方法
```

缺省是 `testSealer`：`security` 模块的真实现（`sealPhone`、`sealUscc`、`encryptField`）配一把测试密钥环 `TEST_KEYRING`（固定字节现造，不读任何文件，不是任何环境在用的密钥）。密文是 `v1:test:…` 的真密文，盲索引是真的 HMAC：被测代码拿 `TEST_KEYRING` 解密、按盲索引等值查找都对得上。断言密文里是什么用 `openSealed(列, 密文)`（列要与写入时相同）；要换一把密钥环就注入 `sealerOf(自己的密钥环)`。三个类型 `SensitiveColumn`、`SealedField`、`SealedPhone` 就是 `security` 的那三个。

### 加一个工厂

M1 主路径之外的表（广告、客服工单、退款、发票、通知等）没有工厂，谁先用到谁加：

1. 在 `factories/` 下照现有文件写（或加进已有的那一组）：缺省值、自动造上级、`...defined(input)` 放覆盖的字段。
2. `factories/types.ts` 的 `TableFactories` 加一个方法，`FACTORY_TABLES` 加一行（少一处编译不过）。
3. `factories/index.ts` 的 `createFactories` 里把这一组并进去。
4. `factories.db.test.ts` 会按 `FACTORY_TABLES` 自动多出一条“不给参数能插入”的用例；跟着状态走的缺省另写一条。

工厂直接插库只许出现在 `packages/services/src/testing/` 下。应用层（`apps/api`、`apps/worker`）的用例经 `@liyoxi/services/testing` 用工厂，自己不写插库语句、不引 `@liyoxi/db`。

## 4. 表快照比较器

记下若干张表在两个时刻的全部行，报增、删、改。幂等与回放测试用：同一个幂等键调 k 次，终态与调一次相同（D7 第 10.2 节 P5）。

```ts
import { assertSnapshotsEqual, diffSnapshots, formatSnapshotDiff, snapshotTables } from "@liyoxi/services/testing";

const tables = ["drama_order", "order_item", "point_hold"];
const before = await snapshotTables(prisma, tables);
await submitOrderAgainWithSameKey();
const after = await snapshotTables(prisma, tables);

assertSnapshotsEqual(before, after, { ignore: ["updated_at"] }); // 有差异即抛错，说明里写着差在哪
// 或者自己看：
const diff = diffSnapshots(before, after);
// diff.tables = [{ table, added: [行], removed: [行], changed: [{ key, columns, before, after }] }]
expect(diff.equal, formatSnapshotDiff(diff)).toBe(true);
```

- 每行读成 `to_jsonb(行)`：列名是库里的写法（snake_case）；时间是带时区的文本，bytea 是 `\x` 开头的十六进制，数组是数组，jsonb 原样。行按键排好序，所以两张快照可以直接 `toEqual`。
- 认行缺省按主键。回放测试里主键每次不同时，用 `snapshotTables(db, tables, { keyBy: { plan: ["code"] } })` 换成业务上的唯一键，比的时候把主键列忽略掉。
- 忽略列：`ignore: ["updated_at"]` 对所有表生效；`ignore: { "*": ["updated_at"], order_item: ["lock_version"] }` 按表给。忽略的列变了不算改；增、删的行照报。
- 第一个参数收 Prisma 客户端或事务句柄：在事务里记，看得到本事务还没提交的行。
- 表名只收小写标识符，且必须在库里。整张表读进内存：不要拿去读大表。

## 5. 假 Provider 支架

W0-19 的十二个替身各记各的调用（见 [../../providers/README.md](../../providers/README.md)）。支架在它们之上一次装好：

```ts
const harness = createProviderHarness({ clock });
const providers = harness.providers; // 一份 Providers；各替身的编排入口照旧

providers.sms.failNext("sendActivationCode"); // 失败、延迟注入照旧在替身上
await useCase({ tx, clock, providers }, input);

harness.assertCalls(["wechat.checkText", "sms.sendActivationCode"]); // 调了哪些、什么顺序；名字写错编译不过
expect(harness.lastCall("sms.sendActivationCode")?.input).toMatchObject({ phone: "13800135678" });
harness.assertNoCalls(); // 一次外呼都没有
```

| 入口 | 做什么 |
| --- | --- |
| `harness.providers` | 十二个替身。要 `Providers` 的地方传它 |
| `calls(筛选?)`、`callNames(筛选?)`、`lastCall(筛选?)` | 外呼记录，十二个替身合成一条，按发生的先后编号。筛选写接口名（`"sms"`）或方法名（`"sms.sendActivationCode"`） |
| `assertCalls([...])`、`assertNoCalls()` | 断言发生过的外呼恰好是这些、顺序相同；不符即抛错，列出期望与实际 |
| `tick()` | 放行到点的延迟应答（先拨时钟） |
| `reset()` | 清空时间线与十二个替身的调用记录、没用掉的失败与延迟。替身里别的状态（发出去的短信、存进去的对象）不动 |

- 事务里外呼即抛 `KernelViolation`（硬性规则 9），这次调用不记、替身也不执行。支架在记时间线之前查这一条；直接用 `createFakeProviders()` 也查得出（它的外呼前钩子从 KF-1 起缺省是 `guardProviderCall`）。
- 纯内存，很轻：每条用例建一个新的，替身里的状态就不会串到下一条。
- 清调用记录用 `harness.reset()`；只调某个替身的 `resetCalls()`，时间线不会跟着清。

## 6. 文件

| 文件 | 内容 |
| --- | --- |
| `seeded.ts`、`seeded-db.ts` | `useSeededDatabase`；`createSeededDatabase`、`ensureSeededTemplate`（后一个文件不带 Vitest，命令行用） |
| `factories/` | 工厂：`index.ts` 是入口，`types.ts` 是对外的形状与工厂清单，其余按领域一组一个文件 |
| `seal.ts` | 三件套的注入点、测试密钥环与缺省实现（`security` 的真三件套） |
| `snapshot.ts` | 表快照比较器 |
| `provider-harness.ts` | 假 Provider 支架 |
| `packages/db/src/testing/derived.ts` | 派生模板库（带种子的模板库靠它）、不靠模板的迁移库 |
| `packages/services/scripts/seeded-db.ts` | `pnpm test:db:seeded` 的入口 |
