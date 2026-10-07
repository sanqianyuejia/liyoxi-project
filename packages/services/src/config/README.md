# config：配置读写

别的模块从这里读配置（W0-18）：字典、参数、开关、站点配置、清单模板。读走进程内缓存，Redis 里只放版本号。W2-05 的系统字典、参数、开关、清单写侧经 `createConfigAdmin`；站点配置仍由所属接口包交付。依据：[14 分组](../../../../docs/data-model/14-config-data.md) 第 2、4 节；D6 第 4 节；[约定](../../../../docs/api/00-conventions.md) C69–C71。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `index.ts` | `createConfig`：进程装配时建一次，给出下面各件 |
| `cache.ts` | 版本号缓存：`read`、`bump`、`version`、`invalidate` |
| `params.ts` | 参数：`get`、`getAt`、`snapshot`、`all`；启动自检 `assertParamDefs`；不经配置服务的 `paramsAt(句柄, 键, 时刻)` |
| `flags.ts` | 开关：`evaluate`、`forClient`、`value`、`isEnabled`、`requireEnabled`、`minClientVersion` |
| `dicts.ts` | 字典：`list`（后台视图）、`listForMerchant`（小程序视图）、`label`、`isSelectable`、`versions` |
| `site-config.ts` | 站点配置：`published("mall" \| "home_recommend")` |
| `checklists.ts` | 清单模板：`active(编码)`、`version(编码, 版本号)` |
| `version.ts` | 客户端版本号的比较与范围匹配 |

定义与结构不在这里：参数的类型、范围、默认值在 `@liyoxi/shared/params`；开关的登记、各 jsonb 列的 Zod 结构在 `@liyoxi/contract`。

## 2. 怎么用

```ts
const config = createConfig({ db: prisma, clock: systemClock, redis, keyPrefix: `lyx:${env.APP_ENV}:` });

const start = await config.params.get("work.start"); // "09:00"；类型跟着定义走
const snapshot = await config.params.snapshot(["sla.ticket.assign", "work.start", "work.end"]);
// → { values, revs }，存进单据的快照列；revs 是 param_value.seq，用的是代码默认值时为 null

await config.flags.requireEnabled("release.partner", { platform, clientVersion, envVersion, entityId });
// 关着即抛 AppError("FEATURE_DISABLED")，接口层映射成 403（约定 C70）

const [industry] = await config.dicts.listForMerchant(["industry"]);
const name = await config.dicts.label("industry", "C0101"); // 不看启用状态
```

- 参数缺定义启动失败：`createConfig` 先核对“契约登记的参数键都有定义、默认值合定义”，不过即抛 `ParamDefsError`。
- 库里没有值的键用代码默认值；默认值是 `null` 的键读到 `null`，意思是“未配置”。
- 库里没有的开关（还没播种）取登记的默认值。规则按序首条命中；上下文里缺的那一项当不满足。
- 手里只有事务句柄、拿不到配置服务的地方（装配时静态登记的端口实现与处理器）用 `paramsAt(tx, ["work.start", "work.end"], 时刻)`：一次查询、不走缓存，取值的规矩同 `getAt`，读得到同一事务里刚写的值（W0-30a）。别处照旧用 `config.params`。
- 写侧提交之后调 `config.cache.bump(命名空间)`：`dict`、`param`、`site`、`flag`、`checklist`。本进程立刻重读，别的进程 5 秒内重读。

## 3. 缓存的口径

照 D6 第 4.6 节：

| 情形 | 行为 |
| --- | --- |
| 5 秒内探测过 | 直接用手里的值，不碰 Redis |
| 版本号没变 | 接着用 |
| 版本号变了 | 重读库 |
| Redis 取不到（出错或 500 毫秒没回） | 手里的值装载未满 60 秒接着用，否则重读库；一个探测间隔只试一次 |
| 到点切换（参数预约生效） | 硬过期 = min(装载 + 10 分钟, 下一个切换时刻)，到点即重读 |

有法律意义或涉及撤销的判断不走缓存（协议同意、撤销预约），由各自的写侧直接读库。

## 4. 库里的数据与代码对不上时

读取不抛错，回退到代码里的值，并经 `report` 上报（不给即 `console.error`；说明里不带参数值）：

| 情形 | 读到什么 |
| --- | --- |
| 参数值不合定义（`config.N8`） | 代码默认值 |
| 库里有没定义的参数键（`config.N17`）、没登记的开关键（`config.N19`） | 忽略 |
| 开关的值类型、默认值、规则与登记对不上（`config.N19`） | 登记的默认值，不带规则 |
| 已发布的站点配置、清单模板的条目不合结构 | 当作没有，返回 `null` |

`config.selfCheck()` 给出参数与开关的问题清单（连待生效的参数值一起查）。其中“参数值不合定义”已登记成不变量 `config.N8`，与 W0-21 的五条 SQL 断言（`config.N9`、`N16`、`N17`、`N19`、`N20`）一起在 `register.ts`，随 `invariant.full` 每日跑（W0-24）。

## 5. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/config/
```

`config.db.test.ts` 走测试支架，要本地的 PostgreSQL、Redis 与 `DATABASE_URL`、`REDIS_URL`（`CLAUDE.md` 第 9 节）；`cache.test.ts` 不连库。

## 6. 已知的限度

- 版本范围只认用空格连起来的比较式（`>=1.2.0 <2.0.0`），不支持 `^`、`~`、`||` 与预发布标记。
- 字典项的扩展属性读取时不逐项过结构（整份字典可达数千项），写入方落库前校验。
- 引导接口的 `versions` 怎么由 `cache.version` 与 `dicts.versions` 拼出来，由拼装引导的包定。

## 7. 系统写侧（W2-05）

`createConfigAdmin({ tx, clock, assembly, config, staffBriefs })` 返回八个配置写方法与参数/开关/字典类型读侧。`staffBriefs` 必须由 staff 公开服务供给。每个写入核真实员工权限与身份；API 的 required 幂等、CSRF、限流仍由既有 pipeline 执行，服务提交后才 bump cache，幂等重放不重复 bump。

- 字典类型行 `FOR UPDATE` 串行发码；类型、code、parentCode 不接受变更。系统枚举仅改展示字段，never 类型拒绝停用，特殊行业不能开放。配置项未进入 LOCK_ORDER，配置锁使用参数化定点 SQL；新 Profile/Content 引用和行业 requiredCerts 以相同配置行共享锁保护，同事务读启用状态并写真实引用。
- `dictReferencesPort` 是 keyed 只读计数端口。Profile 自行持有行业/地区/许可证事实，Content 自行持有未归档剧目行业事实，Config 自行持有 requiredCerts 事实。未注册来源的类型返回 null，不能当作零。后续 OCR、内容写侧及执行域由各自归属注册真实来源，并在新增引用时取同一项共享锁；配置停用不反向锁上层业务行。
- 参数保存按键排序取事务咨询锁，比对整批 latest uncancelled seq，任何冲突整批不写。即刻值不会隐式取消预约；组合参数在所有预约边界验证。撤销必须尚未生效且距生效严格超过十分钟，直接读库与条件更新。敏感联系信息读侧遮蔽，原样保存遮蔽值按 staffId 恢复旧值。
- 开关只允许既有 flagKey；值按登记类型验证，规则保留顺序并受 20 条/50 主体限制。`client.min_version` 验合法版本，维护公告按既有 JSON 结构。写后 P3 告警使用真实端口，默认 noop 端口只表示已调用，持久化/投递由 W2-24 PR2 交付。
- 清单模板按 code 串行版本分配。新建为 draft，activate 同事务退役旧 active；discard 只允许 draft。它是配置生命周期，不写业务 status_transition；历史 version 查询继续可读。

对应真库用例：`writes.db.test.ts`，API 全链在 `apps/api/test/system-config.test.ts`。无新增参数键、字典类型、开关键、DDL 或默认值。
