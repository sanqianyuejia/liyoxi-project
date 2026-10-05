# providers：外部能力的接口、未配置实现与本地驱动

依据：[01](../../../../docs/01-architecture.md) 第 9 节、第 2.2 节 P5；[04](../../../../docs/04-adr.md) ADR-039；[D7](../../../../docs/appendix/design/d7-platform.md) 第 2.2 节 D8、第 2.3 节规则 5、第 10.1 节；W0-19 任务书。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `types.ts` | 十二个接口、结果类型 `ProviderResult`、方法清单 `PROVIDER_METHODS`、外呼前钩子。领域模块只引这一个文件 |
| `unconfigured.ts` | 未配置实现，逐接口照 01 第 9 节“未配置时”一列；另有只限本地的假微信、媒体小文件通道，与图片章 |
| `storage/minio.ts` | 本地 MinIO 驱动（S3 兼容）。AWS SDK 只在这里引入 |
| `sms/console.ts` | 控制台短信：把内容打进日志 |
| `index.ts` | 工厂 `createProviders`、生效状态汇总与启动打印 |
| `../testing/providers/` | 十二个测试替身，一接口一文件，经 `@liyoxi/services/testing` 导出 |

## 2. 怎么用

领域模块只依赖接口，由装配处把实现传进来：

```ts
import type { StorageProvider } from "../providers/types.js";
```

每个方法都返回 `Promise<ProviderResult<T>>`。没办成不抛错，看 `reason` 降级：

| reason | 含义 | 调用方 |
| --- | --- | --- |
| `unconfigured` | 这项能力没配置 | 按 01 第 9 节“未配置时”一列降级 |
| `unsupported` | 当前驱动没有这个方法的能力（如本地 MinIO 不签发临时密钥） | 走另一条通道 |
| `unavailable` | 外部服务连不上、超时或报 5xx | 可以重试 |
| `rejected` | 外部服务明确拒绝，或入参不合规 | 不重试 |

只有程序错误才抛：外呼前钩子抛的错（在事务里外呼）原样抛给调用方。

入口要不要展示（如微信支付），看接口上的 `configured`，不靠调一次试。

## 3. 什么都不配时用哪个实现

工厂构建时不连网、不外呼，什么都不配也能启动。生效状态的取值：真实驱动名、`local`（只限 local、test）、`fake`（测试替身）、`unconfigured`；esign 的图片章记作 `stamp`。

| 接口 | local、test | stg、prod |
| --- | --- | --- |
| `wechat` | `local`：假实现（openid 由 code 推出，内容安全一律放行） | `unconfigured` |
| `wechatPay` | `unconfigured`：只剩对公转账 | 同左 |
| `sms` | `local`：控制台输出 | `unconfigured`：提醒只剩站内与订阅消息 |
| `storage` | `local`：本地 MinIO，只有小文件通道 | `unconfigured` |
| `media` | `local`：小文件通道，不处理、直接返回完成 | `unconfigured` |
| `ocr`、`asr`、`llm`、`wecom`、`mail`、`invoice` | `unconfigured` | 同左 |
| `esign` | `stamp`：图片章 | `unconfigured`；打开图片章开关才是 `stamp` |

启动日志里十二个接口各一行（`provider <接口名>: <状态>`），最后一行 `providers ready` 汇总。只打状态，不打任何配置值。

启动失败只有一种：在 stg、prod 选了只限本地的驱动（控制台短信、本地 MinIO），抛 `ProviderConfigError`。

## 4. 选项与环境变量

`createProviders` 现在认三个选项（`ProviderSettings`）：`sms.driver`（`console`）、`storage.driver`（`minio`，另可用 `storage.minio` 覆盖连接参数）、`esign.imageSeal`（图片章开关）。

**这三个选项还没有对应的环境变量。** 任务书要把 Provider 的变量名加进 `loadEnv` 与 `.env.example`，本包没有做：`infra/ci/test/env-example.test.ts` 把键数写死成 6，加键必须改那一行，而改已有的门禁用例属放松类改动，不能随工作包 PR。要先有一个单独的 `gate-change` PR 把那条断言改成不写死键数，之后再把变量加进 `loadEnv`、`.env.example`，并在装配处映射成 `ProviderSettings`。在那之前不要另写一个读环境变量的入口绕开 `loadEnv`。详见 `docs/plan/status/W0-19.md` 的“偏差”。

真实驱动的变量名由带来驱动的包登记，前缀按 D7 第 2.5 节（`WXPAY_*`、`COS_*`、`CI_*`、`WECOM_*`、`OCR_*`）；D7 没给前缀的用接口名大写（`SMS_*`、`MAIL_*` 等）。密钥类变量在任何环境只认 `*_FILE`；成组变量半配即启动失败（往 `kernel/env.ts` 的 `ENV_GROUPS` 里加组）。

## 5. 本地 MinIO

- 连接参数是 `infra/compose/local.yml` 那套共享容器的固定开发值（`LOCAL_MINIO`），不是密钥；与 compose 文件是否一致由 `storage/minio.test.ts` 核对。
- AWS SDK 缺省会去读环境变量与 `~/.aws` 下的文件找配置。驱动把这些选项全部写明，SDK 就不读那些文件；升级 AWS SDK 后要重查一遍（看有没有新增的这类选项）。
- 四个桶：`lyx-local-secure`、`lyx-local-asset`、`lyx-local-media`、`lyx-local-pub`，都是私有桶。驱动第一次用到时建好，已有的不动；compose 里不另建桶。
- 直传只能落在写入区 `incoming/`；入库是条件复制到正式区（对上源对象的 etag 才复制）。
- 没有临时密钥、没有版本控制：分块上传与续传在这里测不到。
- MinIO 没起来不影响启动，调用时返回 `unavailable`。用例要连它：先 `pnpm infra:up`。连不上时 `storage/minio.test.ts` 里要连它的几组跳过并在标准错误里提示；带 `LYX_TEST_MINIO=required` 跑则直接失败（CI 的那一步与验收都带着它）。
- 那套容器由几个 worktree 共用：用例每次运行用自己的键前缀，只删自己建的对象，不删桶。

## 6. 加一个真实驱动

1. 新建 `providers/<接口>/<驱动>.ts`，实现 `types.ts` 里的接口；`status` 写驱动名，`configured` 为 `true`。
2. 在 `index.ts` 里对应的位置加选择分支（各处都留了注释）；变量按第 4 节登记。
3. 接口要加方法时三处一起改：接口、`PROVIDER_METHODS`、未配置实现与替身，另补 `testing/providers/samples.ts` 的样例入参。少一处 `pnpm typecheck` 即失败。只增方法或可选字段；改已有签名要在 PR 描述里单列。
4. 驱动文件只在装配处经 `index.ts` 引入。领域模块引 `types.ts` 以外的文件，`pnpm depcheck` 报 `providers-via-types`。

## 7. 外呼前钩子

每个方法的入口先调一次 `beforeCall({ provider, method })`，由工厂统一包上（`withBeforeCall`），实现里不用自己调。`createProviders` 自己的缺省是空转；进程装配不直接调它，走 kernel 的 `assembleProviders`（KF-1），钩子固定是 `guardProviderCall`：在事务里外呼，local、test 下在这里抛错，stg、prod 上报后照常调（D7 第 2.3 节规则 5）。替身 `createFakeProviders()` 缺省也是它。

## 8. 替身

```ts
import { createFakeProviders } from "@liyoxi/services/testing";

const fakes = createFakeProviders({ clock });
fakes.wechatPay.failNext("createJsapiOrder");
```

每个替身都能记录调用（`calls`、`callsOf`）、注入失败（`failNext`）与延迟（`delayNext`，拨动时钟后 `tick()` 放行）。各自的预置与编排入口写在各文件开头：

- 假微信支付：回调的延迟、重复、乱序、失败与查单结果；预下单幂等于商户单号，退款幂等于退款单号。
- 假微信：文本检测可切到“服务不可用”；图片审核直接放行。
- 假媒体：体检给预置报告；转码、打包直接完成；视频审核直接放行。
- 假存储：对象在内存里，不依赖 MinIO；到期与否按替身的时钟判。
