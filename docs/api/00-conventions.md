# 接口契约通用约定（修订稿）

| 项 | 内容 |
| --- | --- |
| 状态 | 修订稿：按主负责人裁决 A1–A40 修订，再按第八、十节的补充裁决 A41–A120（`api-rulings.md`）修订第二轮，再按第十一、十二节 A121–A146 修订第三轮，定稿时并入第十三、十四节 A147–A156。总览见 [07 接口契约](../07-api-contract.md)；各分组接口文档按本文写 |
| 日期 | 2026-10-03 |
| 依据（优先级从高到低） | ⓪ 主负责人裁决 [`working/api-rulings.md`](working/api-rulings.md)（A1–A156）；① 数据模型：`06-data-model.md`、`data-model/*.md`、`data-model/working/rulings.md`；② 主文档 `01`–`05`；③ 设计草案 d1–d9 的接口清单（d7 第 3–6 节、d4 第 3、5、6、7、9 节与附录 A/B、d2 第 4、12 节为本文主要来源）；④ 设计规范与原型梳理；⑤ PRD |
| 与路线图的关系 | 路径与资源名以路线图（[`working/routemap.json`](working/README.md)，最初分商家端、后台、下载页与回调三份）的写法为准（A1）；错误体、幂等、分页、并发、文件、长任务、再验证、版本兼容等**规则**以本文为准，路线图按本文改（A2）。本文举例的路径已按路线图和本轮裁决改写，路线图里尚未跟改的，以本文与资源登记表 `resources.json` 为准，由后续同事回改路线图 |
| 引用写法 | `文件名:行号`。草案文件名省略目录（`d7-platform.md` 即 `docs/appendix/design/d7-platform.md`）；`PRD.md` 指《PRD》第 7 稿（不在仓库里）；路线图条目写作 `m05.sample.download` 这样的路线图 id |
| 编号 | 每条约定编号 `C1`…`C87`，各接口文档引用编号即可，不复述。C83、C84 是第一轮新增，放在相关章节里；第二轮（A41–A120）不新增编号，改动落在原条目里；第三轮（A121–A146）新增 C85（字典编码，第 5 节）、C86（驳回的再验证豁免，第 11 节）、C87（公共结构登记表，第 12 节） |
| 标记 | “本稿补充”= 草案与裁决都没写、本文为了闭合约定而定的做法；“待确认”= 依据不足，需要主负责人或业务拍板 |

## 0. 一页结论

- 四组接口：商家端 `/api/v1/m`（`api.<域名>`，Bearer 不透明会话令牌 + `X-Store-Id`）、后台 `/api/v1/admin`（`admin.<域名>`，`__Host-lyx_admin` Cookie + `X-LYX-Admin` + Origin 校验）、下载页 `/api/v1/portal`（`portal.<域名>`，`__Host-lyx_portal` Cookie + `X-LYX-Portal`）、回调 `/api/v1/hooks`（`api.<域名>`，按 Provider 验签）。下文写路径时省略 `/api/v1`。
- 一张表一个资源名，登记在 `resources.json`；视图别名只有四类（当前账号、当前门店、父资源下的单例子资源、当前会话 `/<端>/sessions/current`）；路径参数只有 uuid 与少数配置表的自然键，凭证一律不进路径；后台路径不加菜单分组段。三端退出登录都是 `DELETE /<端>/sessions/current`。
- 每条路由有全仓唯一的 `operationId`（`<组>.<资源>[.<子资源>].<动作>`），它同时是幂等记录的作用域；限流档位、版本门槛豁免都按 `operationId` 登记。
- 成功体沿用 d7 的信封 `{ code: 0, message: "ok", data }`；错误体 `{ code, error, message, retryable, requestId, fieldErrors?, details? }`。端上只按符号名 `error` 判断。
- 标识一律 UUID v7 字符串；金额整数分（`…Fen`）、积分整数（`…Points`）、比例万分比（`…Bp`）；`bigint` 出接口转字符串；时刻 ISO 8601 带偏移；日期 `YYYY-MM-DD`（北京时间）；枚举小写蛇形；JSON 字段驼峰；字典项响应给 `DictRef[]`、请求收编码数组（C85）。
- 列表：商家端与下载页游标分页、不返回总数（唯一例外是短剧搜索的 `totalApprox`）；后台页码分页带总数，只增大表用游标并返回封顶的 `totalApprox`；登记过的有界小集合不分页，只回 `{ items }`；页签计数一律由 `GET /<资源>/summary` 给（可带页头上下文）；导出一律建异步任务。
- 写路由的幂等方式三选一：`required`（缺省，状态迁移一律如此）、`natural`（写出约束名数组）、`none`（只限登录与退出、签发短时地址、明文查看、主动查单、自助绑定动态口令时取一次性密钥、埋点与错误上报、匿名建票据、查询与试算）。结果含激活码、令牌、签名地址、支付调起参数或明文的，幂等记录只存脱敏结果。内容编辑带 `lockVersion`（没有锁列的几张表除外），状态迁移只在数据模型守卫列了锁版本时才带。
- GET 不写库：需要留痕的读取走 `POST …/download-urls`、`POST …/playback-urls`、`POST /admin/pii-reveals`；试算一律 `POST …/quote`。
- 店员视图由契约里按角色区分的响应 schema 在出站时裁剪；后台权限点以一份注册表为准，再验证标记跟注册表走（唯一例外：C86 登记的驳回接口声明 `x-step-up: skip`）；权限取决于对象或请求体的接口两端都可声明 `assert-in-handler`，判定规则写在接口文档里。
- 错误码：通用码见 C27（含 409 `REMINDED_TODAY`，429 只给限流）；跨文档共用的领域码只在一份文档里定义，归属表由清单自动生成（C28）。公共结构名在同一份 OpenAPI 文档里唯一，只由归属文档定义一次（C87）。
- 三份 OpenAPI 分开生成；小程序上传生产版本时打 `weapp-vX.Y.Z` 标签，服务端变更须对全部在役标签兼容。

---

## 1. 接口分组、域名与认证

**C1 四组前缀与域名。**

| 组 | 前缀 | 域名 | 调用方 | 凭据 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 商家端 | `/api/v1/m/*` | `api.<域名>` | 小程序 | `Authorization: Bearer <令牌>` | `01-architecture.md:433`；`d4-identity.md:81` |
| 后台 | `/api/v1/admin/*` | `admin.<域名>`（与后台页面同源） | 后台 SPA | 会话 Cookie + 密码 + TOTP | `01-architecture.md:435`；`02-tech-selection.md:82` |
| 下载页 | `/api/v1/portal/*` | `portal.<域名>`（与下载页同源） | 下载页 SPA | 会话 Cookie | `01-architecture.md:434`；`d7-platform.md:1276` |
| 外部回调 | `/api/v1/hooks/*` | `api.<域名>` | 微信支付、微信消息推送、企业微信、数据万象、语音识别、短信 | 验签，或查询参数里的每任务签名与令牌（A3） | `01-architecture.md:425`；`d7-platform.md:1634` |

- 网关与应用各做一层 Host 判断：`api.` 只放行 `/m/`、`/hooks/` 与探活，`admin.` 只放行后台静态资源与 `/admin/`，`portal.` 只放行下载页静态资源与 `/portal/`，其余组合 404（`d4-identity.md:1893`；`01-architecture.md:438`）。预发用 `*.stg.<域名>`。`<域名>` 已定为 `liyoxi.timavia.com`，即生产 `api.liyoxi.timavia.com`、预发 `api.stg.liyoxi.timavia.com`（业主 2026-10-04；[ADR-041](../adr/0041-预发先行-单机预发-共用AppID.md)）。
- 探活（A38、A42、A83）：根路径三条，不在四组之内：`/healthz`（存活）、`/readyz`（就绪）、`/health`（外部拨测，保留）。三条都只回聚合状态，不暴露分项细节。计费、资金、流程的明细指标都走内网 `/internal/health/*`，不经网关对外：`/internal/health/finance`（已含 d1 的计费分项）、`/internal/health/flow`（A83 补，流程分项，`d3-flow.md:3223-3232`）。内网明细只靠网络隔离，`x-auth` 记为 `public`，在 `public` 黄金文件里标“仅内网”（h01 的默认）。
  - 探活**不进 OpenAPI、不分配 operationId**（A42、A83）。路线图里的条目保留为“只登记、不进 OpenAPI”（字段 `registryKeyOnly: true`），登记键 `hooks.healthz.get`、`hooks.readyz.get`、`hooks.health.get`、`hooks.internalHealth.finance.get`、`hooks.internalHealth.flow.get` 只作清单编号，不作幂等 scope，也不进限流与豁免清单。
  - 降级时 `/health` 与内网明细返回 HTTP 503（响应体仍是聚合状态），让只看状态码的拨测也能报警（A83）。
  - 停机维护开关不拦探活（A83，见 C72），否则负载均衡会把全部节点摘掉。
  - 路线图的 `h01.health.live`（`/livez`）改为 `/healthz`。
- 授权书验真（A37、A100）：下载页前端路由 `/v?code=<验真码>&rev=<版次>`，页面调数据接口 `GET /portal/license-verifications?code=`（`x-auth: public`，`portal.licenseVerification.get`），扫码地址带的版次作为可选查询参数传给接口（参数名以 p01 为准，`revNo`），接口据此提示“已有更新版本”。不做服务端直出 HTML。印在授权书 PDF 页脚二维码上的地址随之改为 `https://portal.<域名>/v?code=<验真码>&rev=<版次>`（原写法 `/v/<verify_code>`，`d6-notify-docs-data.md:1250`；数据模型 13 分组 `letter_snapshot.verifyUrl` 待回写）。验真页的主体名称脱敏为保留前 2 个字与后 4 个字，不足 7 个字的只留首字（A100，待法务确认，见第 15 节）。草案的 `GET /v/{verifyCode}`（`d6-notify-docs-data.md:2255`）与路线图的 `GET /portal/license-verifications/{verifyCode}` 都不再使用。

**C2 `x-auth` 取值。** 每条路由在契约里声明 `x-auth`（路线图字段名 `xAuth`，A11；取值沿用 `d4-identity.md:356-367` 并补 `staff`）：

| 取值 | 含义 | 用于 |
| --- | --- | --- |
| `public` | 不解析凭据 | 登录、匿名可读的配置与协议、邀请落地页、下载页建票据与轮询、授权书验真、后台登录前的几条（`/admin/auth/login` 等，`d4-identity.md:2287`） |
| `optional` | 有凭据则解析，登录后多返回个性化字段 | 首页、短剧目录、启动引导、埋点、错误上报 |
| `signed` | 不要登录态，凭签名访问 | 回调（按 Provider 验签或查询参数里的每任务签名）；D5 的播放清单 |
| `user` | 已登录，不要求成员关系 | 账号本人的操作；**新建档、接受邀请等尚无成员关系的接口用 `user`，不是 `member`**（A11） |
| `member` | 已登录且对 `X-Store-Id` 有成员关系 | **商家端缺省值** |
| `staff` | 后台已登录员工 | **后台缺省值** |
| `portal` | 下载页会话 | 只出现在 `/portal/*` |

`public`、`optional`、`signed` 的全量清单是一份黄金文件，新增须评审（`d4-identity.md:367`）。路线图原来的 `auth` 字段（`owner_only` / `owner_and_clerk` 或自由文本）拆成三个结构化字段：`xAuth`、`capability`（商家端能力点）或 `permission`（后台权限点）、`clerkView`（见 C55），从备注里迁出（A11）。

**C3 商家端令牌。**

| 项 | 约定 | 出处 |
| --- | --- | --- |
| 形态 | `lyxm_<sid>.<32 字节随机数 base64url>`，不透明；库里只存随机部分的 sha256 | `d4-identity.md:314` |
| 放哪 | 请求头 `Authorization: Bearer <令牌>`；本地存 `lyx.accessToken` | `d4-identity.md:316`；`d7-platform.md:298` |
| 过期 | 空闲 30 天滑动、绝对 90 天；每请求查库校验，不缓存 | `d4-identity.md:315`、`321-330`；`02-identity-tenant.md:212-213` |
| 续期 | **没有刷新令牌与刷新接口**。收到 401 后由请求层单飞执行一次 `wx.login` + 静默登录 `POST /m/sessions`（`m.session.create`），成功则带原 `X-Request-Id` 与幂等键重放一次；返回 `needPhone` 则回登录页，手机号登录为 `POST /m/sessions/phone-login`（`m.session.phoneLogin`） | `d4-identity.md:317`、`349`；`02-tech-selection.md:183`；路线图 `m01.session.*` |
| 退出 | `DELETE /m/sessions/current`（`m.session.current.delete`），幂等 `none`；端上把 401 当作已退出（A43） | A43 |
| 吊销 | 禁用、注销、强制下线、退出登录、移除微信身份 → 下一请求 401；换绑手机号保留当前会话、吊销本人其他会话，不换发令牌（A81）；成员关系变化 → 下一请求 403 `NOT_A_MEMBER` | `d4-identity.md:332-339`；A81 |

取舍：d7 的端上流程仍写着“续期并重放”“`lyx.refreshToken`”与 `SESSION_REVOKED`（`d7-platform.md:267-268`、`298`、`622-624`、`640`），这是 d4 原稿的 JWT 双令牌方案；d4 修订稿改为方案 C 并宣布 `SESSION_REVOKED` 作废（`d4-identity.md:349`、`2340`），主文档采用后者（`02-tech-selection.md:35`、`183`；`04-adr.md:144` ADR-020）。本文按 d4 修订稿：`lyx.refreshToken` 键删除，401 一律走“静默登录 + 重放一次”。草案的 `POST /m/auth/wechat/session` 已按路线图改为 `POST /m/sessions`。

**C4 后台会话与防跨站。**

| 项 | 约定 | 出处 |
| --- | --- | --- |
| Cookie | `__Host-lyx_admin`，`HttpOnly; Secure; SameSite=Strict; Path=/`；本地开发用无前缀名 | `d4-identity.md:1078`；`d7-platform.md:297` |
| 防跨站 | 非 GET 请求必须带 `X-LYX-Admin: 1`，且 `Origin` 等于后台源；后台不开 CORS | `d4-identity.md:1080` |
| 登录 | `POST /admin/auth/login {phone, password}`（`admin.auth.login`）→ `ticket`（`mfa` 票据，5 分钟，不是会话）→ `POST /admin/auth/verify-mfa {ticket, method, code}`（`admin.auth.verifyMfa`）→ `Set-Cookie`；失败一律 401 `AUTH_FAILED` | `d4-identity.md:1007-1018`、`1029`、`1035`；路线图 `a01.auth.*`；字段名按 A139 |
| 过期 | 空闲 60 分钟、绝对 12 小时；距上次更新超过 60 秒才续写空闲时间 | `d4-identity.md:2348`、`1079`；`03-staff-authz-audit.md:311-312` |
| 退出 | `DELETE /admin/sessions/current`（`admin.session.current.delete`，取代路线图 `POST /admin/auth/logout`），幂等 `none`；前端把 401 当作已退出。当前员工信息仍是 `GET /admin/auth/me` | A41、A43、A82 |
| 设备 Cookie | `__Host-lyx_dev`，90 天，只用于登录失败分桶，不是会话 | `d4-identity.md:1026` |
| 权限刷新 | 角色与权限每请求从库里取（进程内缓存 5 秒）；前端收到 `PERMISSION_DENIED` 时重拉 `GET /admin/auth/me`（`admin.auth.me.get`） | `d4-identity.md:1081`、`1230`；`d7-platform.md:1105` |

**C5 下载页会话。** 流程（路径按路线图并按 A3、A4、A5 改写）：

1. 电脑端 `POST /portal/portal-tickets`（`portal.portalTicket.create`）建票据，返回 `portalTicketId`（`portal_ticket.id`，uuid）、`pollSecret`、`pairDigits`、`shortCode`、`expiresAt`；二维码内容里是 `public_id`（`d7-platform.md:1203`）。
2. 老板在小程序扫码或手输短码：`GET /m/portal-tickets/lookup?code=`（`m.portalTicket.lookup`；`code` 为 `public_id` 或 8 位短码，放查询参数，A3），返回票据摘要与 `portalTicketId`；确认或拒绝 `POST /m/portal-tickets/{portalTicketId}/approve|reject`。老板点选的配对数字与票据不一致时，确认接口返回 **200** 且 `status = rejected`（`rejectReason = pair_mismatch`），不返回错误码——错误会让事务回滚（C50 只持久化成功），票据就作废不了（A101）。
3. 电脑端每 2 秒轮询 `GET /portal/portal-tickets/{portalTicketId}`（请求头 `X-Poll-Secret`）；`approved` 后 `POST /portal/portal-tickets/{portalTicketId}/exchange {pollSecret}` → `Set-Cookie __Host-lyx_portal`（`HttpOnly; Secure; SameSite=Strict`）。

路径参数一律是票据的 uuid 主键；`public_id` 与短码只出现在二维码与 `lookup` 的查询参数里（A3、A4）。这与 `02-identity-tenant.md:861`（`public_id`“写在二维码与轮询地址里”）不一致，需回写数据模型说明。下载页资源名按 A5 统一为 `portal-tickets`（路线图 `p01.tickets.*` 的 `/portal/tickets` 改名）。非 GET 带 `X-LYX-Portal: 1` 并校验 `Origin`（`d7-platform.md:1251-1263`；`d4-identity.md:507`）。票据 120 秒（`02-identity-tenant.md:868`）。会话时长按数据模型默认：**确认起 2 小时、不滑动**（A65；`02-identity-tenant.md:248`、`261`），d7 的“闲置 2 小时或确认起 12 小时”（`d7-platform.md:1263`）不采用。只做扫码，不做提取码（`03-key-designs.md:605` R5），d4 附录 A 的 `POST /portal/links/{token}/verify` 删除。当前会话 `GET /portal/sessions/current`（`portal.session.current.get`），电脑端退出 `DELETE /portal/sessions/current`（`portal.session.current.delete`，幂等 `none`，A43），二者取代路线图的 `GET /portal/session`、`POST /portal/session/logout`（A41、A82）；老板在小程序撤销 `POST /m/portal-sessions/{portalSessionId}/revoke`（`m02.portal-session.revoke`）。停机维护期间下载页只显示静态维护页（C72）。下载页请求的操作人记为授权它的商家用户，来源记 `client = portal`（`03-key-designs.md:615` R15；`01-kernel-flow.md:56`）。

**C6 回调。** 框架与表在 d4（`d4-identity.md:1795-1866`），本文只定接口面：
- 路径 `/hooks/<provider>/<资源>`，provider 段不是分组段。现行写法（路线图 `h01.*`，按 A3 把签名与令牌移出路径）：`POST /hooks/wechatpay/transactions`、`POST /hooks/wechatpay/refunds`、`GET|POST /hooks/wechat/messages`、`GET|POST /hooks/wecom/events`、`POST /hooks/ci/media-jobs/{mediaJobId}?sig=`、`POST /hooks/asr/media-jobs/{mediaJobId}?sig=`、`POST /hooks/sms/status-reports?token=`；`/hooks/esign/events` 为 V1.1。数据万象与语音识别的回调地址能否带查询参数、短信平台能否在查询参数里带令牌，接入时核对。**平台不支持在回调地址里带查询参数的**（A126）：按平台能力改为“路径里带不可枚举的随机段 + 服务端比对”，作为 A3 的例外，由接入时登记；不影响现有接口文档。
- **回调地址一经在外部平台配置即冻结**；改路径按破坏性变更处理，先新旧并行再下线（本稿补充，复核意见 35）。
- 在 JSON 解析前取原始字节验签；带时间戳的协议偏差超过 5 分钟拒绝；验签失败按该 Provider 的协议应答失败，绝不回成功（`d4-identity.md:1808-1810`；`d2-payment.md:563-570`）。查询参数里的 `sig`、`token` 在访问日志里脱敏（A3）。
- `x-auth: signed`；不走 Cookie / Bearer，不套用户限流，只挂按来源 IP 计数的 `hooks.ip` 档位（C68）；请求体 ≤1 MB，请求体不进应用日志（`d4-identity.md:1785`、`1866`）。
- 停机维护期间回调照常放行，网关不对 `/hooks/*` 返回 `MAINTENANCE`（A65，见 C72）。
- 去重靠回调收件箱的唯一约束：`x-idempotent: natural`，`x-idempotent-by: uq_webhook_event_provider_event_id`（`15-integration-ops.md:79`），不用 `Idempotency-Key`。地址校验的 GET 不写收件箱。
- 应答体按 Provider 协议，**不套本文的信封**；`hooks` 不出 OpenAPI 文档（`d7-platform.md:236`）。
- 有主动查询兜底的用内联模式，没有的用收件箱模式（`d4-identity.md:1826`、`1842`）。数据万象回调没有验签机制，只当唤醒信号（`01-architecture.md:425`）。

**C7 中间件顺序。** 请求编号 → 访问日志（对查询参数 `token`、`code`、`sig` 等脱敏，A3）→ 版本门槛 → 鉴权 → 成员关系 → 协议同意 → 再验证 → 开关 → 限流 → 幂等上下文 → 入参校验 → 处理器（`d7-platform.md:450`）。因此 401 / 403 / 426 / 428 / 429 / 400 都发生在幂等行落库之前，“同意协议后重放”“再验证后重放”可以沿用同一个键。后台另有访问面检查（IP 白名单）在鉴权之前、`X-LYX-Admin` 检查在权限之前（`d4-identity.md:1352-1366`）。

**C8 代操作。** 请求层为 V1.1 预留 `X-On-Behalf-Of` 头；V1.0 不发送、服务端不识别（`d7-platform.md:695`）。

---

## 2. 路径、命名与参数

**C9 路径构成。** `前缀 + 资源 + [/{xxxId}] + [/子资源 | /动作]`。资源名用复数、短横线连接的英文名词，同一张表全仓一个名字（C10）。**三组都不加分组段**：后台路径不加菜单分组段（A6），草案与本文旧稿里的 `/admin/sys/…`、`/admin/finance/…`、`/admin/publish/…`、`/admin/pii/…` 都去掉分组段；回调路径里的 provider 段不算分组段（C6）。嵌套不超过两层资源（`/m/orders/{orderId}/order-items` 可以，再往下一层不可以，改用顶层资源 `/m/order-items/{orderItemId}`）；嵌套集合用的仍是该表登记的资源名（如 `/admin/dramas/{dramaId}/drama-permits`，不另起短名）。当前账号、当前门店、父资源下的单例子资源、当前会话这四类视图别名见 C10。

**C10 资源登记表。** 资源名与数据模型表名的对应登记在 `resources.json`（本轮新建，与本文同目录；落地后放 `packages/contract`），契约自测按它检查（A5）。每项 `{ table, resource, param, surfaces, aliases, notes }`：

- **一张表只对应一个 `resource`**，三端同名；路径参数名 `param` 全仓唯一（C11）。
- **视图别名只允许四类**（A5、A41）：① 当前账号 `/m/me`（及其下的本人资源，如 `/m/me/wechat-identities`、`/m/me/membership`；切换门店 `PUT /m/me/current-store` 写 `entity_member.last_store_id`，也属此类）；② 当前门店的单例视图（`/m/store-profile`、`/m/wallet` 等）；③ 父资源下的单例子资源（如成片包 `/m/order-items/{orderItemId}/release`、发布清单 `…/publish-list`、草稿 `/admin/delivery-plans/{deliveryPlanId}/draft`；剧目的 `basic`、`commercial`、演员 `cast`，主体的 `quota`，A61）；④ **当前会话**（A41）：`/m/sessions/current`、`/admin/sessions/current`、`/portal/sessions/current`，承载查看当前会话（`GET`，V1.0 只有下载页用）与退出登录（`DELETE`，三端，A43）。别名逐条写进该表那一项的 `aliases`，契约自测只放行登记过的别名。
- **路径以路线图与资源登记表为准，裁决原文的写法作废**（A41）：资质提交 `POST /m/store-profile/qualification/submit`（A32 原文 `/m/qualification/submit` 作废）；素材反馈 `POST /m/store-assets/{storeAssetId}/feedback`（A33 原文 `/m/assets/{assetId}/feedback` 作废；不建表，写审计并经通知中心提醒交付经理，A56）；切换门店 `PUT /m/me/current-store`（A5 原文 `/m/current-store` 作废）。资质联系人的验证码走单独路由 `POST /m/store-profile/contact/sms-codes`（嵌套在档案联系人单例视图下的 `sms-codes` 集合，A48），`POST /m/sms-codes` 只管换绑手机号。
- 不对应单表的只读聚合视图（首页、工作台、报表、上线日历等）、命名空间（`/admin/auth`）、无表的动作资源（`pii-reveals`、`pricing-changes`、`client-errors`）与 V1.1 占位，登记为 `table: null`，名字不得与表资源重名。只读聚合的判断标准：要联多张表才能得出；只读一张表的视图必须用该表的资源名（如路线图 `GET /admin/price-tiers` 改为 `GET /admin/price-tier-revisions`、`GET /m/dicts` 改为 `GET /m/dict-items`）。
- 契约自测检查：同一表只有一个资源名；路径里的每个资源段都在登记表里；参数名与登记一致；别名在白名单内；字面段先于参数段注册（C12）。
- 一个资源的接口写在同一份分组接口文档里，其他文档跨菜单引用时只写 `operationId`，不复述（本稿补充，复核意见 44；例如 `agreement_consent` 的列表与创建同归一份文档）。
- 本轮按 A5 定名的同物异名（详见 `resources.json` 的 `notes`）：付款单 `payment-orders`；下载页票据 `portal-tickets`（下载页一侧同改）；门店素材 `store-assets`（商家端 `/m/assets` 改）；文件 `files`（`/m/uploads`、`/admin/uploads` 与 `/admin/files` 合一）；成片包单例子资源统一叫 `release`（下载页 `…/delivery` 改）；申请单族保留 `-requests` 后缀（`account-change-requests`、`point-adjustment-requests`、`term-extension-requests`，A14）；协议同意 `agreement-consents`；前端错误上报 `client-errors`（三端统一）；剧目演员 `cast`（路线图 `/admin/dramas/{dramaId}/roles` 与员工角色 `roles` 重名，A61 改名）；客服工单的关联业务 `refs`（`service_ticket_ref`，只以 `/admin/service-tickets/{serviceTicketId}/refs` 嵌套访问，A92）。这些定名与第一轮在登记表里定的 `param-values`、`user-notices`、`assignment-pool-members`、`/m/me/overview` 一样，按 A41 以登记表为准。

**C11 路径参数。** 路径参数只有两类（A3）：
- **uuid**：写作“资源单数驼峰 + `Id`”，全仓唯一含义（A4）：`orderId`（订购单）、`paymentOrderId`（付款单）、`deliveryTicketId`（交付工单）、`serviceTicketId`（客服工单）、`portalTicketId`（下载页票据）、`deliveryPlanId`（交付方案）、`planId`（套餐）、`licenseLetterId`、`qualificationDocId`、`agreementVersionId`、`staffSessionId`、`portalSessionId` 等，不写 `{id}`、`{no}`、`{sid}`、`{ticketId}`、`{letterId}`、`{docId}`、`{versionId}`。与父表一对一、主键沿用父表 id 的扩展表也按此规则命名，取值等于父表 id（如 `billing_account` 的 `{pointAccountId}` 取主体 id，`production_record` 的 `{productionRecordId}` 取文件 id）。逐表的参数名见 `resources.json`。
- **以代码登记常量为主键的配置表的自然键**：`staff_role` → `{roleKey}`、`feature_flag` → `{flagKey}`、`agreement` → `{agreementKey}`、`notify_scene` → `{sceneKey}`、`wx_template_slot` → `{slotKey}`、`sms_template` → `{templateKey}`、`site_config` → `{configKey}`、`dict_type` → `{dictTypeKey}`（A3；这些表本来就不用 uuid 主键，`06-data-model.md:40`）。旧稿例外清单里的 `{checklistCode}`、`{exportKey}` 删除：`checklist_template` 主键是 uuid（`14-config-data.md:635`），导出键只出现在请求体。

不进路径的：
- **凭证**（A3）：邀请令牌、下载页票据码、授权书验真码、回调里的签名与令牌，一律放查询参数或请求体：`GET /m/invitations/lookup?token=`（接受邀请 `POST /m/invitations/{invitationId}/accept` 请求体带 `token`）、`GET /m/portal-tickets/lookup?code=`、`GET /portal/license-verifications?code=`、`/hooks/…?sig=`、`/hooks/…?token=`。访问日志对 `token`、`code`、`sig` 等参数脱敏。
- **业务单号**（`LYX…`、`FK…`、`TK…` 等，`06-data-model.md:42`）：按单号查找用列表的查询参数 `no=`。
- **集号**：放请求体或查询参数（如下载单集 `POST /m/order-items/{orderItemId}/download-urls { kind: "episode", episodeNo }`）。

**C12 方法、动作与路由顺序。**

方法：增删改查用 `GET / POST / PATCH / DELETE`；整体替换一个集合或一份配置时用 `PUT`（如 `PUT /m/me/current-store`、`PUT /admin/roles/{roleKey}`）。

`DELETE` 的范围（A7）：只用于数据模型允许物理删除的行（`06-data-model.md:74` 第 3.4 节，并 M63、M95，`rulings.md:115`、`153`）与“退出当前会话”。现行路由里合规的：三端退出登录 `DELETE /m/sessions/current`、`DELETE /admin/sessions/current`、`DELETE /portal/sessions/current`（A43；路线图的 `POST /admin/auth/logout`、`POST /portal/session/logout` 改写）；`DELETE /m/me/wechat-identities/{wechatIdentityId}`、`DELETE /m/cart-items/{cartItemId}`。其余移除、吊销、撤回、注销一律 `POST …/<动作>`：注销账号 `POST /m/me/deletion`（路线图 `DELETE /m/me` 改）；证照行 `POST /m/qualification-docs/{qualificationDocId}/remove`（不物理删除，写 `removed_at`）；取消上传 `POST /m/files/{fileId}/cancel`、`POST /admin/files/{fileId}/cancel`（后台一侧 A57 补）；吊销员工会话 `POST /admin/staff-sessions/{staffSessionId}/revoke`；后台软删除素材 `POST /admin/store-assets/{storeAssetId}/delete`（A26）；客服工单移除错误的关联业务 `POST /admin/service-tickets/{serviceTicketId}/refs/remove`（A92）。V1.1 的 `DELETE /m/favorites/{favoriteId}`、`DELETE /admin/faqs/{faqId}` 届时按同一规则核对（A64）。

动作：不是增删改查的业务动作写成 `POST /<资源>/{id}/<动作>`，动作名是短横线连接的动词，**同一语义只用一个词**（A9），取自下面的词表；`actions[]`（C16）与端上按钮映射用同一套词。动作作用于资源的附属对象时写 `<动词>-<对象>`（如 `assign-manager`、`inspect-episodes`、`push-package`），动词仍取词表。

| 词 | 含义 | 并入的路线图写法 |
| --- | --- | --- |
| `submit` | 提交审核、核验或回填 | `resubmit`（`m05.channel-account.resubmit`、`m06.ad.resubmit`） |
| `withdraw` | 提交人撤回尚未决定的申请；撤销尚未生效的修订或预约 | `a01.params.cancel` 的 `cancel` |
| `approve` / `reject` | 审批、审核或授权的决定 | — |
| `approve-review` / `reject-review` | 对公大额二人复核的决定（A14） | — |
| `confirm` | 确认某一版本或某一结果 | — |
| `request-change` | 提出修改意见 | `request-revision`（`m06.ad.request-revision`、`a05.samples.request-revision`、`a05.ads.request-revision`） |
| `cancel` | 发起方取消尚未完成的事项或任务 | 取消上传的 `DELETE` |
| `void` | 作废已出具或已批准的单据 | — |
| `retry` | 让失败的外部调用或任务重新执行 | `redeliver`（出站事件）、`reset`（死信回调） |
| `resend` | 重发通知或邮件 | `resend-email` |
| `read` | 标记已读；集合级 `POST /<集合>/read` 为批量 | `mark-read`；集合级 `read-all`、`mark-all-read` |
| `acknowledge` | 知悉 | `ack` |
| `assign` / `reassign` | 首次指派 / 改派；区分岗位时写 `assign-<岗位>`、`reassign-<岗位>` | `transfer`（客服工单转派） |
| `publish` / `unpublish` | 发布 / 撤下 | `take-offline`（V1.1 公告） |
| `shelve` / `delist` | 上架 / 下架（不用 `list`，避免与列表混淆） | `list`（短剧、套餐、积分包的上架）、`relist`（服务端按当前状态选 `drama.list` 或 `drama.relist` 迁移） |
| `download` | 下载结果文件。只出现在 `actions[]`（如导出任务的“下载”按钮），对应签发接口 `POST …/download-urls`（C60）；不作路径动作段（A134） | — |
| `update`、`create-<子资源>` | 只出现在 `actions[]`：页面上的“编辑”（对应 `PATCH`）与“从本对象发起一张新单据”（如 a07 的 `create-plan-revision`、`create-point-adjustment-request`、`create-term-extension-request`、`create-refund-request`）；不作路径动作段（A154） | — |

A44 补登的词（同样是“同一语义只用一个词”）：

| 词 | 含义 | 现行用例 |
| --- | --- | --- |
| `exchange` | 凭票据换取会话 | `portal.portalTicket.exchange` |
| `receive` | 回调收件（验签后落收件箱或内联处理） | `hooks.wechat.message.receive`、`hooks.wecom.event.receive`、`hooks.sms.statusReport.receive` |
| `verify` | 校验：回调地址校验；后台登录第二步 `verify-mfa` | `hooks.wechat.message.verify`、`hooks.wecom.event.verify`、`admin.auth.verifyMfa` |
| `wake` | 回调只当唤醒信号，结果以回查为准 | `hooks.ci.mediaJob.wake`、`hooks.asr.mediaJob.wake` |
| `notify` | 支付渠道的结果通知 | `hooks.wechatpay.transaction.notify`、`hooks.wechatpay.refund.notify` |
| `force-transition` | 人工纠偏到更正白名单内的指定步骤（写 `is_forced` 状态历史，须填原因） | `admin.deliveryTicket.forceTransition`、`admin.serviceTicket.forceTransition` |
| `rerender` | 渲染失败后重新生成文件 | `admin.licenseLetterRevision.rerender` |
| `recover` | 巡检复查确认已恢复 | `admin.patrolTask.recover` |
| `schedule` | 保存为待生效（到点由任务生效） | `admin.agreementVersion.schedule` |
| `force-logout` | 强制下线商家账号（吊销会话与下载页会话） | `admin.merchantUser.forceLogout` |

路线图里语义不与上表重叠、继续使用的词（本稿整理）：`accept`（接受邀请）、`accept-price`（接受新价）；`archive` / `restore`（停用 / 恢复）；`delete`（软删除：写删除时间、不物理删除，A26；门店的 `delete-draft` 并入）；`remove`（移出关系或草稿：成员、草稿证照行）；`leave`（本人退出主体）；`revoke`（吊销已授予的凭证或资格：邀请、电脑会话、员工会话、链接核验通过）；`discard`（放弃草稿）；`activate`（启用模板版本；后台账号激活）；`enable` / `disable`；`retire`（停用许可行）；`close`；`complete`；`reopen`；`resolve`（处理完毕：告警、不变量违规、差异单）；`reschedule`（改期，`reschedule-launch` 改约定上线日）；`inspect`；`push`；`return`（退回补充素材）；`escalate`；`check`（核查）；`remind`（催办）；`send-breach-notice`；`issue` / `issue-red`（开票 / 红冲）；`execute`（执行已批准的退款或取消）；`record-offline`；`confirm-not-accepted`；`sync`（主动查单）；`wechat-prepay`；`pack`；`start` / `commit`（上传批次）；`import`；`reorder`；`rerun`；`reissue`；`reevaluate`；`rework`；`review`（复核素材）；`reprocess`；`normalize` / `restamp` / `recheck`；`handover`；`unlock`；`erase`（A36）；`correct`（A26）；`report`（端上回报结果）；`unbind`；`test-send`；`refresh-credentials`（续签上传凭证，后台的 `renew-credential` 并入）；`mark-<状态>`（人工登记不由系统检测的事实：`mark-shared`、`mark-contacted`、`mark-normal`、`mark-abnormal`、`mark-online`、`mark-sent`；巡检的 `report-abnormal` 并入 `mark-abnormal`）。账号与认证类按原名保留：`login`、`verify-mfa`、`activate`、`set-password`、`enroll-totp`、`confirm-totp`、`step-up`、`change-password`、`bind-wecom`、`invite-wecom`、`reset-password`、`reset-mfa`、`reissue-activation-code`、`phone-login`、`change-phone`。V1.1：`rate`、`adjust-level`、`pause`、`resume`、`reply-dispute`、`record-payout`。

不是动作的字面段：`summary`（页签计数，C83）、`lookup`（凭凭证查对象摘要；邀请落地页的 `preview` 并入）、`search`、`quote` 与 `<动作>-quote`（C13）、`download-urls` 与 `playback-urls`（C60）。以名词提交的单例子资源：`deletion`（注销，A7）、`portrait-auth`（肖像授权材料，A26；商家端 `submit-portrait-auth` 并入）、`feedback`（素材反馈，A33、A41）、`draft`。新增词须先改本表。

集合动作作用在集合上：`POST /admin/takedown-tasks/check`（请求体带 id 列表）、`POST /m/messages/read`。草案的冒号写法 `episodes:register`、`episodes:qc`、`takedown-tasks:check`（`d3-flow.md:3526`、`3533`）改为普通动作段。

路由顺序（A8）：**所有字面段（GET 与 POST，如 `/summary`、`/quote`、`/lookup`、`/search`、`/check`、`/read`）先于同一层的 `/{xxxId}` 注册**，否则会被 uuid 校验拦成 400；契约自测检查。

**C13 试算与预览。** 试算与预览一律 `POST`（请求体可能很大，且不应被缓存），`x-idempotent: none`，不写库、不缓存（A20）。命名：集合级叫 `…/quote`，针对单个对象叫 `…/{id}/<动作>-quote`。现行写法（路线图里写成 GET 的改为 POST）：
- 集合级：`POST /m/orders/quote`、`POST /m/ads/quote`、`POST /m/plans/quote`；后台 `POST /admin/orders/quote`（路线图 `GET /admin/quotes/order`）、`POST /admin/plans/quote`（路线图 `GET /admin/quotes/upgrade` 与 `/renewal` 合一，请求体区分升级与续费）。
- 单个对象：`POST /admin/orders/{orderId}/cancel-quote`、`POST /admin/ads/{adId}/cancel-quote`、`POST /admin/payment-orders/{paymentOrderId}/refund-quote`、`POST /admin/point-accounts/{pointAccountId}/adjustment-quote`、`POST /admin/subscription-terms/{subscriptionTermId}/extension-quote`、`POST /admin/qualification-submissions/{qualificationSubmissionId}/reject-quote`（终局驳回影响预览，路线图 `GET …/rejection-impact`）。
- 草案的 `preview-cancel`、`cancel-preview`、`…/preview` 写法不再使用。

**C14 `operationId`。** 写作 `<m|admin|portal|hooks>.<资源单数驼峰>[.<子资源单数驼峰>].<动作驼峰>`，全仓唯一（A10）：
- 资源段取 `resources.json` 的资源名转单数驼峰；视图别名按别名的路径段取名（`/m/me` → `me`，`/m/store-profile` → `storeProfile`，`/m/wallet` → `wallet`，`/<端>/sessions/current` → `session.current`：`m.session.current.delete`、`admin.session.current.delete`、`portal.session.current.get`、`portal.session.current.delete`）；回调的 provider 段占资源位（`hooks.wechatpay.transaction.notify`）。
- 根路径探活不分配 operationId（A42、A83），路线图里的 `hooks.health.get` 这类只是登记键（`registryKeyOnly`，C1）。
- 动作：`list`（GET 集合）、`get`（GET 单个或单例）、`create`（POST 集合）、`update`（PATCH）、`replace`（PUT）、`delete`（DELETE），或 C12 的词与字面段转驼峰（`requestChange`、`summary`、`lookup`、`quote`、`cancelQuote`、`downloadUrls`、`playbackUrls`）。
- 子资源：嵌套集合与单例子资源占子资源位：`admin.store.activity.list`、`admin.deliveryTicket.sample.create`、`m.orderItem.release.get`、`m.me.deletion.create`、`m.me.membership.leave`；签发地址如 `m.sample.downloadUrls`、`portal.sample.playbackUrls`、`admin.deliveryTicket.material.downloadUrls`。
- **集合上的写动作加 `batch` 前缀**：`admin.takedownTask.batchCheck`、`m.message.batchRead`、`m.analyticsEvent.batchCreate`、`admin.calendarDay.batchImport`、`admin.homeBanner.batchReorder`。
- 例：`m.sample.confirm`、`admin.refundRequest.approve`、`admin.drama.shelve`（上架不叫 `list`，避免与 `admin.drama.list` 重名）、`admin.order.cancelRequest.create` 与 `admin.ad.cancelRequest.create`（嵌套创建靠父资源区分）。
- 它同时是幂等记录的 `scope`（`d7-platform.md:418`；`01-kernel-flow.md:55`），**发布后不改名**。路线图每条补 `operationId` 字段（A10），路线图现有的 `m01.session.silent-login` 这类 id 只是路线图内部编号，不是 operationId。限流档位、版本门槛豁免、协议同意白名单都按 operationId 登记（A1）。

**C15 JSON 字段与查询参数命名。** JSON 字段与查询参数一律小驼峰；数据库列是蛇形，由契约 schema 映射（草案里的接口字段都是驼峰：`expectAmountFen`、`viewerRole`、`durationMs`，`d2-payment.md:492`、`d4-identity.md:882`、`d5-media.md:1436`）。后缀约定：标识 `…Id`、单号 `…No`、时刻 `…At`、日期 `…Date`、金额 `…Fen`、积分 `…Points`、比例 `…Bp`、毫秒时长 `…Ms`、字节数 `…Bytes`、脱敏串 `…Mask`。密文列 `…_enc`、盲索引 `…_bidx`、`seq` 不出接口（`06-data-model.md:39`、`56`）。查询参数的页签、关键词见 C45。

**C16 可执行动作。** 列表与详情的 DTO 带 `actions: string[]`，列出当前观察者此刻可执行的动作名（取 C12 的词表），端上只据此显示按钮，不自己推状态机（`d7-platform.md:260`、`606`）。

---

## 3. 公共请求头与响应头

**C17 请求头。**

| 头 | 谁带 | 哪些接口必须带 | 服务端行为 | 出处 |
| --- | --- | --- | --- | --- |
| `Authorization: Bearer <令牌>` | 小程序 | `x-auth` 为 `user` / `member`；`optional` 可带 | 见 C3 | `d7-platform.md:396` |
| `X-Store-Id: <uuid>` | 小程序 | `x-auth: member` 的全部路由 | 逐请求查成员关系，主体由门店推出；缺失或无成员关系 → 403 `NOT_A_MEMBER`（门店不存在与无权不作区分）；已停用门店的老板只得到收尾能力，其余 403 `STORE_ARCHIVED`（领域码，由 m02 定义，C28） | `d4-identity.md:811-827` |
| `X-Client-Platform` | 小程序 | 全部 `/m` | 取值 `ios / android / harmony / windows / mac / devtools`；用于开关求值、购买入口策略、日志 | `d7-platform.md:398` |
| `X-Client-Version` | 三端 | 全部 `/m`、`/admin`、`/portal`（缺失时的处理待确认） | 小程序为版本号（用于 C71 的最低版本判断）；后台与下载页为构建号 | `d7-platform.md:398` |
| `X-Env-Version` | 小程序 | 全部 `/m` | `develop / trial / release`；只用于内部测试与灰度，不得让送审版本与线上表现不同 | `d7-platform.md:398`、`529` |
| `X-Request-Id: <uuid>` | 三端 | 建议全部带 | 只接受 36 字符 UUID，不符合即丢弃并重新生成；写入日志、出站事件与任务；回包头原样返回；重放时沿用原值 | `d7-platform.md:399`、`616` |
| `Idempotency-Key` | 三端 | `x-idempotent: required` 的路由（C47） | ≤128 字符，字符集 `[A-Za-z0-9:_-]`，形如 `<动作名>:<uuid>`（动作名不含点） | `d7-platform.md:400`；`01-kernel-flow.md:57` |
| `X-LYX-Admin: 1` / `X-LYX-Portal: 1` | 后台 / 下载页 | 全部非 GET | 缺失或 `Origin` 不符 → 403 `ORIGIN_REJECTED` | `d7-platform.md:401`；`d4-identity.md:1080`、`1358` |
| `X-Poll-Secret` | 下载页 | `GET /portal/portal-tickets/{portalTicketId}`（`portal.portalTicket.get`） | 与票据的 `poll_secret_hash` 比对 | `d7-platform.md:1254` |

门店上下文用请求头而不用路径参数，是 d4 的取舍（`d4-identity.md:844-846`）。d3、d5 草案有 11 条 `/m/stores/{sid}/…` 路径（d3 8 条、d5 3 条，如 `d3-flow.md:3506`、`3511`、`3514`；`d5-media.md:2093-2094`），统一改为不带门店段、由 `X-Store-Id` 给出上下文。只有“门店本身是操作对象”时才在路径里出现门店 id（`/m/stores/{storeId}/archive`，`d4-identity.md:2265`），此时仍校验路径门店与 `X-Store-Id` 同属一个主体（本稿补充）。切换门店是纯客户端行为，`PUT /m/me/current-store` 只记住选择（`d4-identity.md:827`）。

**C18 响应头。** `X-Request-Id`（总是返回）；`Idempotent-Replayed: true`（幂等重放时，`d7-platform.md:438`）；`Retry-After`（429 与 503 时，秒数，含 503 `MAINTENANCE`，本稿补充）；`X-Admin-Build`（后台接口返回当前构建号，前端不一致时提示刷新，`d7-platform.md:947`）。`Cache-Control: no-store` 用于含签名地址或个人数据的响应（签名地址不得进任何可缓存的公共响应，`d5-media.md:1422`）。

**C19 超时与重试（端上）。** 小程序：普通请求 15 秒、带幂等键的写 30 秒；GET 网络失败自动重试 1 次；带幂等键的写网络失败自动重试至多 2 次（1 秒、3 秒）；不带键的写不自动重试；业务请求并发至多 6 个（`d7-platform.md:614-619`）。`app.json` 的 `networkTimeout` 为 request 30 秒、uploadFile 300 秒、downloadFile 600 秒（`d7-platform.md:642`）。GET 会被自动重试、预取与窗口聚焦重发，这是 C60“GET 不写库”的原因之一。

**C20 单飞恢复。** 会弹框或改全局状态的恢复（静默登录、协议同意、重拉 `/m/me`、提示更新、重拉引导、后台再验证、跳登录页）同类只执行一次，并发请求共享结果（`d7-platform.md:633-638`、`1111`）。只有“本次确实带了凭据仍被拒”才清登录态（`d7-platform.md:639`）。

---

## 4. 响应格式与错误码

**C21 成功体。** 沿用 d7：

```json
{ "code": 0, "message": "ok", "data": { } }
```

`data` 是该接口在契约里声明的 schema；没有返回内容的写接口 `data` 为 `null`（`d7-platform.md:258`）。列表的 `data` 见 C42、C43。

**C22 错误体。**

```json
{
  "code": 40901,
  "error": "VERSION_CONFLICT",
  "message": "内容已被他人修改，请刷新后重试",
  "retryable": false,
  "requestId": "0192…",
  "fieldErrors": [ { "path": "items.0.dramaId", "message": "请选择短剧" } ],
  "details": { }
}
```

| 字段 | 含义 | 出处 |
| --- | --- | --- |
| `code` | 数值码，只用于日志与排障 | `d7-platform.md:262` |
| `error` | 符号名，端上逻辑只按它判断 | `d7-platform.md:262` |
| `message` | 能直接给用户看的话；端上对未特殊处理的领域错误直接提示它 | `d7-platform.md:282` |
| `retryable` | 用同一请求（同一幂等键）稍后重试是否可能成功，见 C26 | 本稿补充 |
| `requestId` | 等于回包头 `X-Request-Id`；端上提示里带后 8 位 | `d7-platform.md:399` |
| `fieldErrors` | 仅 `VALIDATION_FAILED`；`path` 是点分路径（数组下标写数字），可直接映射到表单字段 | `d7-platform.md:266`、`1159` |
| `details` | 该错误码在契约里声明的附加数据，如 `QUOTE_CHANGED` 带新报价、`POINTS_INSUFFICIENT` 带缺口数、`OPEN_ORDER_EXISTS` 带单号 | `d1-ledger.md:1724`；`d2-payment.md:497`、`504` |

取舍：d7 写的是 `{ code, error, message, details? }`，并把字段错误放在 `details[{path,message}]`（`d7-platform.md:258`、`266`）。本文把字段错误拆到 `fieldErrors`，让 `details` 在每个错误码下有唯一的类型；另加 `retryable` 与 `requestId`。

**C23 双通道。** 端上先看响应体的 `error`，没有响应体（网关直接返回的 413、502 等）再看 HTTP 状态（`d7-platform.md:620`）。

**C24 HTTP 状态码。**

| 状态 | 用于 |
| --- | --- |
| 200 | 全部同步成功，包括创建（不用 201 / 204，便于两端统一解包）。业务上的拒绝结果需要落库时也用 200，在 `data.status` 里表达（下载页配对数字不一致作废票据，A101、C5） |
| 202 | 只用于“已收下、未处理”的转发类接口：前端错误上报 `POST /<端>/client-errors`（`d7-platform.md:890`） |
| 400 | 入参不合 schema；业务规则拒绝了输入本身（如 `CONTENT_REJECTED`，`d4-identity.md:2317`）。d5 的上传拒收用 422（`d5-media.md:1037`），本文改为 400，不使用 422 |
| 401 | 未登录或会话失效；后台登录失败 |
| 403 | 已登录但无权：成员关系、角色能力、权限点、再验证、开关、访问面、防跨站 |
| 404 | 资源不存在，**或不在当前门店 / 主体 / 数据范围内**（不区分两者，`d4-identity.md:838`、`1364`） |
| 409 | 状态不允许、乐观锁冲突、唯一性冲突、名额已满、幂等键冲突、二次确认回显不符、当日已人工催办（`REMINDED_TODAY`，A76） |
| 410 | 凭证类资源已失效：邀请已使用 / 撤回 / 过期、下载页票据失效（`d4-identity.md:2325`、`2329`） |
| 426 | 客户端版本过低 `CLIENT_OUTDATED` |
| 428 | 需要先同意协议 `CONSENT_REQUIRED` |
| 429 | 限流 `RATE_LIMITED`，**只用于限流**（A76）：业务上的每日次数限制（如人工催办）不用 429，端上收到 429 一律按 `Retry-After` 退避 |
| 500 / 503 / 504 | 内部错误；外部能力不可用、系统繁忙、停机维护；上游超时 |

**C25 错误码命名与分段。** 符号名全大写蛇形、全仓唯一，不强制带模块前缀（沿用草案已有的名字）；唯一来源是 `contract/src/errors.ts`，符号、数值、HTTP 状态、默认文案、`retryable`、`details` 的 schema 同源（`d7-platform.md:262`）。数值五位：通用码用“HTTP 状态 × 100 + 序号”，领域码按模块分段：

| 段 | 模块（`01-architecture.md:163-174`） | 来源草案 | 例 |
| --- | --- | --- | --- |
| 400xx、401xx、403xx、404xx、409xx、426xx、428xx、429xx、500xx | 通用（C27） | d7、d4 | `VALIDATION_FAILED` 40001 |
| 41xxx | `identity`、`tenant`、`portal` | d4 | `INVITATION_USED`、`SEAT_LIMIT_REACHED`、`USCC_TAKEN`、`PORTAL_TICKET_INVALID` |
| 43xxx | `billing`：价目、订阅、积分账本、计价 | d1 | `POINTS_INSUFFICIENT`、`QUOTE_CHANGED` |
| 44xxx | `billing`：付款单、支付、退款、对账、发票 | d2 | `OPEN_ORDER_EXISTS`、`CHANNEL_NOT_ALLOWED` |
| 45xxx | `order`、`ad`、`delivery`、`support` | d3 | 交付分组定 |
| 46xxx | `media`、`publish` | d5、d3 | `FILE_NOT_USABLE`（m03）、发布段各码 |
| 47xxx | `notify`、`docs`、`config`、`reports`、`analytics`、`exports`；上传类 7 个码（m08，47051–47057，A77） | d6 | `AGREEMENT_VERSION_STALE`、`EXPORT_ROW_LIMIT`、`UPLOAD_NOT_FOUND` |
| 48xxx | `staff`、`authz`、`approval`、`audit`（后台侧） | d4 | `APPROVAL_SELF_FORBIDDEN`、`LAST_SUPER_ADMIN` |
| 49xxx | `content`、`profile`（本稿新增段） | d8、d9 | `REVIEW_REQUIRED`（`d9-profile.md:599`）；d8 未列错误码 |

取舍：段的划分沿用 d7（`d7-platform.md:282`），d1 建议的 41xxx（`d1-ledger.md:1722`）与之冲突，以 d7 为准；d7 没有给 d8、d9 和客服工单分段，本文补 49xxx 并把 `support` 放进 45xxx。42xxx 不分配（与 426 / 428 / 429 的通用码同段）。各分组接口文档在裁决 A70 给的区间内取号；跨文档共用的领域码只由归属文档定义一次（C28 的归属表），其他文档只引用符号名。按 A77 的归属，上传类码落在 m08 的 47xxx 区间，而不是本表 `media` 的 46xxx——段只是取号区间，不限定码的语义归属。

**C26 `retryable`。** 为真的只有：`IDEMPOTENCY_IN_PROGRESS`、`BUSY`、`RATE_LIMITED`、`PROVIDER_UNAVAILABLE`、`UPSTREAM_TIMEOUT`、`MAINTENANCE`，以及在契约里显式标了的领域码（如 `ACCOUNT_BUSY`、`CONFIRM_IN_PROGRESS`、`WECHAT_UNAVAILABLE`，`d1-ledger.md:1724`、`d5-media.md:1033`、`d4-identity.md:2315`）。为真时端上可以用**同一个幂等键**自动重试；为假时重试前必须让用户看到提示或刷新数据。

**C27 通用错误码清单。**

| 符号 | HTTP | 数值 | 可重试 | 何时 | 端上处理 | 出处 |
| --- | --- | --- | --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 40001 | 否 | 入参不合 schema（含路径参数不是 uuid） | 按 `fieldErrors` 就地标红 | `d7-platform.md:266` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 40002 | 否 | `required` 路由缺键或键格式不对 | 视为编程错误并上报 | `d7-platform.md:408`（符号本稿补） |
| `AUTH_REQUIRED` | 401 | 40101 | — | 没带凭据 | 小程序：C3 静默登录；后台、下载页：回登录 / 扫码页 | `d4-identity.md:2310` |
| `SESSION_INVALID` | 401 | 40102 | — | 凭据过期、被吊销、账号已禁用 | 同上 | `d4-identity.md:2310`、`2340` |
| `AUTH_FAILED` | 401 | 40103 | 否 | 后台登录失败（不区分原因） | 统一文案 | `d4-identity.md:1029` |
| `PERMISSION_DENIED` | 403 | 40301 | 否 | 后台模块等级或权限点不足 | 提示；重拉 `/admin/auth/me` | `d7-platform.md:269` |
| `NOT_A_MEMBER` | 403 | 40302 | 否 | 缺 `X-Store-Id` 或对该门店无成员关系 | 重拉 `/m/me`，回门店选择 | `d7-platform.md:270`；`d4-identity.md:821` |
| `ROLE_FORBIDDEN` | 403 | 40303 | 否 | 商家角色没有该能力点，或该角色没有该资源的视图（`clerkView: none`） | 提示“仅老板可操作” | `d4-identity.md:897`、`2319` |
| `STEP_UP_REQUIRED` | 403 | 40304 | 否 | 注册表标了再验证的权限点超出 10 分钟窗口；C86 登记的驳回接口不检查 | 弹再验证，通过后重放 | `d7-platform.md:271` |
| `ORIGIN_REJECTED` | 403 | 40305 | 否 | 非 GET 缺 `X-LYX-*` 头或 `Origin` 不符 | 编程错误 | `d4-identity.md:1358`（符号本稿补） |
| `FEATURE_DISABLED` | 403 | 40306 | 否 | 受开关控制的路由已关闭 | 重拉引导，隐藏入口 | `d7-platform.md:272` |
| `IP_NOT_ALLOWED` | 403 | 40307 | 否 | 后台访问面白名单拒绝 | 说明页 | `d4-identity.md:2330` |
| `NOT_FOUND` | 404 | 40401 | 否 | 资源不存在或不在范围内 | 提示并返回上一页 | `d4-identity.md:838`（符号本稿补） |
| `VERSION_CONFLICT` | 409 | 40901 | 否 | `lockVersion`（或 C52 列出的例外字段）不符 | “内容已被他人修改”，给“查看最新” | `d7-platform.md:273`、`1166` |
| `STATE_NOT_ALLOWED` | 409 | 40902 | 否 | 当前状态不允许该动作（新请求；同键重放不会走到这里，C47） | 刷新；提示“已被处理” | `d7-platform.md:273` |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 40903 | 否 | 同一键、不同请求内容 | 换键 | `d7-platform.md:274` |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 40904 | 是 | 三段式用例处理中 | 1 秒后重试，至多 5 次 | `d7-platform.md:275` |
| `CONFIRM_MISMATCH` | 409 | 40905 | 否 | 二次确认回显与库中当前值不一致 | 刷新详情，重新确认 | `d4-identity.md:1375`、`2334` |
| `PRECONDITION_CHANGED` | 409 | 40906 | 否 | 审批或执行时前提已变 | 刷新 | `d4-identity.md:2336`；`d1-ledger.md:1724` |
| `REMINDED_TODAY` | 409 | 40920 | 否 | 同一对象同一场景当日已人工催办过一次（`manual_reminder_log` 唯一冲突，`13-notify-docs.md:614`）；用于交付工单、广告、巡检、套餐周期等的催办 | 提示“今天已催办过”，不自动重试 | A76 |
| `CLIENT_OUTDATED` | 426 | 42601 | 否 | 版本低于最低版本 | 引导更新，不重放 | `d7-platform.md:276` |
| `CONSENT_REQUIRED` | 428 | 42801 | 否 | 有未同意的现行协议版本 | 弹协议，同意后重放 | `d7-platform.md:277`；`d6-notify-docs-data.md:1168` |
| `RATE_LIMITED` | 429 | 42901 | 是 | 限流 | 按 `Retry-After` 退避 | `d7-platform.md:278` |
| `INTERNAL` | 500 | 50000 | 否 | 未预期错误 | 全局提示，带请求编号后 8 位 | `d7-platform.md:279` |
| `PROVIDER_UNAVAILABLE` | 503 | 50001 | 是 | 外部能力不可用（含文本内容安全检测不可用，A137，见下） | 稍后重试 | `d7-platform.md:279` |
| `UPSTREAM_TIMEOUT` | 504 | 50002 | 是 | 外部能力超时 | 稍后重试 | `d7-platform.md:279` |
| `BUSY` | 503 | 50003 | 是 | 锁等待超时、事务超时、死锁重试失败 | 600 毫秒后自动重试 1 次 | `d7-platform.md:280`、`630` |
| `MAINTENANCE` | 503 | 50004 | 是 | 停机维护（A39 采纳，见 C72） | 维护说明页，按 `Retry-After` 与引导的 `notice` 展示 | A39 |

取舍：① d7 把 `PERMISSION_DENIED` 与 `ROLE_FORBIDDEN` 都记为 40301（`d7-platform.md:269`），一个是后台权限点、一个是商家能力点，本文拆成两个数值。② `SESSION_REVOKED` 按 d4 作废（`d4-identity.md:2340`），以 `SESSION_INVALID` 代替。③ 状态冲突统一用 `STATE_NOT_ALLOWED`；d3 的 `INVALID_TRANSITION`（`d3-flow.md:3168`）并入它；带额外信息的领域码（`APPROVAL_NOT_PENDING`、`OPEN_ORDER_EXISTS` 等）可以保留。④ d3 写的“死锁重试仍失败返回请重试而不是 500”（`d3-flow.md:3178`）即 `BUSY`。⑤ `REMINDED_TODAY` 在数据模型 13 分组、草案与 a06 初稿里是 429（a06 定义为 46201），与“429 只给限流”冲突；A76 改为通用码 409 / 40920，a05、a06、a07 只引用，a06 的 46201 释放。

**两个通用码的 `details`**（A131；同一个码的 `details` 类型唯一，C22）：

| 符号 | `details` | 说明 |
| --- | --- | --- |
| `CONSENT_REQUIRED` | `{ pendingConsents: PendingConsent[] }` | `PendingConsent` 归 m01（C87）；协议同意中间件（C73）与 m01 的处理器返回同一结构 |
| `REMINDED_TODAY` | `{ scene, nextAvailableDate }` | `nextAvailableDate` 是下次可催办的日期（C35）；字段名与 a05 的 `RemindResult` 一致 |

**文本内容安全检测不可用时拒收**（A137）：
- 带用户文本、要过文本内容安全检测的写接口：检测不通过返回 400 `CONTENT_REJECTED`（m01 定义，C28）。
- 检测服务不可用时，V1.0 一律拒收：返回 503 `PROVIDER_UNAVAILABLE`（可重试，C26），不写库。
- 草案“先接受、排队补检”的做法（`d4-identity.md:1883`、d5 第 11 节）数据模型没有落点，V1.0 不做；x01 不登记补检事件。m01、m02、m03、m06 按此写。
- 图片与视频的检测仍按 d5（异步）。

**C28 领域错误的写法。** 各分组接口文档在“错误”一栏只列本接口可能返回的领域码与通用码中有特殊含义的那几个；新领域码写明 HTTP 状态、`retryable`、`details` 的结构，由契约分配数值。服务端 `message` 写成能直接给用户看的话，按设计规范的文案规则（“请……”开头的校验提示、说明原因与出路，`design-spec.md:760-761`）。

**共用领域码归属表**（A77、A131）：**本表由清单自动生成，归属 = 定义方**。
- 归属 = 在自己的清单（`frag/<文档>.json` 的 `errorCodes`）里定义该码的文档；引用方 = 在 `errors` 里用到它、但不定义它的其他清单；数值、HTTP、`retryable`、`details` 一律取自定义方。
- 多份文档都会返回的领域码只定义一次，其他文档只引用符号名，不重新定义。
- 下表由 `tools/api-check/gen_registries.py` 按定稿时的清单生成（被定义方之外至少一份文档引用的领域码）；改了清单后重新生成。全部错误码见 [错误码登记表](registry-errors.md)。

| 符号 | 归属文档 | 数值 | HTTP | 引用方 | `details` |
| --- | --- | --- | --- | --- | --- |
| `CONTENT_REJECTED` | m01-account | 41006 | 400 | a03-merchant、m02-tenant、m03-profile-asset、m06-ad | { fields: string[] } |
| `SMS_UNAVAILABLE` | m01-account | 41007 | 503 | m03-profile-asset | — |
| `SMS_CODE_INVALID` | m01-account | 41008 | 400 | m03-profile-asset | { attemptsLeft: integer \| null } |
| `PHONE_UNCHANGED` | m01-account | 41009 | 400 | a03-merchant | — |
| `PHONE_TAKEN` | m01-account | 41010 | 409 | a03-merchant | — |
| `PHONE_IN_OTHER_ENTITY` | m02-tenant | 41103 | 409 | a03-merchant | { currentRole: 'owner' \| 'clerk' } |
| `QUOTA_EXCEEDED` | m02-tenant | 41106 | 409 | m04-mall-order、m06-ad | { storesUsed, storeLimit, storesOver } |
| `STORE_ARCHIVED` | m02-tenant | 41107 | 403 | m04-mall-order、m06-ad、m08-support-misc | — |
| `PORTAL_TICKET_INVALID` | p01-portal | 41201 | 410 | m02-tenant | { reason: not_found \| expired \| rejected \| consumed \| approved \| secret_mismatch }（各接口取值见文档第 5 节） |
| `PLAN_NOT_AVAILABLE` | m07-billing | 43001 | 409 | a05-order-delivery、a07-billing-finance | — |
| `CYCLE_NOT_AVAILABLE` | m07-billing | 43002 | 400 | a07-billing-finance | { enabledCycles } |
| `UPGRADE_NOT_ALLOWED_TODAY` | m07-billing | 43003 | 409 | a07-billing-finance | { suggest: 'renew_next_term' } |
| `SCHEDULED_TERM_LIMIT` | m07-billing | 43004 | 409 | a07-billing-finance | { maxScheduledTerms } |
| `TOPUP_REQUIRES_ACTIVE_PLAN` | m07-billing | 43005 | 409 | a07-billing-finance | — |
| `PLAN_REFUND_IN_PROGRESS` | m07-billing | 43006 | 409 | a07-billing-finance、m04-mall-order、m06-ad | — |
| `QUOTE_CHANGED` | m07-billing | 43007 | 409 | a07-billing-finance、m04-mall-order、m06-ad | QuoteChangedDetails：{ kind: 'plan', amountFen, quote: PlanQuote } \| { kind: 'topup', amountFen, pointPack: { pointPackId, points, priceFen } } \| { kind: 'points', totalChargePoints, items: [{ dramaId: uuid \| null, chargePoints }] } |
| `ACCOUNT_BUSY` | m07-billing | 43008 | 503 | a05-order-delivery、a07-billing-finance、m04-mall-order、m06-ad | — |
| `POINTS_INSUFFICIENT` | m07-billing | 43009 | 409 | m04-mall-order、m06-ad | { requiredPoints, spendablePoints, shortfallPoints } |
| `SUBSCRIPTION_INACTIVE` | m07-billing | 43010 | 409 | m04-mall-order、m06-ad | — |
| `REVISION_ALREADY_EFFECTIVE` | a07-billing-finance | 43104 | 409 | a04-content | `{ effectiveAt, cancelledAt }` |
| `PURCHASE_QUALIFICATION_REQUIRED` | m07-billing | 44003 | 409 | a07-billing-finance | { verificationStatus } |
| `OPEN_ORDER_EXISTS` | m07-billing | 44004 | 409 | a07-billing-finance | { paymentOrderId, orderNo } |
| `PAYMENT_ORDER_EXPIRED` | m07-billing | 44006 | 409 | a07-billing-finance | { expiresAt } |
| `TRANSFER_PROOF_LOCKED` | m07-billing | 44009 | 409 | a07-billing-finance | — |
| `REFUND_EXECUTOR_CONFLICT` | a07-billing-finance | 44114 | 403 | a05-order-delivery | — |
| `STORE_NOT_QUALIFIED` | m04-mall-order | 45008 | 409 | m05-delivery-publish、m06-ad | { storeId, reason: not_submitted \| pending_review \| rejected \| final_rejected } |
| `ORDER_IN_AFTER_SALE` | m05-delivery-publish | 45101 | 409 | a05-order-delivery | { orderId } |
| `TICKET_ON_HOLD` | m05-delivery-publish | 45103 | 409 | a05-order-delivery、a06-publish | { reasons: ('cancel_review'\|'plan_amendment')[] } |
| `SAMPLE_VERSION_STALE` | m05-delivery-publish | 45104 | 409 | a05-order-delivery | { currentSampleId: string \| null, currentVersionNo: integer \| null } |
| `AD_CHANGED` | m05-delivery-publish | 45105 | 409 | a05-order-delivery | { adIds: string[] } |
| `SAMPLE_VIEW_CHANNEL_NOT_OFFERED` | m05-delivery-publish | 45107 | 409 | p01-portal | { previewChannels: PreviewChannel[] }（该版本提供的查看方式；与 m06 AD_PREVIEW_CHANNEL_UNAVAILABLE 同一枚举） |
| `SAMPLE_PREVIEW_NOT_READY` | m05-delivery-publish | 45108 | 409 | p01-portal | — |
| `DOWNLOAD_GRANT_INVALID` | m05-delivery-publish | 45109 | 409 | a06-publish、p01-portal | { reason: DownloadGrantInvalidReason, expiresAt: string \| null, canRegenerate: boolean } |
| `DOWNLOAD_NOT_AVAILABLE` | m05-delivery-publish | 45110 | 409 | p01-portal | { reason: DownloadUnavailableReason } |
| `AD_CANCEL_IN_PROGRESS` | m06-ad | 45201 | 409 | a05-order-delivery | — |
| `AD_VERSION_STALE` | m06-ad | 45202 | 409 | a05-order-delivery、p01-portal | { currentVersionNo: integer \| null } |
| `AD_PREVIEW_CHANNEL_UNAVAILABLE` | m06-ad | 45203 | 409 | p01-portal | { previewChannels: PreviewChannel[] } |
| `PLAYABLE_UNAVAILABLE` | m06-ad | 45206 | 409 | p01-portal | { state: PlayableState } |
| `ASSIGNEE_INVALID` | a05-order-delivery | 45308 | 409 | a01-system、a03-merchant、a08-support | { staffId: string, reason: AssigneeInvalidReason }（not_active \| role_mismatch \| same_as_current \| out_of_scope，x-open-enum） |
| `REMIND_NOT_APPLICABLE` | a05-order-delivery | 45309 | 409 | a07-billing-finance | `{ scene, reason }` |
| `FILE_NOT_USABLE` | m03-profile-asset | 46001 | 400 | a01-system、a03-merchant、a04-content、a05-order-delivery、a06-publish、a07-billing-finance、a08-support、a09-ops、m04-mall-order、m05-delivery-publish、m06-ad、m07-billing、m08-support-misc | { fileIds: string[], reason: FileNotUsableReason }（x-open-enum：not_stored \| category_mismatch \| scope_mismatch \| blocked \| duplicate \| ext_mismatch \| context_mismatch） |
| `ASSET_UPLOAD_GATED` | m03-profile-asset | 46002 | 409 | m08-support-misc | — |
| `DICT_ITEM_DISABLED` | m08-support-misc | 47001 | 409 | a01-system、a04-content、a06-publish、a08-support、m02-tenant、m03-profile-asset、m06-ad | { dictTypeKey, code } |
| `FILE_TYPE_NOT_ALLOWED` | m08-support-misc | 47051 | 400 | a01-system | { allowedExts: string[] } |
| `FILE_TOO_LARGE` | m08-support-misc | 47052 | 400 | a01-system | { maxBytes: string, canDelegate: boolean } |
| `UPLOAD_EXPIRED` | m08-support-misc | 47053 | 409 | a01-system、a04-content | — |
| `UPLOAD_CREDENTIAL_LIMIT` | m08-support-misc | 47054 | 409 | a01-system | — |
| `CONFIRM_IN_PROGRESS` | m08-support-misc | 47055 | 409 | a01-system、a04-content | — |
| `UPLOAD_NOT_FOUND` | m08-support-misc | 47056 | 409 | a01-system、a04-content | — |
| `UPLOAD_REJECTED` | m08-support-misc | 47057 | 400 | a01-system、a04-content | { rejectReason } |
| `CHECKLIST_VERSION_STALE` | a01-system | 47306 | 409 | a05-order-delivery、a06-publish | { code, currentVersionNo } |
| `CHECKLIST_NOT_PASSED` | a01-system | 47307 | 400 | a05-order-delivery、a06-publish | { missingKeys: string[], failedKeys: string[], invalidNaKeys: string[] } |
| `AGREEMENT_VERSION_STALE` | m01-account | 47401 | 409 | m04-mall-order、m06-ad、m07-billing | { agreementKey: string, currentAgreementVersionId: string(uuid) \| null } |
| `APPROVAL_NOT_PENDING` | a03-merchant | 48201 | 409 | a05-order-delivery、a06-publish、a07-billing-finance | { status, decidedAt } |
| `APPROVAL_SELF_FORBIDDEN` | a03-merchant | 48202 | 403 | a05-order-delivery、a06-publish、a07-billing-finance | — |
| `APPROVAL_ALREADY_PENDING` | a03-merchant | 48203 | 409 | a07-billing-finance | { approvalId, requestNo } |
| `APPROVAL_WITHDRAW_FORBIDDEN` | a03-merchant | 48204 | 403 | a05-order-delivery、a07-billing-finance | — |
| `PROFILE_REQUIRED_MISSING` | m03-profile-asset | 49002 | 400 | a03-merchant | { fields: string[] } |
| `STORE_PROFILE_INCOMPLETE` | m03-profile-asset | 49006 | 409 | m04-mall-order | { missing: [{ step, item: MissingItemKey, permitType: string \| null }] } |
| `INDUSTRY_NOT_OPEN` | m03-profile-asset | 49007 | 409 | m02-tenant、m04-mall-order | { field: 'industry' \| 'region', code } |
| `USCC_TAKEN` | m03-profile-asset | 49012 | 409 | a03-merchant | — |
| `BATCH_PURPOSE_MISMATCH` | a04-content | 49215 | 409 | a05-order-delivery | { purpose } |

`REMINDED_TODAY` 已升为通用码（C27，A76），不在本表。

第三轮裁决对本表的影响（已由定义方的清单落实，上表已带出）：
- 归属：`STORE_PROFILE_INCOMPLETE` 归 m03（49xxx 区间），m04 只引用（A123）；补登 `PLAN_REFUND_IN_PROGRESS`，归 m07，43006（A131）。
- `details` 定型（A131）：

| 符号 | `details` | 备注 |
| --- | --- | --- |
| `CONTENT_REJECTED` | `{ fields: string[] }` | 默认文案用通用说法 |
| `POINTS_INSUFFICIENT` | `{ requiredPoints, spendablePoints, shortfallPoints }` | — |
| `QUOTE_CHANGED` | m07 的 `QuoteChangedDetails`，按 `kind` 判别：`plan`、`topup`、`points` | m04 订购用 `points` 分支，不另起 `drama_order`；a05 的 `CANCEL_QUOTE_CHANGED` 语义不同（退回试算），保留 |

---

## 5. 数据格式

**C29 标识。** 业务表主键是应用生成的 UUID v7，接口里是小写、带连字符的 36 字符字符串（`06-data-model.md:38`；`03-key-designs.md:601` R1；`04-adr.md:86`）。d7 写的 `bigint` 十进制字符串（`d7-platform.md:253`）已被 R1 取代。只增表的 `seq` 不出接口（`06-data-model.md:39`）。按 id 取资源一律带租户范围，不属于当前门店或主体的返回 404（`d4-identity.md:828-838`）。

**C30 业务单号。** 字符串，字段名 `…No`（`orderNo`、`refundNo`），只用于展示、搜索与对外沟通，不作接口间引用（`06-data-model.md:42`）。

**C31 金额。** 整数分，字段名以 `Fen` 结尾，JSON 数字（`06-data-model.md:49`；`04-adr.md:63`）。后台输入“元”（最多两位小数），提交前按字符串拆分换算成分，不用浮点乘 100（`d7-platform.md:1160`）。显示格式由端上按设计规范处理（`design-spec.md:741`）。**例外**（A90）：跨主体的汇总金额（报表、对账的合计）出接口为 `string(bigint)`，字段名仍以 `Fen` 结尾，按 C33 校验；单据金额与单主体金额仍是 JSON 整数。报表快照的载荷与响应同构（`14-config-data.md` 第 4.9 节）。

**C32 积分与比例。** 积分是非负或带符号的整数，字段名以 `Points` 结尾；比例是万分比整数，字段名以 `Bp` 结尾（9 折 = 9000）（`06-data-model.md:50-51`；`d7-platform.md:255`）。

**C33 大整数。** 数据库为 `bigint` 的列（对账日汇总的 7 个金额合计、媒体成本估算、字节数等）出接口时转十进制字符串，schema 写 `z.string().regex(/^-?\d+$/)`，字段名后缀不变（如 `sizeBytes: "5368709120"`）（`06-data-model.md:52`；`rulings.md:28` M15）。

**C34 时刻。** ISO 8601 带偏移。服务端输出统一为 UTC、毫秒三位、以 `Z` 结尾（即 `Date.prototype.toISOString()` 的结果，如 `2026-10-02T04:13:20.000Z`）；输入接受任意偏移，不带偏移的拒绝（400）。字段名以 `At` 结尾（`06-data-model.md:48`；`d7-platform.md:256`）。展示一律按 `Asia/Shanghai`（`d7-platform.md:1161`）。端上用引导接口的 `serverTime` 校正时钟（`d7-platform.md:475`）。本稿取舍：d7 只写“带偏移”，d5 的示例用 `Z`（`d5-media.md:1442`），本文定为输出 `Z`。

**C35 日期与月份。** “哪一天”用 `YYYY-MM-DD`，由服务端按北京时间算好下发；字段名以 `Date` 结尾。输入的日期由服务端按字段语义解释成当天 00:00 或 24:00，前端不拼时刻（`d7-platform.md:256`、`1161`；`06-data-model.md:48`）。月份用 `YYYY-MM`（如 `month=2026-09`，`d2-payment.md:1475`）。

**C36 时长与大小。** 时长用整数毫秒 `…Ms`（`durationMs`，`d5-media.md:1436`）；规则里以秒计的参数保持 `…Sec`。文件大小用 `…Bytes`（字符串，见 C33）。

**C37 枚举。** 取值小写蛇形，唯一来源是 `packages/contract` 的 Zod enum，与数据模型 CHECK 的取值一致（`06-data-model.md:53`）。会增长的响应枚举（状态、类型）标 `x-open-enum`，生成的类型为 `已知值 | (string & {})`，端上必须有未知值的兜底展示（`d7-platform.md:243`）。新增取值遵守“先声明、下一版再写入”（`d7-platform.md:247`；`04-adr.md:36`）。同义的取值全仓统一，不同文档不为同一含义各起一个值（A134：未完成订单的阻断项统一为 `open_order`，m01 的 `order_open` 改名）。

**C85 字典编码的出入形态。**（A133）字典项（`dict_item`）不是契约 enum，按下表出入接口：

| 方向 | 形态 | 字段名 | 例 |
| --- | --- | --- | --- |
| 响应（多值） | `DictRef[]`，`DictRef = { code, name }`（C87） | 不带 `Codes` 后缀 | `genres` |
| 响应（单值） | `DictRef \| null`（A151） | 不带 `Code` 后缀 | `industry`、`city`、`rejectReason` |
| 请求（多值） | 编码数组 `string[]` | 带 `Codes` 后缀 | `genreCodes` |
| 请求（单值） | 编码 `string` | 带 `Code` 后缀 | `industryCode` |

- 快照与业务行里存的是编码；响应里的名称按当前字典取，字典项停用后仍返回名称。
- 请求里新选的编码不在字典里或已停用，返回 409 `DICT_ITEM_DISABLED`（m08 定义，C28）。
- 现有写法按此改：如 m05 响应里的 `genreCodes` 改为 `genres`；成对出现的 `xxxCode` + `xxxName` / `xxxLabel` 合并为一个 `DictRef`（A151）。
- 只适用于字典项编码；数据库枚举（CHECK 取值，C37）与业务编号（`planCode`、`checklistCode`、激活码等）不变。

**C38 可空与缺省。** 响应：契约声明的键总是出现；没有值写 `null`，不省略；数组没有元素写 `[]`，不写 `null`。请求：可选字段不传表示“未提供”；`PATCH` 里不传 = 不改，传 `null` = 清空（仅对可空字段）。请求体里未声明的键被忽略（Zod 默认剥离），不报错——服务端回滚到上一版时，新版前端多带的字段不会让请求失败；埋点事件例外，按事件 schema 严格校验（`d7-platform.md:872`）。（本稿补充）

**C39 布尔。** 不允许三态（不可空）；命名用 `is` / `has` / `can` / `need` 开头或以 `Enabled` 结尾，与数据库列的约定一致（`06-data-model.md:82`；`d4-identity.md:317` 的 `needPhone`）。能用时刻表达的不用布尔（`viewedAckAt` 而不是 `viewedAck`）。导出请求的 `masked` 按此改为 `isMasked`（列名 `is_masked`，`14-config-data.md:925`）。

**C40 敏感字段与手机号来源。**
- 手机号、统一社会信用代码、银行账号等默认只返回脱敏串（`phoneMask`），本人看自己的手机号也是脱敏值（`d4-identity.md:1721-1722`；脱敏规则 `d4-identity.md:1713-1719`、`design-spec.md:767-775`）。
- 后台看明文一律 `POST /admin/pii-reveals`（`admin.piiReveal.create`，请求体指明对象与字段），先写访问审计再返回，限频每名员工 60 次 / 小时、300 次 / 天（`d4-identity.md:1722`；档位 `admin.pii_reveal`，C68）；幂等 `none`，结果含明文、不进幂等记录（A51）；权限按对象与字段在处理器里判定（`assert-in-handler`，C66）。**任何 GET 详情都只返回脱敏值**（A19）：路线图里在 GET 中返回明文并记审计的写法改掉——资质审核详情的证照号（原 `a01.approvals.get`，`d9-profile.md:517`）、同意记录证据里的手机号（`a09.agreement-consents.get`）。草案的 `POST /admin/pii/reveal` 按 A6 去掉分组段。
- **明文例外**（A89，两项都待法务、财务确认，见第 15 节）：① 平台对公收款账号对商家返回明文（商家要复制去转账，解密 `finance_config_revision.account_no_enc`），响应带 `Cache-Control: no-store`；② 对公凭证的识别结果（付款户名、金额、附言、时间）按交易事实返回，不走明文查看；付款账号仍只回脱敏串。
- **沿用默认联系人或登录手机号**（A25）：表单需要“沿用默认联系人或登录手机号”时，请求体用 `phoneSource: 'login' | 'store_contact' | 'input'` 表达，选 `input` 时才传号码，服务端按来源补值。端上拿到的只有脱敏串，所以不能把默认号码回填后再提交。适用于开票邮寄信息、资质联系人、客服工单联系电话等（复核意见 6 列出的 `m07.invoice-request.create`、`m03.store-profile-contact.update`、`m08.service-ticket.create`），各接口文档写明允许哪几种来源。

**C41 文件引用。** 请求与响应里只出现 `fileId`（uuid，`file_object.id`），不出现桶名与对象键；读地址只在通过业务鉴权的响应或签发接口里现签（`d4-identity.md:1742`；`d5-media.md:2145`）。见第 9 节。

---

## 6. 列表、分页、排序与筛选

**C42 商家端与下载页：游标分页。** 查询参数 `cursor`（不透明字符串，首页不传）、`limit`（默认 20；上限 50 为本稿补充）；响应 `data = { items, nextCursor, hasMore }`，**不返回总数**（A22；下载页与商家端相同）。依据：PRD 要求“每页加载 20 条，滚动到底自动加载下一页”（`PRD.md:526`），设计规范的列表只有“加载中……/没有更多了”（`design-spec.md:885`），d7 定“商家端与日志类用游标”（`d7-platform.md:257`）。页签或标题上的数字由 `GET /<资源>/summary` 给（C83），列表不返回计数。按月分段加载的列表（积分明细）用 `month=YYYY-MM` 作为分段，段内仍是游标；响应另带 `prevMonth`（更早的、有记录的最近月份，没有为 `null`）与 `firstEntryAt`（最早一条记录的时刻），端上据此显示“查看 N 月记录”或“已显示全部记录”（A34；`proto-merchant-a.md:767`；`d1-ledger.md:1703`）。

本条的例外（都按 operationId 登记，新增例外须先改本条）：
- **搜索的近似总数**（A54）：`m.drama.search` 的响应另带 `totalApprox`（封顶 999），用于“找到 N 部短剧”。这是“商家端不返回总数”的**唯一**例外。
- **有界小集合不分页**（A55、A78）：一次返回全部，响应 `data = { items }`，不带 `cursor` / `nextCursor` / `hasMore`。商家端登记的：`m.store.list`（门店数受套餐上限约束，A55）、`m.member.list`（成员受名额约束）、`m.portalSession.list`（下载页会话 2 小时过期）、`m.cartItem.list`（选剧单 ≤50 部）、`m.plan.list`、`m.pointPack.list`（上架的只有个位数）、`m.dictItem.list`（按类型整份下发）。

**C43 后台：页码分页。** 查询参数 `page`（从 1 开始）、`pageSize`（默认 20，上限 100）；响应 `data = { items, page, pageSize, total }`（`d7-platform.md:257`）。原型的表格有“共 N 条”与每页 10 / 12 条（`proto-admin-c.md:46`；`proto-admin-a.md:125`），由前端传 `pageSize`。**后台的只增大表用游标**（A22）：审计日志 `audit_log`、登录与安全事件 `auth_event`、回调收件 `webhook_event`、埋点 `analytics_event`；响应 `data = { items, nextCursor, hasMore, totalApprox }`，`totalApprox` 是封顶的近似总数（上限 10,000），满足“共 N 条”的显示，等于上限时表示“至少这么多”。路线图里另有两处用游标的后台列表：`admin.pointAccount.pointLedgerEntry.list`（`point_ledger_entry` 是只增表，按本条用游标 + `totalApprox`，本稿归类）；发送日志 `admin.notificationDelivery.list`（`notification_delivery` 不是只增表）按 A62 改为**页码分页**。

**有界小集合不分页**（A78）：下列后台列表一次返回全部，响应 `data = { items }`，不带 `page` / `pageSize` / `total`；编辑所需的父对象字段可以并列返回（如许可行列表带父剧目的 `dramaLockVersion`，A104）：`admin.plan.list`、`admin.pointPack.list`（套餐与积分包）、`admin.role.list`（角色）、`admin.dictType.list`、`admin.dictItem.list`（字典）、`admin.featureFlag.list`（开关）、`admin.staffGroup.list`（员工分组）、`admin.assignmentPoolMember.list`（分配池成员）、`admin.checklistTemplate.list`（清单模板）、`admin.paramValue.list`（参数）、`admin.calendarDay.list`（一年的日历）、`admin.drama.dramaPermit.list`（剧目许可行）、`admin.priceTierRevision.list`（等级模板价）、`admin.entity.member.list`（主体成员）、`admin.orderItem.licenseLetter.list`（订单项的授权书，每个发布账号一份，A139）、`admin.reconciliation.list`（当月对账的日行，至多 31 行）、`admin.financeConfigRevision.list`（`tab = current` 的受控财务配置当前值；`tab = history` 仍按页码分页）。新增不分页的列表须先改本条。

**C44 排序。** 参数 `sort`，逗号分隔的字段列表，字段名前加 `-` 表示降序：`sort=-createdAt,orderNo`。每个列表在契约里用 enum 声明可排序字段与默认排序；服务端总是追加 `id` 作为最后一个排序键，保证翻页稳定。业务上的固定排序（如工单池“超时 → 今日截止 → 截止时间”，`proto-admin-a.md:125`）作为一个具名排序值：`sort=urgency`。（本稿补充）

**C45 筛选。** 页签统一 `tab=`，关键词统一 `q=`，其余筛选按 DTO 字段名（驼峰）（A24）：`status=`、`managerId=`；多值用逗号分隔 `status=pending,approved`（后台的 openapi-fetch 设 `querySerializer: { array: { style: 'form', explode: false } }`，小程序请求层按同一格式拼接）；单号 `no=`；时间范围 `createdFrom` / `createdTo`（`YYYY-MM-DD`，两端都含）；月份 `month=`；布尔 `true` / `false`。路线图的 `group=`（`m04.order.list`、`m07.point-ledger-entry.list`）、`phase=`（`m04.order-item.list`）、`view=`（`m05.launch-task.list`、`a01.approvals.list`、`a02.workbench.todos`、`a05.delivery-tickets.list`、`a06.launch-tasks.list`）、`keyword=`（`m04.drama.search`）凡是页签的改为 `tab=`、关键词改为 `q=`；不是页签的视角（如 `a05.delivery-tickets.list` 的 `opsView`）改为按字段名的筛选，由接口文档定名。数据范围在服务端查询里强制生效，不作为参数（`d7-platform.md:1101`；`d4-identity.md:1364`）。

**C46 导出参数。** 导出任务的 `params` 按导出键（`exportKey`）各自定义 schema（A24）：列表类导出通常与对应列表的查询参数同构，导出与列表共用同一个查询构造函数（`14-config-data.md:1180`；`d6-notify-docs-data.md:2180`）；报表、对账类可以与列表不同构（如对账导出的“按日或按月”与“导出内容多选”、积分报表的“按主体的余额明细”，复核意见 67）。每个 `exportKey` 的 `params` schema 在接口文档里逐个列出。

**C83 页签计数（`summary`）。** 页签计数统一由 `GET /<资源>/summary` 返回，商家端与后台同名；列表接口不返回计数（A23）。**凡页面页签或标题带数字的，都要有对应的 `summary`**。
- 形态（本稿补充）：查询参数与该资源的列表相同（除 `tab`、分页参数外）；响应按页签给计数，键与列表的 `tab` 取值一致，可带同口径的副指标（如金额合计），由接口文档定。页面的页签跨两个资源时各调各的 `summary`。
- **`summary` 可以同时带页头上下文**（A79）：页签上方共用的页头信息（如开票页的抬头卡：主体名称、信用代码脱敏串、认证状态，及申请弹层的默认值）放在 `summary` 响应的 `context` 里，不另开接口（`m.invoiceRequest.summary`）。
- `summary` 这个字面段只用于页签计数；页面聚合不用这个词，路线图 `GET /m/me/summary`（“我的”页聚合）改为 `GET /m/me/overview`。字面段先于 `/{xxxId}` 注册（C12）。
- 商家端需要的（据复核意见 1、10 列出的画板）：`GET /m/messages/summary`（取代 `/m/messages/unread-counts`）、`GET /m/store-assets/summary`（取代 `/m/assets/facets`；店员“我上传的 N 条 · M 条被采用”按列表同名筛选 `uploader=me` 取）、`GET /m/launch-tasks/summary` 与 `GET /m/takedown-tasks/summary`（发布任务页“待上线 / 待下架 / 已完成”，按“订单项 × 账号”即上线任务行计数，A54）、`GET /m/order-items/summary`（我的短剧“上线中 · N 部”“待上线 · N 部”）、`GET /m/license-letters/summary` 与 `GET /m/agreement-consents/summary`（合同页）、`GET /m/payment-orders/summary` 与 `GET /m/invoice-requests/summary`（开票页“可开票 · N”“开票记录 · N”，后者带抬头卡上下文，A79）。搜索页“找到 N 部短剧”不用 `summary`，由 `m.drama.search` 的 `totalApprox` 给（A54，C42）。
- 后台：路线图已有的 `stores`、`dramas`、`orders`、`delivery-tickets`、`launch-tasks`、`patrol-tasks`、`plans`、`point-packs`、`point-accounts`、`subscription-terms`、`payment-orders`、`payment-transactions`、`invoice-requests`、`service-tickets`、`approvals` 的 `summary`；A26 补 `ads`、`takedown-tasks`、`transfer-proofs`、`refund-requests`、`cancel-requests` 的 `summary`。其余带数字的画板由各分组接口文档逐个核对补齐。

---

## 7. 并发与幂等

**C47 幂等声明（三值）。** 每条路由声明 `x-idempotent`（路线图字段名 `xIdempotent`，取代布尔的 `idempotent`），**一条路由只有一种幂等方式，不按请求体切换**（A17）：
- **`required`（缺省）**：必须带 `Idempotency-Key`，不带返回 400 `IDEMPOTENCY_KEY_REQUIRED`（`d7-platform.md:408`）；同键重放返回上次成功的结果。**状态迁移一律 `required`**——重放返回上次成功结果，不能依赖状态守卫报 409 代替；带 `lockVersion` 的 `PATCH` / `PUT` 也是 `required`。路线图里“覆盖写、天然幂等”这一类取消；“natural（状态守卫）”“natural（版本号守卫）”的写法（如 `m05.sample.confirm`、`m06.ad.confirm`、`m07.payment-order.cancel`、`m02.portal-ticket.approve`）一律改为 `required`。有出站通知、发短信或审计副作用的写（如 `m.member.update`、`m.smsCode.create`）同样是 `required`。结果里带激活码、令牌、签名地址、支付调起参数或明文个人信息的 `required` 路由，幂等记录只存脱敏后的结果（C50“结果脱敏”）。
- **`natural`**：不要求带键，靠数据模型里的唯一约束去重；必须同时写出 `x-idempotent-by`（路线图字段名 `idempotentBy`）= 承担去重的约束名，**取值是字符串数组**，可写多个约束名（A49；如上传登记的三条部分唯一索引写成一个三元素数组），CI 逐个核对约束存在（`d7-platform.md:246`、`464`）。可用的约束（取数据模型实际约束名）：上传登记按 `clientToken` 去重的 `uq_file_object_client_token_store`、`uq_file_object_client_token_batch`、`uq_file_object_client_token_noscope`（三条部分唯一索引合起来生效，`06-media.md:173-175`）；协议同意 `uq_agreement_consent_no_biz`、`uq_agreement_consent_biz`（`13-notify-docs.md:852-853`）；创建邀请 `uq_invitation_inviter_member_id_client_request_id`（`02-identity-tenant.md:767`）；回调 `uq_webhook_event_provider_event_id`（`15-integration-ops.md:79`）。旧稿写的 `(user_id, agreement_key, version)` 不是实际约束，删除。某条路由用不用 natural 由接口文档逐条定，定了就不再要求键。
- **`none`**：必须写理由（`x-idempotent-reason`），只用于（A18，并 A43、A50、A51、A139 补充）：
  - 登录、换会话与退出：`m.session.create`、`m.session.phoneLogin`、`admin.auth.login`、`admin.auth.verifyMfa`、`portal.portalTicket.exchange`；后台登录前的激活与首次绑定（`activate`、`set-password`、`enroll-totp`、`confirm-totp`，此时没有会话，幂等记录没有 `actor_key`）与再验证 `admin.auth.stepUp` 本稿归入这一类；**三端退出登录** `m.session.current.delete`、`admin.session.current.delete`、`portal.session.current.delete`（A43；重复退出无副作用，端上把 401 当作已退出）；
  - 签发短时地址与凭证：`…/download-urls`、`…/playback-urls`（C60），以及上传的 `…/refresh-credentials`（本稿归类）——结果不进幂等记录，避免回放已过期的地址。签发类接口附带的技术状态变化（打包 ZIP、续签凭证）不改变其 `none`（A51）；
  - 明文查看：`admin.piiReveal.create`（结果含明文，不进幂等记录，A51）；
  - 主动查单：`m.paymentOrder.sync`（只查询渠道状态，入账由账本操作键去重，A50；仍是 C51 的三段式用例）；
  - 自助重新绑定动态口令的第一步：`admin.auth.me.enrollTotp`（结果只有一次性密钥，A139）；第二步 `admin.auth.me.confirmTotp` 是 `required` + 结果脱敏（C50）；
  - 埋点与错误上报：`m.analyticsEvent.batchCreate`（事件按 `event_id` 在 `analytics_event_dedup` 去重，不经幂等记录）、`<组>.clientError.create`；
  - 匿名建下载页票据：`portal.portalTicket.create`；
  - 纯查询与试算：全部 GET、`…/quote`、`…/<动作>-quote`（C13）。
- 回调的去重见 C6。

取舍：ADR-013 只要求“涉及钱、积分、状态的写接口”带键（`04-adr.md:99`）；d2 要求后台全部写接口带键（`d2-payment.md:1497`）；d3 的后台写接口只靠状态守卫与 `lock_version`，少数另带键（`d3-flow.md:3185`）；d5 写“所有写接口接受”（`d5-media.md:2081`）。本文取“缺省 required、例外逐条声明”：后台前端本来就在每次打开弹层时生成键（`d7-platform.md:1122`），统一后端上只有一种重试语义。

**C48 键的语义（端上）。** 键属于用户的一次意图：进入确认页或打开确认弹层时生成 `<动作名>:<uuid>`；该意图下的所有重试（双击、超时重发、401 后重放、同意协议或再验证后重放、弱网重试）复用同一个键；成功、改了表单内容、离开页面时丢弃；改了内容必须换键（`d7-platform.md:403-407`）。

**C49 键的语义（服务端）。** 一张表 `idempotency_record`，主键 `(scope, actor_key, key)`（`01-kernel-flow.md:47-68`）：
- `scope` = 路由的 `operationId`（C14）。
- `actor_key` = `merchant:<用户 id>` 或 `staff:<员工 id>`；**下载页请求记授权它的商家用户**，不写 `portal:<会话 id>`（`01-kernel-flow.md:56`，取代 `d7-platform.md:419` 的写法）。
- `request_hash` = `sha256(方法 + 路径参数 + 规范化后的请求体)`，**商家端另计入 `X-Store-Id`**（A121：同一个键在不同门店上下文下视为不同请求）；同键不同哈希返回 `IDEMPOTENCY_KEY_REUSED`（`01-kernel-flow.md:58`）。
- 保留 24 小时，过期行每小时删除（`01-kernel-flow.md:51`、`64`）。
- `none` 与 `natural` 的路由不读写本表。

**C50 重放与并发。** 幂等行与业务写在同一事务里：已完成的同键请求不再执行，直接返回存下的结果，回包头带 `Idempotent-Replayed: true`；存的是角色裁剪**之前**的 DTO，重放时按当前观察者角色重新裁剪（`d7-platform.md:424`、`438`）。同键并发时后到者阻塞在主键上，等前者提交后拿到同一份结果，端上不需要轮询；等锁超过 3 秒返回 `BUSY`（`d7-platform.md:435`、`448`）。**只持久化成功**：业务失败随事务回滚，同一个键可以直接重试，修正输入后也可以用同一个键（`d7-platform.md:449`）。业务上的拒绝结果需要落库的（如配对数字不一致要作废票据），按成功返回 200 并在 `data.status` 里表达，不用错误码（A101，C5）。

**结果脱敏**（A80）：响应里含激活码、令牌、签名地址、支付调起参数、明文个人信息的 `required` 路由，幂等记录的 `result` 只存脱敏后的结果——这些字段写入时置为 `null`。同键重放时这些字段为 `null`，响应 `data` 带 `replayed: true`（与回包头 `Idempotent-Replayed: true` 同义，便于解包后判断）；端上需要这些值时换新键重新调用。
- 契约按 operationId 登记要置空的字段路径（随路由元数据，C75），响应 schema 里这些字段声明为可空，并声明 `replayed: boolean`。
- 已知适用（A80、A139）见下表，“置空的字段”即 `x-redact-on-replay` 的字段路径；其余由接口文档逐条标注。

| operationId | 置空的字段 | 文档 |
| --- | --- | --- |
| `m.paymentOrder.wechatPrepay` | `payParams`（调起参数短时有效；保持 `required`，A80） | m07 |
| `m.paymentOrder.create` | `bankAccount.accountNo`（平台对公收款账号明文，C40） | m07 |
| `m.order.create` | `items[].posterUrl` | m04 |
| `m.cartItem.acceptPrice` | `drama.posterUrl` | m04 |
| 员工激活码类（新增员工、启用、重置密码、重置动态口令、重新生成激活码） | 激活码明文 | a01 |
| `admin.auth.me.confirmTotp` | `recoveryCodes` | a01 |
| `admin.drama.create`、`admin.drama.basic.update`、`admin.drama.commercial.update`、`admin.drama.cast.replace`、`admin.drama.copyright.replace`、`admin.drama.shelve`、`admin.drama.delist`、`admin.drama.confirmPermitRecheck` | `posterUrl`、`trailer.coverUrl` | a04 |
| `admin.drama.dramaCopyrightRevision.create` | `drama.posterUrl`、`drama.trailer.coverUrl` | a04 |
| `admin.drama.trailer.replace` | `coverUrl` | a04 |
| `admin.homeBanner.create`、`admin.homeBanner.update` | `imageUrl` | a09 |
| `admin.homeBanner.batchReorder` | `items[].imageUrl` | a09 |

- 重放时这些字段为 `null`，数组字段也一样（C38“数组不写 null”的例外，A153）；字段类型写成 `… | null`，注明“仅重放时为 null”。
- 与 `none` 的分工：结果**只有**短时地址或明文、重放没有意义的，直接用 `none`（签发地址、明文查看，C47）；有业务写入、必须防重放的，用 `required` + 结果脱敏。

**C51 三段式用例。** 事务外必须调外部服务的用例先占用 `in_progress`（30 秒），重复请求在占用期内得到 409 `IDEMPOTENCY_IN_PROGRESS`（`retryable`），占用过期后可接手续做（`d7-platform.md:453-462`）。这类路由在契约里另标注，接口文档写明外部调用与事务的先后、失败时的补偿和“可续做”的步骤。三种形态：
- **先调外部、再开事务**（典型）：占用 → 事务外调外部 → 事务内落结果并写幂等记录。
- **先落库、提交后外调**：先在事务里落本地行并提交，提交后调外部，再按结果更新本地行或补偿（删行、标失败）。
- **多事务**：外部调用夹在两个事务之间，幂等记录随最后一个事务写；中间事务已提交的技术状态不随业务失败回滚，接口文档写明。

V1.0 登记的（A50、A84、A139；按 operationId；路由标 `x-three-phase`，C75）：

| operationId | 形态 | 要点 |
| --- | --- | --- |
| `m.paymentOrder.wechatPrepay` | 多事务 | 微信预下单：事务 A 取得或新建支付尝试并提交 → 事务外调微信下单 → 事务 B 落结果，幂等记录随事务 B 写；返回 `PAYMENT_ORDER_CLOSED` 时，事务 A 建的尝试已置 `closed` 并保留；结果按 C50 脱敏（A139 由“先外调”改） |
| `m.paymentOrder.cancel` | 先外调 | 微信支付先查单再关单（复核意见 46） |
| `m.paymentOrder.sync` | 先外调 | 主动查单；幂等 `none`（A50），不占用 `in_progress`，并发由每单限频（C68）与账本操作键去重兜住 |
| `admin.refundRequest.execute` | 多事务 | 退款执行：事务一记执行意图并提交，事务外调微信退款，事务二写结果与幂等记录（A154） |
| `admin.refundRequest.retry` | 先外调 | 退款重试（A50） |
| `admin.refundRequest.confirmNotAccepted` | 先外调 | 先查退款结果再确认未受理（A84） |
| `admin.paymentException.resolve` | 先外调 | 处理方式为补单（`restore`）、补记渠道退款（`record_channel_refund`）时先查微信（A84） |
| `m.me.changePhone` | 先外调 | 事务前调手机号组件换号，`phoneCode` 一次性（A84） |
| `m.smsCode.create`、`m.storeProfile.contactSmsCode.create` | 先落库 | 先落验证码行并提交，提交后直发短信，发送失败删行（A84） |
| `m.file.complete` | 多事务 | 对象存储调用在事务之间，幂等记录随第二个事务写；拒收时已提交的技术状态不回滚（A84） |
| `admin.notifyScene.testSend` | 先落库 | 第一段建直发投递行（`notification_delivery`，`purpose = test`，不建通知行，A30），事务外调通道，第三段写 `sent` / `failed`（A84） |
| `admin.smsTemplate.testSend` | 先落库 | 同 `admin.notifyScene.testSend`：建直发投递行、事务外调短信通道、第三段写结果（a09 3.33，A148） |
| `m.qualificationDoc.create` | 先外调 | 事务外做证照识别，事务内挂到草稿；已写的识别结果是技术结果、不回滚，重试复用（m03，A139） |
| `admin.uploadBatchItem.complete` | 多事务 | 与 `m.file.complete` 同法（a04，A139） |
| `admin.auth.bindWecom` | 先外调 | 仅扫码分支：事务外用 `code` 向企业微信换 `userid`；手填分支不调外部（a01，A139） |
| `admin.file.complete` | 多事务 | 与 `m.file.complete` 同法（a01，A139） |
| `admin.file.restore` | 先外调 | 事务外移除对象存储的删除标记，事务内复核守卫并落库（a01，A139） |
| `admin.file.erase` | 多事务 | 事务一占位 → 事务外删除对象的全部历史版本 → 事务二落结果（a01，A139） |

幂等为 `none` 的三段式用例（`m.paymentOrder.sync`）只沿用“事务外调外部、事务内落结果”的写法，不读写幂等记录。

**C52 乐观锁字段。** 多人会改的行带 `lock_version`（`06-data-model.md:66`）。契约里字段名统一 `lockVersion`：详情 DTO 返回当前值；与库中值不一致返回 409 `VERSION_CONFLICT`，`details` 带最新值。请求体什么时候带见 C53。d2 的 `expectedVersion`（`d2-payment.md:878`、`1497`）、d7 的 `version`（`d7-platform.md:1118`、`1166`）、路线图 `a01.roles.replace` 的 `version`、`a09.notify-scenes.update` 的 `rev` 都改为 `lockVersion`（`staff_role`、`notify_scene` 的列都是 `lock_version`，`03-staff-authz-audit.md:72`、`13-notify-docs.md:204`）。

列名不是 `lock_version` 的例外（A21），字段名与列名对应：

| 表 | 列 | 请求字段 | 用在哪 | 出处 |
| --- | --- | --- | --- | --- |
| `delivery_plan` | `draft_lock_version` | `draftLockVersion` | 保存方案草稿、推送方案（同一行的第二把锁） | `10-delivery.md:372`、`417` |
| `site_config_revision` | `base_rev_no`（与已发布版的 `rev_no` 比对） | `baseRevNo` | 发布站点配置（同时带草稿行的 `lockVersion`，A105） | `14-config-data.md:348`、`365` |
| `param_value` | `seq`（每个键最新一行的修订号） | `expectedRev`（逐项） | 整批保存参数 | `14-config-data.md:251`、`266` |
| `drama_permit`、`drama_episode`（本表无锁列） | 父剧目的 `drama.lock_version` | `dramaLockVersion` | 许可行与剧集的修改 `admin.dramaPermit.update`、`admin.dramaEpisode.update`（写操作锁剧目行并比对，d8 第 7.1 节）；许可行列表与写接口的响应返回 `dramaLockVersion` | A104 |

**没有锁版本列、请求不带 `lockVersion` 的表**（A47、A104、A139；不改表，C53“内容编辑一律带”的例外）：

| 表 | 涉及的写接口 | 说明 | 依据 |
| --- | --- | --- | --- |
| `merchant_user` | `m.me.update` | 只改本人账号 | A47 |
| `entity_member`、`store_member` | `m.member.update`、`m.me.currentStore.replace` | 成员的门店为整体替换 | A47 |
| `wx_template_slot` | `admin.wxTemplateSlot.update` | — | A47 |
| `sms_template` | `admin.smsTemplate.update` | — | A47 |
| `drama_trailer` | `admin.drama.trailer.replace`（PUT） | 靠指向源文件的指针，以最后一次设置为准（a04） | A104 |
| `upload_batch_item` | `admin.uploadBatchItem.update` | 靠批次行锁，且只限批次持有人（a04） | A104 |
| `assignment_pool_member` | `admin.staff.duty.update`（`PATCH /admin/staff/{staffId}/duty`） | 客服“当班 / 接单中”开关（a01） | A139 |

**C53 什么时候带锁版本。**
- **内容编辑（`PATCH`，以及整体替换的 `PUT`）一律带 `lockVersion`**（A21）；C52 列出的无锁列的表不带，许可行与剧集带 `dramaLockVersion`（A47、A104）。
- **状态迁移**用“事务内行锁 + 状态守卫”（`06-data-model.md:66`），守卫不满足返回 409 `STATE_NOT_ALLOWED` 或更具体的领域码；**只有数据模型状态机表的守卫列出了 `lock_version`（或同一行的第二把锁）的迁移，请求体才带**（A21）。已核对到的：审批单 `approve`（守卫“`lock_version` 一致”，`03-staff-authz-audit.md:805`；A14 之后由各领域资源的决定接口带审批单的 `lockVersion`）、素材复核（`06-media.md:1186-1187`）、协议版本草稿编辑（`13-notify-docs.md:763`）、协议草稿保存为待生效（`admin.agreementVersion.schedule`，守卫补“锁版本相符”，A105；`13-notify-docs.md:764`）、站点配置草稿再保存与发布（`admin.siteConfig.publish` 的守卫同样按 A105 补锁版本，`14-config-data.md:386-387`）、方案推送（`draftLockVersion`，`10-delivery.md:417`）。其余迁移不带；接口文档按状态机表逐行核对并标注。
- 旧稿 C52“后台在这类行上执行的动作，请求体必须带 `lockVersion`”与 C53 互相矛盾，按本条取代。
- 业务版本号：商家“确认某一版”（方案、样片、广告）时请求体带被确认对象的业务版本号 `versionNo`，服务端比对当前版本（`d3-flow.md:3171`、`3509-3511`）——它表达“确认的是哪一版”，与并发用的 `lockVersion` 是两回事。

**C54 二次确认回显。** 后台敏感权限点的写请求必须带 `confirm` 对象（对象编号 + 关键数值，如 `{ refundNo, amountFen }`），服务端在事务内与当前值比对，不一致 409 `CONFIRM_MISMATCH`；界面上的勾选核对项（`ack`、`confirmChecks`）随请求提交并写进审计（`d4-identity.md:1375`、`1221`；`d2-payment.md:878`）。`confirm` 的字段由各接口文档列出。

---

## 8. 店员视图与字段裁剪

**C55 按角色区分的响应 schema。** 老板与店员都能访问、但可见字段不同的资源，契约里为每个角色定义一个响应 schema，用 `viewerRole` 作判别字段，组成 `discriminatedUnion`；API 层 `respondByRole` 用观察者角色对应的 schema 对输出做一次 `parse`，未声明的字段被剥离；该角色没有对应 schema 即 403 `ROLE_FORBIDDEN`（`d4-identity.md:877-899`；`d7-platform.md:237`）。`viewerRole` 取值 `owner` / `clerk`；`optional` 路由的游客视图记为 `guest`（A122 采纳，列为 d4 `respondByRole` 待回写；d4 只写“游客与店员只看到标价积分”，`d4-identity.md:374`）。几个角色可以共用一个 schema。每条商家端路由声明 `x-clerk-view`（路线图字段名 `clerkView`，A11）：`none` = 店员 403；`same` = 与老板相同；`trimmed` = 裁剪后的店员 schema。`trimmed` 的接口在接口文档里给出店员 schema（A12）。

**C56 V1.0 开放给店员的接口。** 按路线图实际开放给店员（`owner_and_clerk`）的接口扩充（A12；旧清单只有 `d4-identity.md:902` 的六类）。路径已按 `resources.json` 改名：

| clerkView | operationId（路径） | 店员 schema 要点 |
| --- | --- | --- |
| `trimmed` | `m.store.list`（`GET /m/stores`） | 不含主体额度（门店 n/N、成员名额 n/N）；门店卡上的上线中、交付中计数与待办数对店员是否保留，接口文档定（复核意见 5）；切换门店弹层要列出店员能进的门店（`d7-platform.md:694`） |
| `trimmed` | `m.home.get`（`GET /m/home`） | 店员首页为“素材需求 + 上传入口 + 我上传的”（`d7-platform.md:693`）；无上线概览与清零提醒 |
| `trimmed` | `m.todo.list`（`GET /m/todos`） | 只含素材相关待办 |
| `trimmed` | `m.me.overview.get`（`GET /m/me/overview`，路线图 `/m/me/summary`） | 无套餐积分卡、无订单与发布入口；只有门店、成员、消息、客服、设置（`d4-identity.md:902`；`d7-platform.md:693`） |
| `trimmed` | `m.storeProfile.get`、`m.storeProfile.basic.get`、`m.storeProfile.media.get`、`m.storeProfile.service.get`、`m.storeProfile.qualification.get` | 资质只有状态，无证照号与证照图；无广告计数；主推服务的现价与原价对店员可见（`d9-profile.md:801` ⑦） |
| `trimmed` | `m.member.list`（`GET /m/members`） | 无手机号、无名额数字 |
| `trimmed` | `m.drama.list`、`m.drama.search`、`m.drama.get` | 与游客一致：有标价积分，无折后实扣与余额 |
| `trimmed` | `m.agreementConsent.list`（`GET /m/agreement-consents`） | 只看本人的用户级协议（`d6-notify-docs-data.md:2244`）；协议同意的计数 `m.agreementConsent.summary` 要能力点 `contract.read`，店员 403（A53） |
| `same` | `m.storeAsset.list`、`m.storeAsset.get`、`m.storeAsset.summary`、`m.storeAsset.create`、`m.storeAsset.portraitAuth.create`、`m.storeAsset.feedback.create`（A33）、`m.assetDemand.list` | 老板与店员都能看本店全部素材（`d4-identity.md:858-859`） |
| `same` | `m.serviceManager.get`（`GET /m/service-manager`） | 能力点 `support.manager.read`（老板、店员、已停用门店的老板都有，A128、A139）；店员进入客服中心只看到服务经理名片与在线客服入口（A33）；名片上的电话字段命名避开 C57 的禁用模式 |
| `same` | 站内消息 `m.message.list`、`m.message.summary`、`m.message.read`、`m.message.batchRead` | 消息是账号级的：每个收件人一行，生成时已按收件人角色出文案，所以不再按角色裁剪；`xAuth = user`，带门店上下文时按门店过滤（A52） |
| `same` | `m.playable.get`（能力点在处理器里按资产类型判定，A87）、`m.file.*`（上传）、本人账号类（`m.me.*`，含 `m.me.membership.leave`；`m.session.*`）、启动引导与公开配置 | 账号本人或公开内容 |

其余商家端路由店员没有能力点，`clerkView: none`，直接 403。原先 d4 能力点表里没有能力点的几条按 A87 补：首页待办 `m.todo.list` 用 `todo.read`，服务经理名片 `m.serviceManager.get` 用 `support.manager.read`，素材反馈 `m.storeAsset.feedback.create` 用 `asset.feedback`；门店列表 `m.store.list` 是 `user`，按成员关系现算可见门店，不设能力点（m02 的默认）。新能力点进增补表（C66）。“店员看不到积分”的口径待业务确认（`d4-identity.md:904`）。

**C57 防回归。** 黄金文件 `clerk-visible-keys.snap` 记录每条 `trimmed` 与 `same` 路由店员视图的字段路径（A12）；测试以店员身份调用全部 `/m/*` 路由，递归扫描响应键名，命中禁用模式（`points`、`balance`、`amount`、`price`、`contract`、`invoice`、`uscc`、`license`、`phone` 明文）即失败；`clerkView: none` 的路由断言 403；两条测试进 verify 流水线（`d4-identity.md:906-909`；`d7-platform.md:237`）。扫描放行（A86）：① 以 `Mask` 结尾的脱敏字段（如 `phoneMask`、`targetPhoneMask`）；② 目录标价类字段：短剧卡与详情的 `listPricePoints`、`adUnitPoints`，档案主推服务的 `priceFen`、`originalPriceFen`，素材菜单条目的 `priceText`（依据 `d9-profile.md:801` ⑦）；目录标价类按出现的键路径登记白名单（m03、m04 的做法）。除此之外**字段命名要避开禁用模式**：例如门店联系电话列名用 `store_tel` 而不用 `phone`（`d9-profile.md:122`），“可使用至”用 `usableUntilDate` 避开 `license`。

**C58 后台的裁剪。** 后台不按角色换 schema，而是按权限与数据范围：不在范围内的资源 404；敏感字段默认脱敏，明文走 `POST /admin/pii-reveals`（C40）；“本人任务”等级时列表只返回本人的任务（`d4-identity.md:1366`；`d7-platform.md:1100-1101`）。

---

## 9. 文件：上传、下载与播放

**C59 上传。** 一律“登记 → 直传 → 确认 → 业务引用”，接口路径在两端相同（`d5-media.md:983-1005`、`2087-2091`、`2106`）。资源名按 A5 统一为 `files`（路线图 `/m/uploads`、`/admin/uploads` 与 `/admin/files` 合一；按 A41 以登记表为准）：

| 步骤 | 接口 | 说明 |
| --- | --- | --- |
| 登记 | `POST /m/files`、`POST /admin/files`（下载页 `POST /portal/files` 为 V1.1） | 请求带用途（分类）、文件名、大小、`clientToken`（及制作上下文）；返回 `fileId`、`mode`、`bucket`、`region`、`key`、`post` 或 `sts`、`chunkSize`、`chunkParallel`、`expiresAt`。`mode` 由服务端定：≤20MB 走 `post`（预签名表单，10 分钟），其余走 `multipart`（STS 临时密钥，30 分钟，只能写 `incoming/{fileId}/*`）。`x-idempotent: natural`，`x-idempotent-by` 为 C47 列出的三条 `client_token` 部分唯一索引（三元素数组，A49），按 `clientToken` 复用未完成的登记以便续传（`d5-media.md:966-969`、`1019`、`1026`）。超过小程序上传上限时返回统一的引导信息（由服务经理在后台代传，A35；`FILE_TOO_LARGE`，m08 定义，C28），电脑端上传是 V1.1 |
| 续签 | `POST /<端>/files/{fileId}/refresh-credentials` | 仅 `pending`、本人、未过期（`d5-media.md:1028`）。草案 `…/sts`、后台路线图 `renew-credential` 统一为此名；`x-idempotent: none`（C47） |
| 确认 | `POST /<端>/files/{fileId}/complete` | 状态迁移，`x-idempotent: required`（A17；两端路线图标法不一，以此为准）；多事务的三段式用例（C51，A84）。小文件（≤32MB）最多等 3 秒入库；返回 `promoting` 或 `stored`；确认中 409 `CONFIRM_IN_PROGRESS`（可重试），对象不存在 409 `UPLOAD_NOT_FOUND`，内容不合格 400 `UPLOAD_REJECTED`（C24；上传类码都由 m08 定义，C28）（`d5-media.md:1010`、`1033-1037`） |
| 查状态 | `GET /<端>/files/{fileId}` | 1 秒一次，直到 `stored` / `rejected` |
| 取消 | `POST /<端>/files/{fileId}/cancel` | 上传人本人取消未确认的登记；路线图 `DELETE /m/uploads/{fileId}` 改（A7：文件行不物理删除）；后台一侧 `admin.file.cancel` 按 A57 补 |
| 批量（后台） | `/admin/upload-batches…`、`/admin/upload-batch-items/…` | 一份凭证覆盖整批（`d5-media.md:2107`、`1091`） |

业务接口只接受已入库（`stored`）的 `fileId`，端上的上传工具把“等到入库”封装在内部（`d5-media.md:1011`）。客户端声明的 MIME 不被信任（`d5-media.md:969`）。上限是服务端参数，引导接口下发（`d7-platform.md:479`）。

**C60 读地址的签发与“GET 不写库”。** **GET 不写库**（A19）：任何 GET 不写审计、访问记录、取料记录、“已查看”证据或首次查看时间。先做业务授权，再现签短时地址；没有“凭 `fileId` 换地址”的通用商家接口（`d4-identity.md:1727`；`d5-media.md:2145`）。地址统一表达为 `{ url, expiresAt }`，过期后重新请求所在的业务接口取新地址。两种形态：
- **随数据返回**：不需要留痕的读（缩略图、海报、素材预览、不需证据的播放）在列表或详情里直接带签名地址；图片列表用 30 分钟对齐窗口，便于端上缓存（`d5-media.md:2145`）。
- **单独签发**：需要逐次留痕的读一律 `POST /<资源>/{id}[/<子资源>]/download-urls`（下载）或 `POST …/playback-urls`（播放预览）（A19）。请求体指明要哪份文件（第几集、`kind`、版本等）；每次调用写一条访问记录，返回 `{ url, expiresAt, downloadId? }`（`downloadId` 为下载留痕行的 id，可用于回报结果）。`x-idempotent: none`，结果不进幂等记录（A18）；签发时附带的技术状态变化（打包 ZIP、续签）不改变 `none`（A51）。**样片、广告的“已查看”证据只在这些 POST 里写**。
- 保留的签发接口（A57）：商家端证照原图 `m.qualificationDoc.downloadUrls`、广告保存相册 `m.ad.downloadUrls`；后台按文件的通用签发 `POST /admin/files/{fileId}/download-urls`（`admin.file.downloadUrls`），权限在处理器里按文件的归属与分类判定（`x-permission: assert-in-handler`，C66）。

路线图里的签发与带写入的 GET 一律按下表改写（A19）：

| 路线图 | 改为 |
| --- | --- |
| `m05.sample.download`（`POST /m/samples/{sampleId}/download`） | `POST /m/samples/{sampleId}/download-urls`（水印版保存相册，写访问记录与首次查看） |
| `m05.license-letter.download` | `POST /m/license-letters/{licenseLetterId}/download-urls` |
| `m05.download.create`（`POST /m/order-items/{orderItemId}/downloads`） | `POST /m/order-items/{orderItemId}/download-urls`（`{ kind: "episode", episodeNo }`，写 `delivery_download_log`） |
| `m07.invoice-request.file`（GET） | `POST /m/invoice-requests/{invoiceRequestId}/download-urls` |
| `p01.downloads.create` | `POST /portal/order-items/{orderItemId}/download-urls`（`kind: episode | zip | publish_list`） |
| `p01.sample.get`（GET 写访问审计与 `sample.first_viewed_at`） | `GET /portal/order-items/{orderItemId}/sample` 只回元数据；`POST /portal/samples/{sampleId}/playback-urls` 签发并写证据 |
| `p01.ads.get`（GET 写访问审计） | `GET /portal/ads/{adId}` 只回元数据；`POST /portal/ads/{adId}/playback-urls` 签发并写证据（对象为广告版本） |
| `a05.delivery-tickets.list-materials`（GET 写 `master_checkout`） | `GET /admin/delivery-tickets/{deliveryTicketId}/materials` 只列素材；`POST /admin/delivery-tickets/{deliveryTicketId}/materials/download-urls` 签发并写 `master_checkout`（A19） |
| `a01.files.get-url`（`GET /admin/files/{fileId}/url`） | `POST /admin/files/{fileId}/download-urls`（A57 保留；按文件归属与分类在处理器里判权） |
| `a02.export-jobs.sign-url` | `POST /admin/export-jobs/{exportJobId}/download-urls` |
| `a01.approvals.get`、`a09.agreement-consents.get`（GET 返回明文并记审计） | GET 只回脱敏值；明文走 `POST /admin/pii-reveals`（C40）；证照原图走签发 |

草案写法不一（`POST /m/order-items/{id}/downloads/episodes/{no}`、`POST /m/order-items/{id}/sample/download`，`d5-media.md:2096-2097`；`GET /m/order-items/{id}/episodes/{no}/download-url`，`d3-flow.md:3512`；`POST /admin/exports/{id}/download-url`，`d6-notify-docs-data.md:2257`；`POST /portal/deliverables/{fileId}/download-url`，`d4-identity.md:2281`；`GET /admin/files/{id}/url`，`d5-media.md:2112`），统一为上面的写法。

**C61 有效期。** 以 d5 为准（`d5-media.md:440`；`01-architecture.md:452`）：证照、回单、发票、授权书、导出 5 分钟；素材与档案图片 30 分钟对齐窗口；素材音视频、样片、广告播放 60 分钟；员工下载原片与成片 30 分钟；商家下载单集、保存样片 15 分钟；ZIP 3 小时。A125 补：协议 PDF（随协议正文返回，m01）30 分钟；发布清单文件 15 分钟。“下载授权 7 天”是业务授权，不是地址有效期（`d7-platform.md:846`）。

**C62 播放。** 可播放资产返回结构 `Playable`（以 m06 2.8 为唯一定义，C87；含 `playableId`、`kind`、`durationMs`、`width`、`height`、`posterUrl`、`sources: [{ quality, url, width, height, bitrateKbps }]`、`expiresAt`、`autoplay`、`muted`，字段以 m06 为准，A147）（`d7-platform.md:794-797`；`d5-media.md:1433-1446`）。三种情形（A135）：

| 资产情形 | 所在字段返回 |
| --- | --- |
| 未就绪（转码中、失败等） | `null` |
| 已就绪，但不能在小程序内播放（对应开关关闭，或平台限制） | 只带海报的对象，`sources = []`、`expiresAt = null`（键照常出现，C38），端上显示海报与替代出口 |
| 已就绪且可播放 | 完整对象 |

V1.0 小程序不播放预告片、样片默认不在小程序内播放（`05-risks-and-open-issues.md:16`；`d7-platform.md:512-513`；`design-spec.md:850-853`）。不需留痕的播放换新地址用 `GET /m/playables/{playableId}`（`m.playable.get`，路线图 `m06.playable.get`；草案 `GET /m/playables/{id}/play`，`d5-media.md:2092`；能力点 `assert-in-handler`：预告片匿名可看，广告要 `ad.request`，样片要 `delivery.confirm_sample`，A87）；需要“已查看”证据的播放走所属资源的 `POST …/playback-urls`（C60），返回同一结构。小程序内的广告预览是否需要留痕，接口文档按广告确认守卫（`09-order-ad.md:910`）核对。

---

## 10. 长任务、事件与非 HTTP 迁移

**C63 统一形态。** 需要几秒以上、或要排队的工作建成任务资源：`POST /<任务集合>` 建任务并立即返回 `{ <任务>Id, jobNo?, status, … }`；`GET /<任务集合>/{id}` 查状态；`POST /<任务集合>/{id}/cancel` 取消；结果文件经 `POST /<任务集合>/{id}/download-urls` 取地址（C60）。相同参数的进行中任务直接返回已有的那个（`d6-notify-docs-data.md:2162`；`d7-platform.md:1137`）。轮询节奏由端上定，接口文档写明建议值。

**C64 导出。** 只有异步一条路（`04-adr.md:257` ADR-038；`d7-platform.md:1127`）。资源名按路线图与表名取 `export-jobs`（A1；旧稿的 `/admin/exports` 不再使用）：
- `POST /admin/export-jobs { exportKey, format, isMasked, reason?, params }`（`admin.exportJob.create`）：`exportKey` 是导出登记表里的键，按数据模型约束为小写点分 2–4 段、不超过 40 个字符（`ck_export_job_export_key`，`14-config-data.md:956`；例 `report.overview`、`payments.list`、`audit_logs.list`，`14-config-data.md:919`）——路线图 `a02.export-jobs.create` 备注里的一段式示例（`delivery_tickets`、`stores` 等）不合规，按此改；`params` 按该 `exportKey` 的 schema（C46）；`isMasked = false`（明文导出）需要权限点 `export.unmasked`、原因与再验证（`d6-notify-docs-data.md:2186`）；每名员工同时进行中的任务数受参数 `export.max_concurrent_per_staff` 限制（`14-config-data.md:301`、`956`），超限 `EXPORT_CONCURRENCY_LIMIT`。
- `GET /admin/export-jobs/{exportJobId}`：每 2 秒、至多 2 分钟，之后转入“导出记录”抽屉（`d7-platform.md:1138-1151`）；`GET /admin/export-jobs` 列出我的任务。状态取值 `queued`、`running`、`succeeded`、`failed`、`expired`、`cancelled`（`14-config-data.md:1031`）。
- 取文件：`POST /admin/export-jobs/{exportJobId}/download-urls`（路线图 `sign-url` 改），只对申请人本人、仍在职、仍持有权限点签发 5 分钟地址，每次下载写审计（`d6-notify-docs-data.md:2187-2188`）。
- 执行时按申请人**此刻**的权限与数据范围重查（`03-key-designs.md:610` R10）。
- d2 的 `POST /admin/billing/orders/export`、`/finance/payments/export`、`/finance/bank-receipts/export`、`/finance/reconciliations/export`（`d2-payment.md:1470-1475`）改为在导出登记表里注册 `exportKey`，不单独开路由。

**C65 其他异步结果。** 上传入库（`GET /m/files/{fileId}`）、ZIP 打包（未就绪返回“打包中”，端上以同一个签发请求轮询，`d7-platform.md:1272`；打包失败后返回失败状态，下载请求带 `retry: true` 才重新打包，`media.ensureZip` 增加重建选项，A99；签发发布清单文件（`kind = publish_list`）用只查不建的选项 `peek`，ZIP 未就绪时不触发打包，页面改用发布清单文本在浏览器里生成文件，A148）、付款结果（付款单的 `sync` 动作，每单每 3 秒一次，`d2-payment.md:555`）各自按资源的状态字段表达，不另建任务表；页面以服务端状态为准，不以端上回调为准（`d7-platform.md:731`）。完成通知走铃铛或订阅消息（`d6-notify-docs-data.md:2190`）。

**C84 事件目录与非 HTTP 迁移归属。** 约定只写规则，内容在单独的 `x01-events-jobs` 文档里（A40；接口文档因此共 20 份）：
- **事件目录**：每个出站事件一行，写事件名、聚合（最终表名）、载荷 schema（Zod，放 `packages/contract`）、订阅者。**事件名以 x01 的事件目录为准**（A95）：命名按 x01 第 2.1 节的规则 N1–N3（`<前缀>.<事实>`，事实用过去分词或进入的状态，一个前缀只指一种业务对象），数据模型已用而违反规则的按 x01 第 3.17 节改名（如 `account.new_wechat_bound` → `merchant_user.wechat_bound`、`refund.done` → `refund.completed`，数据模型由主负责人回写）。各接口文档里不在目录里的事件名按目录改，确实缺的由 x01 补登。载荷只增字段；新事件类型与新取值遵守 C79 的 E1（先进读路径、下一版再写出；即 x01 第 6 节的 V4）。
- **一个用例对同一事实只发一个事件**（A95；x01 第 2.4 节的 E2）：随主迁移联动的从属迁移不另发事件（如资质结论只发 `store.qualification.*`）。注意 x01 第 2.4 节的 E1–E5 是“发事件的规则”，与 C79 的 E1（d7 的版本兼容规则）不是一套编号，引用时写明出处。
- **员工激活码短信不经出站事件**（A95）：事件行永不清理、载荷不能放明文、库里只有哈希，所以改为员工用例在事务提交后直发（`notify.sendDirect`，`purpose = staff_activation`），失败由超级管理员重新生成激活码。
- **非 HTTP 迁移归属表**：数据模型状态机表里由定时器、订阅者、任务进程、回调处理触发的每一行迁移（引用 `文件:行号`）→ 由谁负责（定时器 `kind`、订阅者名、任务进程名）。由接口触发的迁移写在各接口文档的“触发的状态迁移”一栏（C81），不进此表。
- 契约自测（本稿补充）：数据模型状态机表的每一行迁移，要么至少被一个 `operationId` 的“触发的状态迁移”引用，要么出现在归属表里。

---

## 11. 敏感操作、限流、维护与最低版本

**C66 权限点注册表、能力点与后台再验证。**
- **权限点注册表以一份为准**（A13）：d4 第 7.1 节的注册表（`d4-identity.md:1141`），落地为 `packages/contract/src/permissions.ts`，全系统只有这一份（`d4-identity.md:1160`）；`adminRoute()` 的 `permission` 必填、类型为 `PermissionKey`，写错即编译失败（`d4-identity.md:1226`）。接口文档引用的权限点必须在注册表里。查看类不设权限点，用模块等级表达（`d4-identity.md:1163`；如路线图 `a03.stores.get-qualification` 的 `merchant.qualification.view` 改为模块查看）。商家端能力点同理以 d4 的能力点表为准。A129 起，权限点与能力点以 07 主文档的注册表为准，d4 附录的旧表不再回改。
- **能力点组键**（A128）：`me.*`、`cart.*`、`invoice.*`、`ticket.*` 是能力点表里登记的**单个组键**，不是通配符；路由的 `x-capability` 写这个键，处理器按这个键判权。
- **处理器内判定 `assert-in-handler`**（A45、A87）：权限取决于对象或请求体的接口，后台声明 `x-permission: assert-in-handler`，商家端声明 `x-capability: assert-in-handler`，接口文档写清处理器里的判定规则（看哪个字段、取哪个权限点或能力点、不满足时返回什么）。契约自测允许这一取值，但要求文档里有判定规则。处理器取到的权限点若在注册表里标了再验证，由处理器同样校验 `stepup_at`（返回 `STEP_UP_REQUIRED`）。已知的：
  - 后台：撤回（提交人本人，或该类型的决定权限点持有人代撤，A15）；通用文件签发 `admin.file.downloadUrls`（按文件归属与分类，A57）；明文查看 `admin.piiReveal.create`（按对象与字段）；导出 `admin.exportJob.create`、`admin.exportJob.downloadUrls`（按导出键登记的 `<模块>.export`，明文导出另要 `export.unmasked`）；其余由接口文档逐条声明（如催办、批次凭证续签、发送日志的查看）。
  - 商家端：`m.playable.get`（按资产类型：预告片匿名，广告要 `ad.request`，样片要 `delivery.confirm_sample`，A87）；`m.file.create`（按上传分类判权，A139）；站内消息 `m.message.list`、`m.message.summary`、`m.message.batchRead`、`m.message.read`（带 `X-Store-Id` 时校验 `message.read`，A139）。
- **增补表**（A13、A45、A87、A88）：路线图与接口文档里出现、注册表或能力点表里没有的新键**全部**进增补表，每行写键、模块、默认角色、是否再验证、是否附带待分配池、是否要求二次确认回显（C54 的适用范围，A129 加列）；取值由各文档作者按草案与页面给出建议，写进清单的 `permissionSupplements` 键（A140，C87），最后由汇总人统一。增补表作为 07 主文档的附录，同时登记为 d4 第 7.1 节（能力点为 d4 能力点表）待回写。已知的键：
  - 权限点：复核意见 56 列出的 `flow.ops.view`、`flow.ops.manage`、`flow.admin.transition`、`sys.health.manage`、`media.job.retry`、`files.purge.approve`、`files.restore`、`files.erase`、`drama.media.manage`、`drama.copyright.revise`、`merchant.entity.close`、`merchant.referral_code.manage`、`order.license_letter.manage`、`order.renewal.remind`、`production.normalize` / `restamp` / `recheck`、`refund.override.request`、`finance.config.propose` / `approve`、`docs.consent.evidence`、`agreement.short_notice`、`notify.resend`、`publish.link.verify_revoke`；A14 拆出的各领域决定接口的权限点；以及本轮的 `sys.super_admin`、`sys.staff.secure_ops`、`self.mfa.reset` 与导出键（见下）。
  - **模块归属**（A45）：“流程运维”（`flow.ops.*`、`flow.admin.transition`）、“系统健康”（`sys.health.manage`）、“文件清除放行”（`files.purge.approve`）归“系统”模块。
  - **只限超级管理员的操作**用新键 `sys.super_admin`（A45；如开关管理、部署核对、差异单核销），不再在处理器里写死角色判断。
  - **导出权限点** `<模块>.export`（A88）：在 d4 已有的之外补 `delivery.export`、`service.export`、`drama.export`、`billing.export`，默认授予有该模块查看权的角色，不要求再验证。
  - **能力点**（A53、A65、A87）：`asset.feedback`（素材反馈）、`todo.read`（首页待办）、`support.manager.read`（服务经理名片）、`contract.read`（协议同意的计数等合同页数据，店员 403）、`sample.view`、`ad.view`（下载页预览样片与广告）。
- **再验证（step-up）标记以注册表为准，接口不另行声明**（A13）；唯一例外是 C86 登记的驳回接口（`x-step-up: skip`，A127）。注册表里标了再验证的权限点要求会话的 `stepup_at` 在 10 分钟以内，否则 403 `STEP_UP_REQUIRED`；SPA 弹出动态口令（或恢复码）输入框 → `POST /admin/auth/step-up`（`admin.auth.stepUp`，请求体字段由身份分组的接口文档定）→ 自动重放原请求（同一幂等键）（`d4-identity.md:1376`、`2288`；`d7-platform.md:1111`）。登录本身算一次验证（`d4-identity.md:1036`）。窗口 `ADMIN_STEPUP_TTL` = 10 分钟（`d4-identity.md:2348`）。路线图里逐条写的再验证标记只作参考，与注册表不一致的以注册表为准。注册表的取值按下列裁决定（写进增补表，并登记为 d4 待回写）：
  - `sys.staff.manage` 本身**不要求**再验证；另设 `sys.staff.secure_ops`（禁用、重置密码、重置动态口令）**要求**再验证（A46）。注册表原有的 `sys.staff.mfa_reset` 并入 `sys.staff.secure_ops`，从注册表删除（A88）。
  - `finance.recon.resolve`、`order.payment.create_offline` **要求**再验证（A46）。数据模型 08 分组的 `reconcile.resolve` 改名 `finance.recon.resolve`（`08-billing-payment.md:756`，数据模型已用新名）。
  - **自助类再验证**（A60、A88）：没有权限点的本人操作（用户菜单“动态口令设置”：`admin.auth.me.enrollTotp`、`admin.auth.me.confirmTotp`）用注册表里的标记 `self.mfa.reset` 表达：对全体员工生效、标记要求再验证；路由的 `x-permission` 写这个标记，再验证仍由注册表决定。首次登录绑定仍是 `public` + 票据（A60）。
  - `flow.admin.transition` **要求**再验证；`sys.super_admin` 不另设再验证标记（A129）。
- 接口文档的“权限”一栏写权限点（或 `assert-in-handler` 与判定规则）与是否要求 `confirm`（C54），不另写再验证；C86 登记的驳回接口写明 `x-step-up: skip`。商家端 V1.0 没有再验证机制。

**C67 审批类动作。** 退款、取消退回、积分调整、补偿延长、账号变更（换绑手机号、老板更换、老板复核）、资质审核、账号核验、链接核验、受控财务配置、对公二人复核走统一审批单 `approval_request`，审批人不得是发起人；发起、决定、执行是不同的接口与权限点（`01-architecture.md:442`；`d4-identity.md:1377`）。
- **决定走各自的领域资源**（A14，R3“每类只有一个执行入口”），每条有自己的权限点与请求体：

| 审批类型（`kind`，`03-staff-authz-audit.md:889-902`） | 决定接口 |
| --- | --- |
| `qualification` | `POST /admin/qualification-submissions/{qualificationSubmissionId}/approve` / `reject` |
| `channel_account` | `POST /admin/channel-account-submissions/{channelAccountSubmissionId}/approve` / `reject` |
| `launch_link` | `POST /admin/launch-submissions/{launchSubmissionId}/approve` / `reject` |
| `order_cancel`、`ad_cancel`、`qualification_cancel` | `POST /admin/cancel-requests/{cancelRequestId}/approve` / `reject` |
| `plan_refund` | `POST /admin/refund-requests/{refundRequestId}/approve` / `reject` |
| `points_adjust` | `POST /admin/point-adjustment-requests/{pointAdjustmentRequestId}/approve` / `reject` |
| `subscription_extend` | `POST /admin/term-extension-requests/{termExtensionRequestId}/approve` / `reject` |
| `account_change` | `POST /admin/account-change-requests/{accountChangeRequestId}/approve` / `reject` |
| `finance_config_change` | `POST /admin/finance-config-revisions/{financeConfigRevisionId}/approve` / `reject` |
| `transfer_confirm` | `POST /admin/transfer-proofs/{transferProofId}/approve-review` / `reject-review` |

- **撤回同样走领域资源**（`…/withdraw`）；撤回接口的权限取决于操作人与申请的关系，声明 `assert-in-handler`（C66）。对公二人复核（`transfer_confirm`）V1.0 不提供撤回（默认不启用，A58）。`/admin/approvals` 只保留跨类型的列表、`summary` 与详情（只读，聚合“我的待审批”，A14、A16）；路线图的 `a01.approvals.approve`、`reject`、`withdraw` 删除。补偿延长、账号变更两类的审批在“我的待审批”页处理，页面列表用 `/admin/approvals`，详情与操作跳到对应领域资源（A16）。
- **撤回与作废的权限严格按数据模型**（A15）：撤回者是提交人本人；发起人已停用或对象已失效时，由该类型的决定权限点持有人代撤；取消申请的作废只限申请人（对象失效时由系统）。路线图 `a01.approvals.withdraw`“或该 kind 的决定权限点”、`a07.cancel-requests.void`“或 finance.refund.approve”的放宽写法不采用。
- 接口文档写明“审批执行器在哪个事务里调用”，并在“触发的状态迁移”一栏按该类型列出处理器 `onApproved` / `onRejected` / `onWithdrawn` 的同事务写入（复核意见 54 列出的差异单回退、周期退款标记清除、工单暂停解除、换绑时清理空账号、资质通过时驳回同信用代码的其他提交等）。
- **驳回不要求再验证**（A127；`03-staff-authz-audit.md:806`）：上表决定接口里的驳回按 C86 登记 `x-step-up: skip`；通过、撤回（代撤）、执行仍按注册表要求再验证。

**C86 驳回的再验证豁免（`x-step-up: skip`）。**（A127）
- **是什么**：路由级元数据 `x-step-up: skip`（C75）。登记了的路由，即使权限点在注册表里标了再验证，也不检查 `stepup_at`。其余检查照旧：权限点与“仅主管”、审批人不得是发起人、`lockVersion`、`confirm`（C54）。
- **只能用在哪**：“决定类权限点”的驳回接口，即 C67 表里各审批类型的 `reject` / `reject-review`。通过、撤回、执行、非审批的驳回都不能用。
- **怎么登记**：按 operationId 逐条登记在下表；新增须先改本表。契约自测双向核对：声明了 `skip` 的路由必须在表里，表里的路由必须声明 `skip`。
- **接口文档**：这些接口的“回显”栏写明 `x-step-up: skip`，错误表删去 `STEP_UP_REQUIRED`。

| operationId | 路径 | 决定权限点 | 注册表标了再验证 | 文档 |
| --- | --- | --- | --- | --- |
| `admin.accountChangeRequest.reject` | `POST /admin/account-change-requests/{accountChangeRequestId}/reject` | `merchant.account_change.approve` | 是 | a03 3.21 |
| `admin.cancelRequest.reject` | `POST /admin/cancel-requests/{cancelRequestId}/reject` | `finance.refund.approve` | 是 | a05 3.12 |
| `admin.refundRequest.reject` | `POST /admin/refund-requests/{refundRequestId}/reject` | `finance.refund.approve` | 是 | a07 3.60（A127 列在 a05 名下，路线图与接口文档都在 a07） |
| `admin.pointAdjustmentRequest.reject` | `POST /admin/point-adjustment-requests/{pointAdjustmentRequestId}/reject` | `billing.adjust.approve` | 是 | a07 3.28 |
| `admin.termExtensionRequest.reject` | `POST /admin/term-extension-requests/{termExtensionRequestId}/reject` | `billing.extension.approve` | 否（登记后行为不变，防日后改标） | a07 3.38 |
| `admin.financeConfigRevision.reject` | `POST /admin/finance-config-revisions/{financeConfigRevisionId}/reject` | `finance.config.approve`（增补） | 是（增补表建议） | a07 3.83 |
| `admin.transferProof.rejectReview` | `POST /admin/transfer-proofs/{transferProofId}/reject-review` | `finance.receipt.confirm` | 是 | a07 3.51 |
| `admin.purgeRun.reject` | `POST /admin/purge-runs/{purgeRunId}/reject` | `files.purge.approve` | 是（增补表建议） | a01（清除运行的驳回，A149） |

不登记的：`admin.transferProof.reject`（`finance.receipt.reject` 本身不要求再验证，也不是审批决定）；`admin.qualificationSubmission.reject`、`admin.channelAccountSubmission.reject`、`admin.launchSubmission.reject`（权限点在注册表里没有标再验证，无需豁免）；`admin.purgeRun.reject` 已按 A149 登记（不是审批单，但同属“决定类权限点”的驳回）。

**C68 限流。** 路由在契约里声明 `x-rate-limit` 档位（`d7-platform.md:246`）；额度是部署配置（`d4-identity.md:2362`）。**档位按 `operationId` 登记，不按路径登记**（A1）。超限 429 `RATE_LIMITED`，带 `Retry-After`。Redis 不可用时降级为进程内计数、限额减半，不放开（`d4-identity.md:1764`；`01-architecture.md:329`）。客户端 IP 按可信代理跳数从右取（`d4-identity.md:1750-1762`）。初始额度（`d4-identity.md:1768-1787`）：

| 档位 | 登记的 operationId（现行路径） | 额度 |
| --- | --- | --- |
| `m.global` | 全部 `m.*`（缺省） | 每 IP 300 次 / 分；登录后每用户 600 次 / 分 |
| `m.login.silent` | 静默登录 `m.session.create`（`POST /m/sessions`） | 每 IP 30 次 / 分（A130） |
| `m.login.phone` | 手机号登录 `m.session.phoneLogin`（`POST /m/sessions/phone-login`） | 每 IP 10 次 / 小时 + 每 openid 5 次 / 小时（A130） |
| `m.invitation` | `m.invitation.lookup`（`GET /m/invitations/lookup?token=`）、`m.invitation.accept`（`POST /m/invitations/{invitationId}/accept`） | 每 IP 30 次 / 分；每用户 10 次 / 分 |
| `m.sms` | 短信验证码：`m.smsCode.create`（`POST /m/sms-codes`，换绑手机号）、`m.storeProfile.contactSmsCode.create`（`POST /m/store-profile/contact/sms-codes`，资质联系人，A48） | 每号码 1 次 / 60 秒、5 次 / 小时、10 次 / 天；每 IP 20 次 / 小时；全站日上限熔断（部署配置）（`d4-identity.md:1776`；`02-identity-tenant.md:357`）。号码维度由 `notify.sendDirect` 按 `notification_delivery` 计数，凡直发短信（含员工激活码）都受号码限频；IP 维度只挂在这两条路由上 |
| `m.analytics` | 埋点批量上报 `m.analyticsEvent.batchCreate` | 匿名每 IP 60 次 / 分且 300 次 / 日；登录用户每用户 120 次 / 分（`d6-notify-docs-data.md:1971-1977`）；超额 429，端上丢弃该批。匿名事件的全站日总量另由参数 `analytics.anon.daily_cap` 控制，超出只丢弃不报错（m08） |
| `m.sign` | 签发类（`…/download-urls`、`…/playback-urls`，C60）：`m.qualificationDoc.downloadUrls`、`m.licenseLetter.downloadUrls`、`m.orderItem.downloadUrls`、`m.sample.downloadUrls`、`m.ad.downloadUrls`、`m.invoiceRequest.downloadUrls`；下载页 `portal.orderItem.downloadUrls`、`portal.sample.playbackUrls`、`portal.ad.playbackUrls` | 每用户 600 次 / 小时（A130；`d5-media.md:2036`）；下载页按授权它的商家用户计（C5）。Redis 不可用时按本条开头的通用降级处理，d5 写的“放行”不采用。后台的签发接口未挂此档，见第 15 节 |
| `m.subscribe` | 订阅授权结果上报 `m.subscribeResult.create` | 每用户 30 次 / 日（路线图备注、m08 的建议值） |
| `admin.login` | 登录：`admin.auth.login`、`admin.auth.verifyMfa`；激活类（登录前凭票据）：`admin.auth.activate`、`admin.auth.setPassword`、`admin.auth.enrollTotp`、`admin.auth.confirmTotp`；会话内的口令校验：`admin.auth.stepUp`、自助重新绑定 `admin.auth.me.enrollTotp`、`admin.auth.me.confirmTotp` | 每 IP 10 次 / 分 + 账号分桶锁定（`d4-identity.md:1777`）；会话内的三条改按会话计数，额度同为 10 次 / 分（a01 的默认，防在会话内穷举动态口令） |
| `admin.pii_reveal` | 明文查看 `admin.piiReveal.create` | 每名员工 60 次 / 小时、300 次 / 天（`d4-identity.md:1722`）；超限 429 并告警超级管理员 |
| `admin.notify_test` | 消息场景测试发送 `admin.notifyScene.testSend`、短信模板测试发送 `admin.smsTemplate.testSend`（合并计数） | 每名员工 5 次 / 分（`d6-notify-docs-data.md:676`） |
| `admin.global` | 全部 `admin.*`（缺省） | 每会话 600 次 / 分 |
| `portal.ticket` | `portal.portalTicket.create`（建票据）；`portal.portalTicket.get`（轮询）；`portal.portalTicket.exchange`（换会话） | 每 IP 10 张 / 分；每票据 60 次 / 分；每票据 5 次 |
| `portal.verify` | 授权书验真 `portal.licenseVerification.get`（`GET /portal/license-verifications?code=`） | 每 IP 30 次 / 分、300 次 / 小时（p01 的建议值，草案未给，待确认） |
| `portal.global` | 全部 `portal.*`（缺省） | 每会话 300 次 / 分 |
| `telemetry` | `m.clientError.create`、`admin.clientError.create`、`portal.clientError.create` | 登录用户 30 条 / 分；匿名每 IP 10 条 / 分（`d7-platform.md:884`） |
| `hooks.ip` | 全部回调：`hooks.wechatpay.transaction.notify`、`hooks.wechatpay.refund.notify`、`hooks.wechat.message.verify`、`hooks.wechat.message.receive`、`hooks.wecom.event.verify`、`hooks.wecom.event.receive`、`hooks.ci.mediaJob.wake`、`hooks.asr.mediaJob.wake`、`hooks.sms.statusReport.receive`（V1.1 `hooks.esign.event.receive`） | 不按用户限流；每来源 IP 高上限保护，额度为部署配置（`d4-identity.md:1785`）；请求体 ≤1 MB（C6） |
| 单资源 | `m.paymentOrder.sync`（`POST /m/payment-orders/{paymentOrderId}/sync`） | 每单每 3 秒一次（`d2-payment.md:555`） |

挂了专用档位的路由同时受所在组的缺省档位约束（`m.global`、`admin.global`、`portal.global`；回调没有缺省档位）。根路径探活不挂档位（C1）。涉及钱与安全状态的计数（账号锁定、每日邀请数、短信验证码的号码限频）以数据库为准，不靠 Redis（`d4-identity.md:1787`；`02-identity-tenant.md:357`）。

**C69 启动引导。** `GET /m/bootstrap`（`m.bootstrap.get`，`x-auth: optional`；d4 附录写作 `public`，`d4-identity.md:372`，登录后要多返回字段，取 d7），冷启动与回到前台超过 5 分钟时调用；响应结构由 d7 定义（`d7-platform.md:470-488`）：`serverTime`、`minClientVersion`、`flags`（按本次请求上下文求值）、`versions`（字典、站点、协议的配置版本号）、`uploadLimits`、`download.weappSaveMode`、`copy`（文案覆盖）、`support`（`wecom_kf` / `contact`）、`degraded`，以及停机维护的 `notice`（A39，见 C72）；登录后另有 `pendingConsents`、`subscribePlan`、`context.storeId`，匿名为 `null`。各块独立取数，某块失败取保守默认值并写进 `degraded`，全部失败才 5xx（`d7-platform.md:500`）。端上缓存为 `lyx.bootstrap`，接口失败用缓存，再没有用代码内保守默认值（`d7-platform.md:504`）。购买策略不在这里，由报价接口与 `GET /m/purchase-policy` 返回（`d7-platform.md:525`）。

**C70 开关是提示不是防线。** 受开关控制的路由服务端同样拦截，返回 403 `FEATURE_DISABLED`；端上收到后重拉引导并隐藏入口（`d7-platform.md:505`）。开关不按审核身份、IP 或账号区分，不用于让送审版本与线上表现不同（`d7-platform.md:529`）。

**C71 最低版本。** `minClientVersion` 即开关 `client.min_version` 的求值结果（`d7-platform.md:493`、`518`）。低于它的 `/m` 请求在“版本门槛”中间件得到 426 `CLIENT_OUTDATED`，端上用 `wx.getUpdateManager` 引导更新，不重放（`d7-platform.md:627`）。**启动引导、埋点、协议正文读取不受版本门槛拦截**（A39），按 operationId 登记豁免：`m.bootstrap.get`、`m.analyticsEvent.batchCreate`、`m.agreement.list`、`m.agreementVersion.get`；错误上报 `m.clientError.create` 沿用旧稿的豁免（本稿保留），保证旧版本能拿到“请更新”的信息并报得出错。后台与下载页不设最低版本，靠对上一个发布标签的兼容检查与 `X-Admin-Build` 提示刷新（`d7-platform.md:242`、`947`）。

**C72 停机维护。** 采纳 503 `MAINTENANCE`（A39）：确需停机时由网关对 `/m`、`/admin`、`/portal` 三组接口返回 503 `MAINTENANCE` 与 `Retry-After`（回调与探活除外，见下）。发布本身是零停机的（`d7-platform.md:1758`），可用性口径为“计划内维护不计”（`01-architecture.md:521`）。各面的处理：
- **商家端**：启动引导 `m.bootstrap.get` 由网关放行到应用，应用照常返回并带 `notice`（`MaintenanceNotice`：`title`、`body`、`expectedEndAt`，取自开关 `ops.maintenance_notice`，`exposed_to = client`，默认 `null`；A146 并入 07 主文档的待回写清单）；应用不可用时网关返回静态维护内容（m08 的默认，按第十节导语接受）。
- **下载页**：维护期间显示通用的静态维护页，不调接口（A65）。
- **回调**：照常放行，网关不返回 `MAINTENANCE`（A65）；外部平台的重试与收件箱照常工作。
- **探活**：维护开关不拦 `/healthz`、`/readyz`、`/health` 与内网明细（A83，C1）。

**C73 协议同意。** 用户级协议（`user`、`privacy`）有未同意的现行版本时，除白名单外返回 428 `CONSENT_REQUIRED`；白名单按 operationId 登记：`m.bootstrap.get`、`m.agreement.list`、`m.agreementVersion.get`（协议读取）、`m.agreementConsent.create`（提交同意）、`m.session.current.delete`（退出登录）；A85 补 `m.me.get`（d4 原白名单含 `/m/me`，`d4-identity.md:265`）、`m.me.deletion.create`（注销个人信息不以同意新隐私政策为前提）、`m.analyticsEvent.batchCreate`、`m.clientError.create`（否则有待同意协议的登录用户在这两条 `optional` 路由上被 428 拦住，埋点与错误上报丢失）。交易类协议随交易接口提交版本号，版本过期返回 `AGREEMENT_VERSION_STALE`（`d6-notify-docs-data.md:1152-1179`）。接口文档在请求体里写明需要提交的协议版本字段。

---

## 12. 契约的版本与兼容

**C74 契约来源与生成。** `packages/contract/src` 的 Zod schema 与路由定义是接口唯一手写源（`04-adr.md:34`）；`scripts/generate.ts` 生成三份 OpenAPI 3.1：`merchant.openapi.json`（`/m`）、`admin.openapi.json`（`/admin`）、`portal.openapi.json`（`/portal`），再用 openapi-typescript 生成 `.d.ts`；`hooks` 与根路径探活（`/healthz`、`/readyz`、`/health`）、内网 `/internal/health/*` 不出文档（`d7-platform.md:219-236`；`02-tech-selection.md:30`、`91`；A38、A42、A83）。生成物提交在仓库里，`contract:check` 保证与源码一致（`d7-platform.md:239`）。小程序只引类型；后台用 openapi-fetch + openapi-react-query，并直接引 Zod schema 做表单校验（`d7-platform.md:225-227`、`1110`、`1123`）。生产环境不挂 Swagger UI，预发挂在后台登录态之后（`d7-platform.md:236`）。资源登记表 `resources.json` 与权限点注册表（C66）随契约一起维护。

**C75 路由元数据。** 每条路由声明：`operationId`（C14）；`x-auth`（商家端缺省 `member`，后台缺省 `staff`，C2）；`x-capability`（商家端能力点）或 `x-permission`（后台权限点，`adminRoute()` 必填，`d4-identity.md:1226`；必须在注册表里，C66；两者都允许取值 `assert-in-handler`，A45、A87）；`x-clerk-view`（商家端，`none` / `same` / `trimmed`，C55）；`x-idempotent`（`required` / `natural` / `none`，写路由必填，C47）；`x-idempotent-by`（`natural` 时必填，约束名的字符串数组，A49）；`x-idempotent-reason`（`none` 时必填）；`x-three-phase`（三段式用例，C51）；`x-redact-on-replay`（结果脱敏时要置空的字段路径，C50）——这两个名字由 A124 认可；`x-rate-limit`（档位，C68）（`d7-platform.md:246`）；`x-step-up: skip`（只用于 C86 登记的驳回接口，A127）。再验证不在路由上声明，由权限点注册表决定（A13）；`x-step-up: skip` 是唯一的路由级例外。路线图对应的结构化字段为 `operationId`、`xAuth`、`capability` / `permission`、`clerkView`、`xIdempotent`、`idempotentBy`（数组）（A10、A11、A17、A49）；根路径探活在路线图里只登记（`registryKeyOnly: true`），没有 operationId（A83）。契约自测检查声明齐全、权限点在注册表里（`assert-in-handler` 放行，但要求接口文档写了判定规则）、资源与参数名符合登记表（C10）、`x-step-up: skip` 与 C86 的登记表一致、结构名符合公共结构登记表（C87）；`apps/api` 启动时核对“声明了什么就挂了什么中间件”，漏挂即启动失败（`d7-platform.md:246`）。

**C76 版本前缀。** V1.x 期间只有 `/api/v1`。不靠新前缀做破坏性变更；兼容靠下面的在役版本规则。

**C77 在役版本与打标签。** 小程序“生产上传”工作流在**上传生产 AppID 的那一步**给对应提交打 `weapp-vX.Y.Z`，从这一刻起该版本的契约受保护（`d7-platform.md:240`、`1871-1872`）；在役版本 = 全部 `weapp-v*` 标签减去 `packages/contract/released/retired.json` 里登记的版本；审核被拒、放弃发布、或已被 `client.min_version` 淘汰的版本由 PR 写进 `retired.json`（`d7-platform.md:241`、`1878`）。后台与下载页只对最近一个服务端发布标签 `vX.Y.Z` 比较（`d7-platform.md:242`）。服务端先于小程序发布，并对全部在役版本兼容（`d7-platform.md:1879`）。预发与生产共用一个 AppID 之后（ADR-041），“上传生产 AppID 的那一步”读作“上传送审或发布候选版本的那一步”：合并后自动上传到预发的版本不打标签。

**C78 破坏性变更的判定。** 删路径或方法；改 `operationId`；请求新增必填字段；响应删字段或把必有字段改成可空；请求枚举删值；响应枚举加值而该字段未标 `x-open-enum`（`d7-platform.md:243`）。`contract:compat` 在 CI 里对每个在役标签做结构比较（`d7-platform.md:245`）。确需破坏时，同一个 PR 把受影响版本写进 `retired.json`，并在发布检查表登记“上线后提高 `client.min_version`”（`d7-platform.md:244`）。

**C79 非破坏性变更的写法。** 新增可选请求字段、新增响应字段、新增路由、给 `x-open-enum` 的枚举加值都允许；新状态值与事件类型先在版本 N 只进读路径、版本 N+1 才写出（规则 E1，`d7-platform.md:247`）；要下线的路由先在契约里标 `deprecated: true`，等所有在役标签都不再调用后再删除（本稿补充）。

**C80 文案与开关不进契约破坏判定。** 合规敏感文案集中在端上 `src/copy/` 并可被引导接口的 `copy` 覆盖（`d7-platform.md:527`）；开关键登记在 `packages/contract/config/flags.ts`（`d7-platform.md:508`），新增键不算破坏。

### 公共结构登记表

**C87 公共结构登记表。**（A132、A140）
- **规则**：同一个 OpenAPI 文档（商家端、后台、下载页与回调）里，结构名唯一，只由归属文档定义一次；其他文档引用，不再定义同构的结构。跨文档同名不同构的，后登记的改名。
- 跨文档共用的结构登记在下表；只在一份文档里用的结构见该文档第 2 节与它的清单。同名不同构、同构不同名由 `tools/api-check/schema_dups.py` 核对（定稿时剩余的同名 2 个、同构不同名 3 组都是有意保留的，见 [07 接口契约](../07-api-contract.md) 第 9 节）。
- **清单的可选键**（A140；清单即 `frag/<文档>.json`，格式见 `API-WRITER-GUIDE.md` 第 4 节）：`externalSchemas`（本文引用的其他文档的结构名）、`permissionSupplements`（本文新增的权限点及默认授予，C66 增补表）。核对脚本读取这两个键。

| 结构 | 形态 | 归属文档 | 引用与改名 | 依据 |
| --- | --- | --- | --- | --- |
| `ImageRef` | `{ fileId, url, expiresAt }` | m08 | m06 的 `SignedImage`、a06 的“`SignedUrl` & `{ fileId }`”改为引用它；a08 已引用 | A132 |
| `SignedUrl` | `{ url, expiresAt }`；`url` 不可空，整个对象可空（C60） | a01 | 其他文档的同名定义改为引用；a05 写成 `url` 可空的按此改 | A132 |
| `AdminPage<T>` | 后台页码分页的响应（C43） | a01 | a05 的 `PageResult` 改用它 | A132 |
| `StaffBrief` | 员工摘要 | a01 | — | A132 |
| `AdminStoreBrief`、`AdminChecklistItemView`、`ChecklistResultInput` | 后台门店摘要、清单项视图、清单结果输入 | a05 | — | A132 |
| `FollowUpItem` | 跟进记录 | a03 | — | A132 |
| `ChannelAccountBrief` | 渠道账号摘要 | m05 | a06 引用 | A132 |
| `Playable` | 可播放资产（C62） | m06（2.8 为唯一定义） | — | A132 |
| `QuoteBlocker` | `{ code, message, dramaId? }` | m04 | `dramaId` 只在订购报价里出现；m06 引用 | A132 |
| `DictRef` | `{ code, name }`（C85） | 约定（C85，通用结构） | 各文档引用，不再各自定义 | A132、A133、A150 |
| `CursorPage<T>` | `{ items, nextCursor, hasMore }`（C42） | 约定（C42，通用结构） | m03、m05、p01 的同名定义改为引用 | A150 |
| `AdminCursorPage<T>` | 后台游标分页（带 `totalApprox`，C43） | a01 | a05 的 `CursorResult` 改用它 | A150 |
| `DownloadUrl` | `{ url, expiresAt, fileName, sizeBytes }` | m05 | m06 的 `AdDownloadUrl` 改为引用 | A150 |
| `EntityBrief` | 主体摘要（3 个字段） | m02 | m01 引用；m03 的同名 6 字段结构改名 | A150 |
| `FileRegistration` | 文件登记结果 | m08 | a01 引用 | A150 |
| `PortraitAuthBody` | 肖像授权材料 | m03 | a03 引用 | A150 |
| `LicensePeriod`、`LicenseConsent` | 授权书快照的期限与同意记录 | p01（2.5） | m05 `LicenseLetterPreview` 引用 | A150 |
| `PreviewChannel`（枚举） | 查看方式 | m06（与 `PlacementSlot` 同） | m05 引用 | A152 |
| `EntityQualificationBrief` | 门店档案页的主体资质摘要（6 个字段，无 `entityId`） | m03 | 原 m03 的同名 `EntityBrief` 改名 | A152 |
| `ActivityItem`、`AuditLogItem` | 对象详情页的操作记录行；审计日志页的行 | a05；a01 | 用途不同，两者都保留 | A152 |
| `SentryEnvelope` | 前端错误上报原文（≤200KB，`POST /<端>/client-errors`） | 约定（通用结构） | a01、m08、p01 同形 | A152 |
| `PendingConsent` | 待同意的协议（`CONSENT_REQUIRED` 的 `details`，C27） | m01 | 协议同意中间件与 m01 处理器同构 | A131 |
| `QuoteChangedDetails` | `QUOTE_CHANGED` 的 `details`，按 `kind` 判别（C28） | m07 | m04、m06 引用 | A131 |

后台与商家端同名但字段不同的结构，后台一侧加 `Admin` 前缀改名（如 a07 的付款单、开票申请查询结构，a09 的协议同意结构，A150）。

---

## 13. 单个接口的写法模板

**C81 模板。** 每份分组接口文档里每个接口按下面写；不适用的栏写“无”，不删栏。路径省略 `/api/v1`。

```markdown
#### <中文名>　`<方法> <路径>`

| 项 | 内容 |
| --- | --- |
| operationId | `<组>.<资源>[.<子资源>].<动作>`（C14；即幂等 scope，发布后不改名） |
| 鉴权 | `x-auth`（C2）；商家端写能力点 `x-capability`，后台写权限点 `x-permission`（须在注册表里，C66）与模块等级、数据范围（`global/store/entity/task`）；权限取决于对象或请求体的写 `assert-in-handler` 并写出判定规则（C66） |
| 回显 | 后台：是否要求 `confirm` 及其字段（C54）。再验证由权限点注册表决定，不在此另写（C66）；C86 登记的驳回接口写 `x-step-up: skip` |
| 店员视图 | 商家端 `x-clerk-view`：`none`（店员 403）/ `same` / `trimmed`（给出店员 schema 或列出被剥离的字段）（C55、C56） |
| 幂等 | `required` / `natural`（`x-idempotent-by: [<约束名>, …]`）/ `none`（写理由）；三段式用例、结果脱敏的字段另注明（C47–C51） |
| 并发 | 是否带 `lockVersion` 或 C52 的例外字段（C52、C53）；状态守卫；业务版本号 `versionNo` |
| 限流 | `x-rate-limit` 档位（C68；按本条 operationId 登记） |
| 开关 | 受哪个开关控制，关闭时的表现（C70） |

**请求**

| 位置 | 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 路径 | `{xxxId}` | uuid | 是 | 参数名按 `resources.json`（C11） |
| 查询 | … | | | 列表写分页、排序、`tab`、`q` 与筛选（C42–C45） |
| 请求体 | … | | | 金额写 `…Fen`，时间写 `…At`，枚举列出取值或引用契约 enum；手机号写 `phoneSource`（C40） |

**响应 `data`**

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| … | | | 含 `actions`（C16）、`lockVersion`（C52）、签名地址的 `expiresAt`（C60） |

**错误**

| 符号 | HTTP | 何时 | `details` |
| --- | --- | --- | --- |
| … | | | |

**触发的状态迁移**：`<表>.<状态列>: <当前> → <新>`（数据模型分组文档状态机表的那一行，写 `文件:行号`）；同事务写的审计、出站事件（事件名取 x01 的事件目录，C84）、定时器的登记或取消。

**对应画板**：`M:<画板名>`（M 编号）/ `A:<画板名>`；原型没画的写“原型无”并引用 `05-risks-and-open-issues.md` 第 4 节或设计规范第 12 节。

**出处**：路线图 id、草案接口清单、PRD、原型梳理的行号。
```

**C82 示例（示意，具体以交付分组的接口文档为准）。**

#### 确认样片　`POST /m/samples/{sampleId}/confirm`

| 项 | 内容 |
| --- | --- |
| operationId | `m.sample.confirm`（路线图 `m05.sample.confirm`） |
| 鉴权 | `member`；能力点 `delivery.confirm_sample`（`d4-identity.md:865`） |
| 回显 | 无（商家端） |
| 店员视图 | `none`（店员 403 `ROLE_FORBIDDEN`） |
| 幂等 | `required`（状态迁移，A17；路线图备注的“natural（版本号与广告版本守卫）”不采用） |
| 并发 | 状态守卫；请求体带被确认的 `versionNo`（`d3-flow.md:3171`）；该迁移的守卫没有列 `lock_version`，不带 `lockVersion`（C53） |
| 限流 | `m.global` |
| 开关 | `weapp.video.sample.enabled` 关闭时页面不内嵌播放，确认须先勾选“我已查看”（`d7-platform.md:513`、`805-810`） |

请求体（`d3-flow.md:3510`）：`versionNo`（整数）；`viewedVia`（`weapp` / `album` / `portal` / `wecom`，且须在该版本的 `preview_channels` 内，`10-delivery.md:607`）；`hasViewed`（布尔，查看方式不是 `weapp` 时必须为真；旧稿的 `ackViewed` 不合 C39，改名）。查看证据只由 `POST /m/samples/{sampleId}/download-urls`、`POST /portal/samples/{sampleId}/playback-urls` 写入（C60），本接口只核对证据存在。

错误：`STATE_NOT_ALLOWED`（样片不是 `pushed`）；版本不是当前版本时的领域码（45xxx，交付分组定）；`ROLE_FORBIDDEN`。

触发的状态迁移：`sample.status: pushed → confirmed`（`10-delivery.md:645`），守卫引用工单迁移表第 5 行；同事务写 `status_transition`、审计与出站事件 `sample.confirmed`。

对应画板：`M:Sample`（M23，`d7-platform.md:790`；平台约束见 `design-spec.md:853`）。

---

## 14. 本稿相对草案的取舍汇总

| # | 事项 | 草案的不同写法 | 本稿取 | 理由 |
| --- | --- | --- | --- | --- |
| 1 | 主键在接口里的形态 | d7：`bigint` 十进制字符串（`d7-platform.md:253`）；d4：UUID v7（`d4-identity.md:156`） | UUID v7 字符串 | R1（`03-key-designs.md:601`） |
| 2 | 商家端会话续期 | d7：刷新令牌、`SESSION_REVOKED`（`d7-platform.md:267-268`、`298`）；d4：不透明令牌、无刷新（`d4-identity.md:349`） | d4 | `02-tech-selection.md:183` |
| 3 | 门店上下文 | d4、d7：`X-Store-Id`；d3、d5：`/m/stores/{sid}/…` 共 11 条 | 请求头 | `d4-identity.md:844-846` |
| 4 | 路径参数 | 38 条业务单号、5 条集号作路径参数；冒号动作 4 条；凭证 `{token}`、`{code}`、`{sig}` 作路径段 | uuid 与配置表自然键；凭证放查询参数或请求体；普通动作段 | A3、A4 |
| 5 | 错误体 | d7：`details[{path,message}]` | `fieldErrors` + `details` + `retryable` + `requestId` | C22 |
| 6 | 错误码数值 | d1 建议 41xxx；d7 两个 403 同号 | 按 d7 分段并补 49xxx；拆号 | C25、C27 |
| 7 | 状态冲突码 | d3 `INVALID_TRANSITION`；d7 `STATE_NOT_ALLOWED` | `STATE_NOT_ALLOWED` | 通用码一处 |
| 8 | 拒收状态码 | d5 用 422 | 400 | 少一个状态码 |
| 9 | 乐观锁字段 | `expectedVersion`（d2）、`version`（d7）、`lock_version`（d3、d8、d9） | `lockVersion`，三处例外按列名 | A21、C52 |
| 10 | 幂等键范围 | ADR-013 只要求钱、积分、状态；d2 全部后台写；d3 后台靠守卫 | 三值，缺省 required，状态迁移一律 required | A17、C47 |
| 11 | 幂等的操作人 | d7 `portal:<会话 id>` | 商家用户 | `01-kernel-flow.md:56` |
| 12 | 导出入口 | d2 各列表 `…/export`；d6、d7 统一 `/admin/exports` | 统一入口 `/admin/export-jobs` | ADR-038（`04-adr.md:257`）；A1 |
| 13 | 签发下载地址 | 6 种写法（C60） | `POST …/download-urls`、`…/playback-urls`；GET 不写库 | A19 |
| 14 | 下载页提取码 | d4 保留降级入口 | 删除 | R5 |
| 15 | 时刻输出 | d7 只写“带偏移”；d5 示例 `Z` | UTC `Z` | C34 |
| 16 | 后台分组段 | d2、d4 等 `/admin/finance/…`、`/admin/sys/…` | 不加 | A6 |
| 17 | 试算 | d3 `POST …/cancel-preview`；d1 `POST …/preview`；路线图改 GET | 一律 POST，`quote` / `<动作>-quote` | A20 |
| 18 | 审批决定 | d4 通用 `/approval-inbox`；路线图通用 `/admin/approvals/{id}/approve` | 各领域资源 | A14 |
| 19 | 授权书验真 | d6 服务端直出 HTML `GET /v/{verifyCode}` | 前端路由 `/v?code=&rev=` + `GET /portal/license-verifications?code=` | A37、A100 |
| 20 | 退出登录 | 三端三种写法（`DELETE /m/sessions/current`、`POST /admin/auth/logout`、`POST /portal/session/logout`） | 统一 `DELETE /<端>/sessions/current`，幂等 `none` | A41、A43 |
| 21 | 人工催办的每日限制 | 数据模型 13 分组、草案用 429 | 通用码 409 `REMINDED_TODAY`（40920），429 只给限流 | A76 |
| 22 | 跨主体汇总金额 | C31 整数分 | `string(bigint)`，单据与单主体金额仍是整数 | A90 |
| 23 | 探活 | A38 只列 `/healthz`、`/readyz`；路线图另有 `/health` | 三条都保留，明细走内网 `/internal/health/*`，降级 503，不分配 operationId | A42、A83 |
| 24 | 员工激活码短信 | d4：经出站事件、订阅者按激活 id 去重 | 提交后直发，不经出站事件 | A95 |
| 25 | 文本内容安全检测不可用 | d4、d5：先接受、排队补检（`d4-identity.md:1883`、d5 第 11 节） | 一律拒收，503 `PROVIDER_UNAVAILABLE`，不写库 | 数据模型没有补检的落点（A137，C27） |

---

## 15. 待确认

编号沿用上一稿的保留原号；第二轮新增的从 15 起，第三轮新增的从 20 起。第三轮由裁决关闭的项留在原位，标“已由 Axxx 关闭”。

- **2.** 商家端幂等请求哈希是否计入 `X-Store-Id`（C49）。——**已由 A121 关闭**（计入，C49）。
- **3.** 游客视图的 `viewerRole = guest`（C55）是否需要在 d4 的 `respondByRole` 里补上。——**已由 A122 关闭**（采纳，列为 d4 待回写，C55）。
- **12.** 回调地址带查询参数（`?sig=`、`?token=`）是否被数据万象、语音识别、短信平台支持，接入时核对；不支持的需要 A3 的例外裁决（C6）。——**已由 A126 关闭**（不支持的改为路径里的随机段 + 服务端比对，接入时登记，C6）。
- **15.** 明文例外（A89）：平台对公收款账号对商家返回明文、对公凭证识别结果（付款户名、金额、附言、时间）按交易事实返回不走明文查看——待法务、财务确认；若法务不同意，付款户名改走 `admin.piiReveal.create`（C40）。
- **16.** 验真页主体名称的脱敏规则（保留前 2 后 4 个字，不足 7 个字只留首字，A100）待法务确认（C1）。
- **17.** `portal.verify` 的额度（每 IP 30 次 / 分、300 次 / 小时）是 p01 的建议值，草案未给，待主负责人与运维确认（C68）。
- **18.** `STORE_PROFILE_INCOMPLETE`（门店建档必填项不齐，409）被 m04 引用，但没有任何文档定义，A77 的归属表也没有列；m04 认为归 m03（档案段 49000–49099）。需要指定归属文档（C28）。——**已由 A123 关闭**（归 m03，m04 只引用，C28）。
- **19.** 本稿为 C50、C51 的契约标注补了两个元数据名 `x-redact-on-replay`、`x-three-phase`（C75），需要主负责人认可命名。——**已由 A124 关闭**（认可，C75）。
- **20.** 后台的三条签发接口（`admin.file.downloadUrls`、`admin.exportJob.downloadUrls`、`admin.deliveryTicket.material.downloadUrls`）是否也挂签发档位。A130 只给了 `m.sign`（商家端与下载页按商家用户计），本稿暂只挂 `admin.global`（C68）。——**已由 A149 关闭**：后台签发接口不另设档位，用 `admin.global` 并逐次写审计。
- **21.** a01 的 `admin.purgeRun.reject`（驳回清除运行，`files.purge.approve`，增补表建议要求再验证）是否登记 `x-step-up: skip`。它不是审批单，A127 未列，本稿暂不登记（C86）。——**已由 A149 关闭**：登记（C86）。

第二轮由裁决关闭的（原编号 → 依据）：1 下载页会话时长 → A65（确认起 2 小时，C5）；4 `/health` 的去留 → A42、A83（C1）；5 视图别名与“当前会话” → A41（第四类，C10）；6 本稿定的资源名 → A41（以登记表为准，C10）；7 后台按文件的通用签发 → A57（保留，C60）；8 退出登录形态与幂等 → A43（`DELETE /<端>/sessions/current`，`none`，C12、C47）；9 发送日志分页 → A62（页码，C43）；10 维护期间的启动引导 → 按第十节导语接受 m08 的默认（C72）；11 搜索计数与发布任务计数粒度 → A54（C42、C83）；13 再验证取值 → A46、A88（C66）；14 裁决原文路径 → A41（C10）。

---

## 16. 修订记录

| 日期 | 改了哪些条 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 表头：状态、依据加入裁决与路线图、写明“路径以路线图为准、规则以本文为准”；编号范围改为 C1–C84 | A1、A2 |
| 2026-10-03 | 第 0 节一页结论按本轮裁决重写 | A1–A40 |
| 2026-10-03 | C1：探活改为 `/healthz`、`/readyz`，资金明细走内网；授权书验真改为前端路由 `/v?code=` + `GET /portal/license-verifications?code=`，不做服务端直出 | A37、A38 |
| 2026-10-03 | C2：`x-auth` 加 `staff`，写明尚无成员关系的接口用 `user`；路线图 `auth` 拆成 `xAuth`、`capability`/`permission`、`clerkView` | A11 |
| 2026-10-03 | C3、C4：登录路径改为路线图写法（`/m/sessions`、`/m/sessions/phone-login`、`/admin/auth/verify-mfa`）并标 operationId | A1 |
| 2026-10-03 | C5：下载页票据资源改名 `portal-tickets`，路径参数用 uuid，票据码改查询参数 `lookup?code=` | A1、A3、A4、A5 |
| 2026-10-03 | C6：回调路径按路线图，签名与令牌移到查询参数；写明地址冻结与去重约束 | A1、A3、A17；复核意见 35 |
| 2026-10-03 | C7：访问日志对凭证参数脱敏 | A3 |
| 2026-10-03 | C9：三组都不加分组段；嵌套集合沿用登记的资源名 | A5、A6 |
| 2026-10-03 | C10：改写为资源登记表 `resources.json` 的规则（一表一名、三类别名、聚合视图、自测项、按资源归属文档），列出本轮定名 | A5；复核意见 44 |
| 2026-10-03 | C11：路径参数只有 uuid 与八张配置表的自然键；参数名规则；凭证、单号、集号不进路径；删去 `{checklistCode}`、`{exportKey}` 与凭证例外 | A3、A4 |
| 2026-10-03 | C12：DELETE 的范围；完整动作词表与并入关系；字面段与单例名词；字面段先于参数段注册 | A7、A8、A9 |
| 2026-10-03 | C13：试算一律 POST，命名 `quote` / `<动作>-quote`，列出路线图 GET 试算的改写 | A20 |
| 2026-10-03 | C14：operationId 规则（别名、子资源、batch 前缀、上架用 shelve），并说明限流与豁免按它登记 | A1、A9、A10 |
| 2026-10-03 | C15、C16：引用 C45 与词表 | A9、A24 |
| 2026-10-03 | C17：`X-Poll-Secret` 适用路由改为新路径 | A1、A5 |
| 2026-10-03 | C18：`Retry-After` 含 503 维护 | A39 |
| 2026-10-03 | C19：补一句 GET 自动重发与“GET 不写库”的关系 | A19 |
| 2026-10-03 | C24：202 适用接口改为 `client-errors`；503 含维护 | A1、A39 |
| 2026-10-03 | C27：`MAINTENANCE` 改为采纳；`ROLE_FORBIDDEN`、`STEP_UP_REQUIRED`、`VERSION_CONFLICT`、`STATE_NOT_ALLOWED` 的说明对齐新规则 | A11、A13、A17、A21、A39 |
| 2026-10-03 | C39：导出 `masked` 改 `isMasked` | 复核意见 28（C39 的应用） |
| 2026-10-03 | C40：明文一律 `POST /admin/pii-reveals`，GET 只回脱敏值；新增 `phoneSource` 规则 | A6、A19、A25 |
| 2026-10-03 | C41：注明 `fileId` 即 `file_object.id` | A5 |
| 2026-10-03 | C42：下载页同用游标；计数改由 summary 给；按月分段带 `prevMonth`、`firstEntryAt` | A22、A23、A34 |
| 2026-10-03 | C43：后台只增大表用游标并返回 `totalApprox`（上限 10,000） | A22 |
| 2026-10-03 | C45：页签 `tab=`、关键词 `q=`，列出路线图要改的参数名 | A24 |
| 2026-10-03 | C46：导出参数按 exportKey 各自定 schema，允许与列表不同构 | A24 |
| 2026-10-03 | C47：改为三值 `x-idempotent`，状态迁移一律 required，取消“覆盖写天然幂等”，natural 写实际约束名，none 的范围 | A17、A18；复核意见 38 |
| 2026-10-03 | C49：none 与 natural 不读写幂等表 | A18 |
| 2026-10-03 | C51：三段式补付款单取消，并标 operationId | 复核意见 46 |
| 2026-10-03 | C52、C53：锁版本字段统一 `lockVersion` 并列三处例外；内容编辑一律带，状态迁移只在守卫列了锁版本时带；消除旧稿两条的矛盾 | A21 |
| 2026-10-03 | C55：加 `x-clerk-view` 三值 | A11、A12 |
| 2026-10-03 | C56：店员视图清单按路线图开放给店员的接口扩充为逐条 operationId | A12、A33 |
| 2026-10-03 | C57：黄金文件覆盖 trimmed 与 same，none 断言 403 | A12 |
| 2026-10-03 | C58：明文走 pii-reveals | A19 |
| 2026-10-03 | C59：上传资源改名 `files`，续签统一 `refresh-credentials`，确认为 required，取消改 POST，超限返回统一引导 | A5、A7、A9、A17、A35 |
| 2026-10-03 | C60：GET 不写库；`download-urls` / `playback-urls`；列出路线图十一处改写 | A18、A19 |
| 2026-10-03 | C62：播放区分 `GET /m/playables/{playableId}` 与 `playback-urls` | A19 |
| 2026-10-03 | C63、C64、C65：任务签发用 download-urls；导出资源名 `export-jobs`、`isMasked`、exportKey 按数据模型约束 | A1、A19、A24 |
| 2026-10-03 | C66：权限点注册表唯一、增补表、再验证跟注册表走 | A13 |
| 2026-10-03 | C67：审批决定与撤回走领域资源（列出十类）；`/admin/approvals` 只读；撤回与作废权限按数据模型；“我的待审批”页 | A14、A15、A16；复核意见 54 |
| 2026-10-03 | C68：限流档位按 operationId 登记，路径改为路线图写法，补验真档位 | A1 |
| 2026-10-03 | C69：引导带 `notice` | A39 |
| 2026-10-03 | C71：版本门槛豁免按 operationId 登记（启动引导、埋点、协议正文读取） | A1、A39 |
| 2026-10-03 | C72：采纳 503 `MAINTENANCE` 与 `notice` | A39 |
| 2026-10-03 | C73：协议同意白名单按 operationId 登记 | A1 |
| 2026-10-03 | C74：探活不出文档；登记表与注册表随契约维护 | A13、A38 |
| 2026-10-03 | C75：路由元数据加 `operationId`、`x-clerk-view`、`x-idempotent-reason`，再验证不在路由上声明 | A10、A11、A13、A17 |
| 2026-10-03 | C78：改 `operationId` 算破坏性变更 | A10 |
| 2026-10-03 | C81：模板按新元数据改；C82：示例改为 required、不带 lockVersion、布尔改名 `hasViewed` | A10、A11、A13、A17、A21；复核意见 43 |
| 2026-10-03 | 新增 C83（页签计数 summary） | A23、A26 |
| 2026-10-03 | 新增 C84（事件目录与非 HTTP 迁移归属的规则，内容在 x01-events-jobs） | A40 |
| 2026-10-03 | 第 14 节加 4 行（分组段、试算、审批决定、验真）；第 15 节删去已由裁决定论的 4 项（路径参数例外、维护码、游标与“共 N 条”、同物异名），新增 11 项 | A3、A5、A20、A22、A37、A39 |
| 2026-10-03 | 新建资源登记表 `resources.json`（166 项，其中 115 项对应数据模型表） | A5 |

**第二轮（按第八、十节裁决 A41–A120 修订，2026-10-03）**

| 日期 | 改了哪些条 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 表头：状态与依据改为 A1–A120；写明第二轮不新增编号 | A41–A120 |
| 2026-10-03 | 第 0 节：补四类别名与统一退出、搜索 `totalApprox` 与不分页小集合、`summary` 页头上下文、`none` 新范围与结果脱敏、`assert-in-handler`、错误码归属 | A41、A43、A45、A49–A51、A54、A76–A80、A87 |
| 2026-10-03 | C1：探活保留 `/health`，明细走内网 `/internal/health/*`（补 `flow`），不分配 operationId（`registryKeyOnly`），降级 503，维护不拦；验真二维码带版次 `&rev=`，验真页主体名称脱敏 | A42、A83、A100 |
| 2026-10-03 | C3、C4：三端退出登录 `DELETE /<端>/sessions/current`、幂等 `none`；换绑手机号只吊销其他会话 | A41、A43、A81、A82 |
| 2026-10-03 | C5：下载页当前会话改 `/portal/sessions/current`；会话时长定为确认起 2 小时；配对数字不一致返回 200 + `status = rejected` | A41、A43、A65、A82、A101 |
| 2026-10-03 | C6：回调挂 `hooks.ip` 档位，维护期间照常放行 | A65；h01 建议 |
| 2026-10-03 | C9、C10：视图别名改为四类（加“当前会话”，并登记剧目 `basic` / `commercial` / `cast` 与主体 `quota`）；路径以路线图与登记表为准，列出资质提交、素材反馈、切换门店、联系人验证码的现行路径；补 `cast`、`refs` 定名 | A41、A48、A56、A61、A92 |
| 2026-10-03 | C12：DELETE 合规清单加三端退出；后台取消上传、工单关联移除；补登 A44 的 10 个动作词；`logout` 移出保留词 | A43、A44、A57、A92 |
| 2026-10-03 | C14：别名 operationId 改为 `session.current`；探活不分配 operationId | A41、A42、A83 |
| 2026-10-03 | C17：`STORE_ARCHIVED` 注明由 m02 定义 | A77 |
| 2026-10-03 | C24：200 可表达需落库的业务拒绝；409 加当日已催办；429 只给限流 | A76、A101 |
| 2026-10-03 | C25：引用 A70 取号区间与共用码归属；上传类码改列 47xxx | A70、A77 |
| 2026-10-03 | C27：新增通用码 `REMINDED_TODAY`（409 / 40920），取舍 ⑤ | A76 |
| 2026-10-03 | C28：新增“共用领域码归属表” | A77 |
| 2026-10-03 | C31：跨主体汇总金额为 `string(bigint)` 的例外 | A90 |
| 2026-10-03 | C40：明文查看的限流档位、幂等 `none`、处理器内判权；新增两项明文例外（平台对公收款账号、对公凭证识别结果） | A45、A51、A89 |
| 2026-10-03 | C42：搜索 `totalApprox`（封顶 999）为唯一例外；商家端不分页小集合按 operationId 登记 | A54、A55、A78 |
| 2026-10-03 | C43：发送日志改页码分页；后台不分页小集合按 operationId 登记 | A62、A78、A104 |
| 2026-10-03 | C47：`idempotentBy` 改为字符串数组；`none` 补三端退出、明文查看、主动查单，签发类附带的技术状态不改变 `none`；`required` 结果含敏感值的走结果脱敏 | A43、A49、A50、A51、A80 |
| 2026-10-03 | C50：新增“结果脱敏”（置空、`replayed: true`、换新键重调），并写明需落库的业务拒绝用 200 | A80、A101 |
| 2026-10-03 | C51：三段式改为三种形态，按 operationId 登记 12 条（11 行） | A50、A84 |
| 2026-10-03 | C52、C53：例外表加 `dramaLockVersion`；新增“无锁列、不带 `lockVersion`”的表；站点配置发布与协议草稿保存为待生效带锁版本 | A47、A104、A105 |
| 2026-10-03 | C56：站内消息改为 `same`（账号级、按门店过滤）；协议同意计数要 `contract.read`；补能力点的落点 | A52、A53、A87 |
| 2026-10-03 | C57：禁用键扫描放行 `*Mask` 与目录标价类字段 | A86 |
| 2026-10-03 | C59、C60、C62、C65：后台取消上传；上传码归 m08；保留的签发接口与通用签发判权；签发附带状态不改 `none`；`m.playable.get` 处理器内判定能力点；ZIP 失败带 `retry: true` 重建 | A49、A51、A57、A77、A84、A87、A99 |
| 2026-10-03 | C66：重写为“权限点注册表、能力点与后台再验证”：`assert-in-handler` 两端都允许；增补表规则与已知键；系统模块归属；`sys.super_admin`；导出权限点；新能力点；再验证取值（`sys.staff.secure_ops`、`finance.recon.resolve`、`order.payment.create_offline`）；`sys.staff.mfa_reset` 并入；自助标记 `self.mfa.reset` | A45、A46、A53、A60、A65、A87、A88 |
| 2026-10-03 | C67：撤回声明 `assert-in-handler`；对公二人复核 V1.0 不提供撤回 | A45、A58 |
| 2026-10-03 | C68：补限流档位 `m.sms`、`m.analytics`、`m.subscribe`、`admin.pii_reveal`、`admin.notify_test`、`hooks.ip`；`admin.login` 加激活类与会话内口令校验；`portal.verify` 填建议额度；专用档位与缺省档位同时生效 | A1；d4、d6 与 a01、a09、h01、m08、p01 的建议值 |
| 2026-10-03 | C72：维护期间各面的处理（商家端引导、下载页静态页、回调放行、探活不拦） | A65、A83；m08 默认 |
| 2026-10-03 | C73：协议同意白名单补 4 条 | A85 |
| 2026-10-03 | C74、C75：探活与内网明细不出文档；元数据允许 `assert-in-handler`、`idempotentBy` 为数组，补三段式与结果脱敏的标注 | A42、A45、A49、A80、A83、A84、A87 |
| 2026-10-03 | C81：模板的鉴权与幂等栏按上述改 | A45、A49、A80 |
| 2026-10-03 | C83：`summary` 可带页头上下文；发布任务页计数按“订单项 × 账号”；搜索计数改由 `totalApprox` 给 | A54、A79 |
| 2026-10-03 | C84：事件名以 x01 目录为准（N1–N3 与改名表）；一个用例同一事实只发一个事件（x01 的 E2）；员工激活码短信提交后直发 | A95 |
| 2026-10-03 | 第 14 节加 5 行（退出登录、催办限制码、跨主体金额、探活、激活码短信）；第 15 节关闭 11 项，保留 3 项，新增 5 项 | A41–A101 |
| 2026-10-03 | 资源登记表 `resources.json`：会话三项改为 `/<端>/sessions/current` 别名；`sms_verification` 加联系人验证码别名；`drama` 加 `basic` / `commercial` / `cast`，`entity` 加 `quota`；新增 `service_ticket_ref`（`refs`）；探活项改为 `healthz、readyz、health、internal/health/*`；另有 40 余项的 `notes` 按 A41–A105 更新（锁版本例外、不分页、限流档位、处理器内判权等）。共 167 项，其中 116 项对应数据模型表 | A41、A43、A47、A48、A52、A56、A57、A61、A62、A65、A78、A82、A83、A89、A92、A99–A105 |

**第三轮（按第十一、十二节裁决 A121–A146 修订，2026-10-03）**

| 日期 | 改了哪些条 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 表头：状态、依据改为 A1–A146；编号范围改为 C1–C87，写明第三轮新增的三条 | A121–A146 |
| 2026-10-03 | 第 0 节：数据格式补字典出入形态；`none` 补自助取口令密钥；再验证补 `x-step-up: skip` 例外；错误码归属表改为清单生成，补公共结构登记 | A127、A131–A133、A139 |
| 2026-10-03 | C4：登录票据字段 `mfaTicket` 改为 `ticket` | A139 |
| 2026-10-03 | C6：回调平台不支持查询参数时，改为路径随机段 + 服务端比对，作为 A3 的例外由接入时登记 | A126 |
| 2026-10-03 | C12：动作词表补 `download`（只用于 `actions[]`，对应 `download-urls`） | A134 |
| 2026-10-03 | C27：`STEP_UP_REQUIRED` 注明 C86 登记的驳回接口不检查；`PROVIDER_UNAVAILABLE` 含文本内容安全不可用；新增 `CONSENT_REQUIRED`、`REMINDED_TODAY` 的 `details`；新增“文本内容安全检测不可用时拒收” | A127、A131、A137 |
| 2026-10-03 | C28：归属表说明改为“由清单自动生成，归属 = 定义方”（表格保留现状，待主负责人用脚本替换）；补 `STORE_PROFILE_INCOMPLETE` 归 m03、`PLAN_REFUND_IN_PROGRESS`（m07，43006）与 `CONTENT_REJECTED`、`POINTS_INSUFFICIENT`、`QUOTE_CHANGED` 的 `details` | A123、A131 |
| 2026-10-03 | C37：同义枚举取值全仓统一（`open_order`） | A134 |
| 2026-10-03 | 新增 C85（字典编码的出入形态：响应 `DictRef[]`、请求编码数组带 `Codes` 后缀） | A133 |
| 2026-10-03 | C43：有界小集合补 `admin.orderItem.licenseLetter.list` | A139 |
| 2026-10-03 | C47：`none` 补 `admin.auth.me.enrollTotp` | A139 |
| 2026-10-03 | C49：商家端请求哈希计入 `X-Store-Id`（去掉“待确认”） | A121 |
| 2026-10-03 | C50：结果脱敏的“已知适用”改为表，补 `m.paymentOrder.create`、`m.order.create`、`m.cartItem.acceptPrice`、`admin.auth.me.confirmTotp` 与 a04 的 10 条剧目写接口，并写出字段路径 | A139 |
| 2026-10-03 | C51：`m.paymentOrder.wechatPrepay` 改为多事务；补 6 条三段式用例（`m.qualificationDoc.create`、`admin.uploadBatchItem.complete`、`admin.auth.bindWecom`、`admin.file.complete`、`admin.file.restore`、`admin.file.erase`） | A139 |
| 2026-10-03 | C52：无锁列的表补 `assignment_pool_member` | A139 |
| 2026-10-03 | C55：游客视图 `guest` 改为已采纳，列为 d4 待回写 | A122 |
| 2026-10-03 | C56：`m.serviceManager.get` 注明能力点 `support.manager.read` | A128、A139 |
| 2026-10-03 | C61：补协议 PDF 30 分钟、发布清单文件 15 分钟 | A125、A139 |
| 2026-10-03 | C62：未就绪返回 `null`；就绪但不能在小程序内播放返回只带海报的对象、`sources = []`；结构 `Playable` 以 m06 为准 | A132、A135 |
| 2026-10-03 | C66：注册表以 07 主文档为准；能力点组键不是通配符；商家端 `assert-in-handler` 补 `m.file.create` 与站内消息四条；增补表加“二次确认回显”列并由清单 `permissionSupplements` 提供；再验证的例外指向 C86；`flow.admin.transition` 要再验证、`sys.super_admin` 不另设标记 | A127–A129、A139、A140 |
| 2026-10-03 | C67：补“驳回不要求再验证”；新增 C86（`x-step-up: skip` 的适用范围、双向核对与登记表 7 条） | A127 |
| 2026-10-03 | C68：`m.login` 拆为 `m.login.silent`、`m.login.phone`；新增签发档位 `m.sign`（商家端 6 条、下载页 3 条） | A130 |
| 2026-10-03 | C72：`ops.maintenance_notice` 注明并入待回写清单 | A146 |
| 2026-10-03 | C75：`x-three-phase`、`x-redact-on-replay` 改为已认可；补 `x-step-up: skip`；自测补核对 C86、C87 | A124、A127、A132 |
| 2026-10-03 | 第 12 节新增“公共结构登记表”C87（规则、清单可选键、已裁决的 12 个结构） | A131、A132、A140 |
| 2026-10-03 | C81：模板“回显”栏补 `x-step-up: skip` | A127 |
| 2026-10-03 | 第 14 节加 1 行（文本内容安全不可用）；第 15 节 2、3、12、18、19 标为已关闭，新增 20、21 | A121–A124、A126、A127、A130、A137 |
| 2026-10-03 | 定稿：C12 动作词表补 `update`、`create-<子资源>`；C50 结果脱敏补 Banner 三条、重放时数组可为 null；C51 补 `admin.smsTemplate.testSend`、`admin.refundRequest.execute` 改多事务；C62 结构以 m06 `Playable` 为准；C65 补 ZIP 只查不建；C68 `admin.notify_test` 合并计数；C85 补单值字典字段；C86 补 `admin.purgeRun.reject`；C87 补 12 行；C28 归属表换成脚本生成的表 | A147–A156 |
