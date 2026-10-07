# W1-23 首段：M2、M3、M4 工作包分配表

| 项 | 内容 |
| --- | --- |
| 改了什么 | 计划第 7.5 节的组在本文展开为 M2 25、M3 19、M4 20 本任务书的唯一编号和分配表；环境 W2-25–29 保留，不计入这 64 本。W2-24、W3-06 各按同编号预拆甲/乙两条 PR；接口、页面、x01 和留桩的里程碑归属均不变。计划第 1 节总数本段不变；第 7.5 节详细清单与第 8.2–8.4 节核对以本文逐项表为依据，现随 W1-23a 的 M2 25 本、全部64状态与计划详细表统一回写；M3/M4 39 本由本段 b 交齐。 |
| 原因 | W1-23 第 9 节要求先提交三里程碑一次定完的拆包表，再按组并行写任务书。actual 路由清单的 M2 是 122 条：W0-31 已批准 admin.auth.activate、admin.dictItem.list 提前到 M1，本段只修正旧估算 124，不再次改归属。 |
| 影响的包 | W1-23a 交本表、M2 25 本与全部状态；W1-23b 本段交齐 M3 19 本和 M4 20 本。W2-24 PR1 甲独立交 kernel 事务作用域隔离，PR2 乙等 PR1 actual 后交探针告警；整本级别甲，两个 PR 齐才完成。W3-06 PR1甲交跨TX session mutex公开能力，PR2乙等其actual再交恢复/彻删；整本级别甲、两PR齐才完成。W2-25–29 编号、内容和现有状态本段只读。 |
| 类别 | 拆并（含估算修正） |
| PR | #124（a）；#126（b） |

## 1. 基线、口径与包数

基线为实际 main `5261473a17026e920898e18ba276151d10f130bd`；分支 `codex/w1-23-taskbook-map`，按调度要求采用 codex 前缀，偏离任务书建议的 feat 分支名。接口取 `packages/contract/generated/routes.json`；页面取官方登记与 `docs/plan/pages.md`；x01 取 `docs/plan/x01-map.md`；桩按回补里程碑取 `docs/plan/stubs/`；移交取任务 README 第 5.2 节与实际 M1 状态。首段制图时回顾尚未交付；现已正常同步 W1-21 实际 main `14f0c518032f011f0804a76c75a2d571c8e2d91b`，重读 `docs/plan/retro/m1.md` 并执行当前源真实挂载/官方四计数，结果见本节末。

| 里程碑 | 原计划组数展开 | 本段任务书 | 接口 | 新登记页/弹层 | x01 | 待回补桩 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| M2 | G2-0 2＋G2-A 6＋G2-B 8＋G2-C 3＋G2-D 代码 4＋合流 1＋G7-A 拆包 1 | 25 | 122 | 20 | 29 | 19 |
| M3 | G3-A 8＋G3-B 5＋G3-C 5＋合流 1 | 19 | 79 | 11 | 16 | 16 |
| M4 | G4-A 9＋G4-B 4＋G4-C 5＋合流 1＋M5 拆包 1 | 20 | 93 | 18 | 18 | 14 |
| 合计 | 无组数增减 | 64 | 294 | 49 | 63 | 49 |

M2 另有已建的环境五本 W2-25–29；原计划 M2 总数 32 还含 G2-E 生产两包，本段不拆 G2-E、不把生产包纳入 M2 代码退出。W2-20 留空，避免挪动五个环境编号。接口数只统计本里程碑新增归属；既有接口/页面增量列在第 5 节，不重复计数。各包验收短语是任务书验收的边界，后续九节任务书须展开为真实命令＋判据。

## 2. 三张完整拆包清单

### M2

| 编号 | 组 | 内容 | 依据 | 依赖（代码 actual） | 规模 | 级别 | 接口/新页/x01/桩 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W2-01 | G2-0 | 回调验签、两模式收件箱与重处理框架 | 约定 C6；x01 §4.5；D7 §5.2–5.3 | W0-19、W0-20、W0-23 | M | 甲 | 0/0/2/0 | 官方向量；重复/乱序/崩溃恢复性质测试；签名失败不入业务 |
| W2-02 | G2-0 | 后台主从/配置/图表与缺失通用构件 | 约定 C6；x01 §4.5；D7 §5.2–5.3 | W0-28、W1-02、W1-09 | M | 丙 | 0/0/0/0 | 真实浏览器看样、mask/validateSearch、比对与驳回提升；旧页回归 |
| W2-03 | G2-A | 员工全量、分配池、在办量与城市轮询 | a01；03/14 分组；移交 #14/#52 | W1-01b、W1-16a、W1-17、W2-17、W2-22 | L | 乙 | 18/0/2/2 | 禁用移交原子性、pickNext并发、负责人来源与staff不变量、激活码补发CLI |
| W2-04 | G2-A | 角色维护、既有鉴权下自助安全、审计与PII查询 | a01；03/14 分组；移交 #14/#52 | W1-01a | M | 乙 | 10/0/0/0 | 既有授权矩阵不变；PII访问先独立落审计；更改密码/TOTP真实链 |
| W2-05 | G2-A | 字典/参数/开关/日历/清单写侧与审批SLA | a01；03/14 分组；移交 #14/#52 | W1-06、W0-18 | M | 乙 | 13/0/3/0 | 版本/引用计数、并发更正、日历重算due_at及I3/I5 |
| W2-06 | G2-A | 员工既有页全量、角色与我的审批、安全菜单 | a01；03/14 分组；移交 #14/#52 | W2-02、W2-03、W2-04、W2-05 | L | 丙 | 0/2/0/0 | 权限/会话/池操作；旧staff页与安全菜单增量；只列已落地审批类型 |
| W2-07 | G2-A | 字典、参数、开关与清单配置页 | a01；03/14 分组；移交 #14/#52 | W2-02、W2-05 | L | 丙 | 0/4/0/0 | 四页写读闭环、服务端actions、版本冲突与确认 |
| W2-08 | G2-A | 操作日志与PII访问查询页 | a01；03/14 分组；移交 #14/#52 | W2-02、W2-04 | M | 丙 | 0/1/0/0 | 日期键盘真实浏览器；过滤/分页/裁剪/PII审计 |
| W2-09 | G2-B | 账号换绑注销、人工账号变更与渠道归因登记 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W1-04、W1-04b、W2-10 | L | 乙 | 20/0/1/1 | 六阻断端口；注销/邀请撤回/主体关闭/会话吊销同事务；休眠两支 |
| W2-10 | G2-B | 成员邀请、多门店与主体额度生命周期 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W1-03、W1-04b；主包另等本书PR1及所属收尾公口actual | M | 甲 | 17/0/2/2 | PR1只精准portal授权吊销；主包邀请异常与重放、名额/门店额度、关闭/让位及Entitlement回补；下游等整包 |
| W2-11 | G2-B | 档案资质多轮、商家聚合与跟进 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W1-08、W2-03、W2-10 | L | 乙 | 18/0/2/2 | change/new_store/终局与联络短信；聚合端口真实字段；负责人归属 |
| W2-12 | G2-B | 协议版本、同意记录与文书保留清理 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W1-03、W1-07；PR2 主包另等同编号正文技术能力 PR1 actual main | L | 乙 | 8/0/2/2 | PR1仅有界读取/Word-PDF技术转换与依赖（0HTTP/x01/桩）；actual后PR2交原八接口/2cron/2桩；下游等整包，E8正文仍外部待办 |
| W2-13 | G2-B | 账号设置与既有登录手机号组件增量 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W2-09、W2-21 | M | 丙 | 0/1/0/0 | 真实手机号组件默认V19；解绑/换绑/注销/退出与未登录设置态 |
| W2-14 | G2-B | 门店、店员档案与成员邀请六页 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W2-10、W2-11 | L | 丙 | 0/6/0/0 | 六页和邀请四异常；选择门店、成员裁剪与额度阻断 |
| W2-15 | G2-B | 商家列表/详情与渠道码三页 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W2-02、W2-09、W2-10、W2-11 | L | 丙 | 0/3/0/0 | 资质多轮/跟进/账号变更/成员主体/聚合；服务端actions |
| W2-16 | G2-B | 协议管理页 | m01/m02/m03/a03/a09；02/04 分组；移交 #53 | W2-02、W2-12 | M | 丙 | 0/1/0/0 | 版本草稿、安排生效、撤回和同意记录真实链 |
| W2-17 | G2-C | 通知场景、站内消息、提醒与派发框架 | m08；13 分组 §5.1/5.3；D7 §4.8/4.12；移交 #12/#23/#27 | W1-03、W1-14、W1-15、W1-16a、W1-17、W2-01 | L | 乙 | 5/0/5/5 | 只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| W2-18 | G2-C | 订阅结果、埋点接收与两端错误转发 | m08；13 分组 §5.1/5.3；D7 §4.8/4.12；移交 #12/#23/#27 | W1-04、W1-05、W0-24 | M | 乙 | 4/0/3/2 | 四接口；结果注入/字段清单；跨月分区与重分区/去重；未配置错误转发降级 |
| W2-19 | G2-C | 消息页与未读角标 | m08；13 分组 §5.1/5.3；D7 §4.8/4.12；移交 #12/#23/#27 | W2-17、W2-18 | S | 丙 | 0/1/0/0 | 列表/单条与全读；未读真值；订阅上报真实注入 |
| W2-21 | G2-D | 微信登录、文本/图片安全与消息回调驱动 | 01 §11–12；D7 §7–9；约定 C77/C78；ADR-041；移交 #54 | W2-01、W0-19 | M | 乙 | 2/0/1/3 | 微信官方协议向量/替身；区号不丢；未配置受控；单AppID一个接收地址 |
| W2-22 | G2-D | 短信驱动与模板签名初始化 | 01 §11–12；D7 §7–9；约定 C77/C78；ADR-041；移交 #54 | W2-01、W0-19 | M | 乙 | 0/0/2/0 | 初始化经服务函数；固定字段清单；余额/保活；真密钥与平台配置仅业主 |
| W2-23 | G2-D | 流程运维接口/页、告警确认与死信复位 | 01 §11–12；D7 §7–9；约定 C77/C78；ADR-041；移交 #54 | W2-01、W2-02、W0-23 | M | 乙 | 7/1/1/0 | 7接口+1页；按实体重投/改期/取消；CLI受限与误操作拒绝 |
| W2-24 | G2-D | 告警事务隔离前置；探针、事件告警、备份与证书检查 | 01 §11–12；D7 §7–9；约定 C77/C78；ADR-041；移交 #54 | W0-17、W0-23 | M | 甲 | 0/0/3/0 | 同编号PR1甲仅kernel事务作用域隔离；PR2乙等PR1actual再做probe/alerts/backup/cert、IP白名单与P95；业务事务告警不丢 |
| W2-30 | M2合流 | M2端到端、demo:m2、计数与里程碑核对 | W1-21 形态；计划 §6.5/7.5 | W2-01、W2-02、W2-03、W2-04、W2-05、W2-06、W2-07、W2-08、W2-09、W2-10、W2-11、W2-12、W2-13、W2-14、W2-15、W2-16、W2-17、W2-18、W2-19、W2-21、W2-22、W2-23、W2-24 | M | 丙 | 0/0/0/0 | 10次≤90秒、重复demo幂等；M2 pending清零；四计数与真机台账 |
| W2-31 | G7-A拆包 | 客服与通知通道八包任务书 | W1-23 形态；计划 §7.5 G7-A | W2-30 | M | 丙 | 0/0/0/0 | 只拆G7-A；编号/接口/页/x01/桩完整，代码不实现 |

### M3

| 编号 | 组 | 内容 | 依据 | 依赖（代码 actual） | 规模 | 级别 | 接口/新页/x01/桩 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3-01 | G3-A | 真实存储四桶与分块上传 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W1-07、X-02 | M | 乙 | 2/0/0/1 | 四桶分类/凭据/分块与promote；冻结索引问题只评估，结构另包 |
| W3-02 | G3-A | 原片/成片批量上传与消费 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-01 | L | 乙 | 8/0/0/1 | batch八接口；断点/批次重放、引用归属、delivery公开批次消费；既有制作页成片批量上传增量、0新页 |
| W3-03 | G3-A | 媒体任务循环、队列、回查与CI回调 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-01 | M | 乙 | 3/0/3/0 | lease/ProduceID/provenance、崩溃回查、mediaJob列表重投；重复回调 |
| W3-04 | G3-A | mediatool体检补标及云规格化/水印 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-03、X-02 | L | 乙 | 0/0/0/0 | probe/restamp/transcode_mp4/watermark_sample/normalize；真实读回与资源预算 |
| W3-05 | G3-A | 图片、视频与文本审核媒体任务 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-03、W2-21 | M | 乙 | 0/0/0/1 | audit_image/audit_image_wx/audit_video/audit_text；block拒签/拒引用；file.moderated |
| W3-06 | G3-A | 媒体清除、恢复与注销清理 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-01、W2-09 | M | 甲 | 6/0/1/0 | 同编号PR1甲仅跨TX session mutex公开能力与必要工厂接线；PR2乙等PR1actual做恢复/彻删、保留期/引用/归属与media.sweep，两PR齐完成 |
| W3-07 | G3-A | 制作体检流水线与交付订阅者接入 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-04、W3-05、W1-16a | M | 乙 | 0/0/1/1 | media.production.checked；delivery订阅重复/乱序；去同步桩；真实AI/时长水印 |
| W3-08 | G3-A | 文件清除放行页与流程运维媒体任务增量 | 03 §5；06 分组 §2.9/3；D5 §16；移交 #15/#55 | W2-01、W2-02、W3-03、W3-06、W2-23 | M | 丙 | 0/1/0/0 | 1新页+1已有页增量；放行拒绝/权限；媒体任务两接口接线 |
| W3-09 | G3-B | 短剧全量、原片就绪与上下架 | a04/a09/m04；05 分组；移交 #55 | W2-01、W2-02、W1-13、W3-02 | L | 乙 | 19/0/4/2 | 内容校验/原片/预览就绪；上下架与archive/stats；现存字段不造零 |
| W3-10 | G3-B | 版权与单剧积分价修订、生效与R7 | a04/a09/m04；05 分组；移交 #55 | W2-01、W2-02、W1-13、W2-17 | L | 乙 | 9/0/3/1 | 版权到期与R7去重；价格版本定时生效；billing.onTierChanged真实联动 |
| W3-11 | G3-B | 首页站点/Banner与标题搜索 | a04/a09/m04；05 分组；移交 #55 | W2-01、W2-02、W1-13 | M | 乙 | 11/0/0/2 | site发布/并发版本、Banner重排与公告事实；搜索真实排序和游标 |
| W3-12 | G3-B | 后台短剧、单剧积分价与首页商城五页 | a04/a09/m04；05 分组；移交 #55 | W2-01、W2-02、W3-09、W3-10、W3-11 | L | 丙 | 0/5/0/0 | 5页上传/修订/上下架完整；真实截图；不改通用件 |
| W3-13 | G3-B | 小程序搜索页与已有商城入口 | a04/a09/m04；05 分组；移交 #55 | W3-11 | M | 丙 | 0/1/0/1 | 搜索/分页/空态/历史与contextRev；保留商城算法 |
| W3-14 | G3-C | 素材/需求/人工复核与理解管线降级 | m03/a03；01 §8.3/9；03 §6；D5 §16；移交 #16/#55 | W2-01、W2-02、W3-01、W3-03 | L | 乙 | 20/0/2/3 | 20接口；未配置只入库人工复核；肖像授权/引用/读侧计数；reference资产端口 |
| W3-15 | G3-C | 素材ASR及vision/doc_extract/digest驱动 | m03/a03；01 §8.3/9；03 §6；D5 §16；移交 #16/#55 | W2-01、W2-02、W3-14 | M | 乙 | 1/0/1/0 | 腾讯文件ASR+境内主备模型；docText/provenance；未配置人工降级；wake重放 |
| W3-16 | G3-C | 营业执照OCR与档案识别接入 | m03/a03；01 §8.3/9；03 §6；D5 §16；移交 #16/#55 | W2-01、W2-02、W3-03、W2-11 | M | 乙 | 0/0/1/1 | ocr仅真实样本字段；profile文件审核事件；缺配置不阻断人工；E17/Q8 |
| W3-17 | G3-C | 小程序素材库/上传/详情/上传中心四页 | m03/a03；01 §8.3/9；03 §6；D5 §16；移交 #16/#55 | W3-14、W3-15 | L | 丙 | 0/4/0/2 | 4页；店员/老板裁剪、上传引用真实链；订购参考素材既有页增量 |
| W3-18 | G3-C | 既有后台商家素材复核增量 | m03/a03；01 §8.3/9；03 §6；D5 §16；移交 #16/#55 | W2-01、W2-02、W3-14、W3-15、W2-15 | M | 丙 | 0/0/0/0 | merchant.detail既有页增量；人工复核/理解失败/肖像授权；不静默添新页 |
| W3-19 | M3合流 | M3端到端、demo:m3、计数与归属核对 | W1-21 形态；计划 §6.6/7.5 | W3-01、W3-02、W3-03、W3-04、W3-05、W3-06、W3-07、W3-08、W3-09、W3-10、W3-11、W3-12、W3-13、W3-14、W3-15、W3-16、W3-17、W3-18 | M | 丙 | 0/0/0/0 | 10次≤90秒、重复demo幂等；M3 pending清零；媒体/素材真机台账 |

### M4

| 编号 | 组 | 内容 | 依据 | 依赖（代码 actual） | 规模 | 级别 | 接口/新页/x01/桩 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W4-01 | G4-A | 微信支付Provider与预下单 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、X-04、W1-11b | M | 乙 | 1/0/0/1 | 官方向量、未配置/失败降级；预下单三段式与来源校验 |
| W4-02 | G4-A | 微信回调入账、查询关单与孤儿补单 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-01、W1-11a、W1-11b | L | 乙 | 9/0/4/1 | 真实入口复用fulfill；回调重复乱序与查单竞态；I1/I2/I4/I12 |
| W4-03 | G4-A | 入账并发机制与性质验证 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-02 | M | 甲 | 0/0/0/0 | 仅同一入账并发机制；任意重放/交错仅一笔账；中断/锁序/受阻结果 |
| W4-04 | G4-A | 线下开单、凭证OCR与两人复核 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-02、W3-16 | L | 乙 | 4/0/3/2 | 对公收款入账、不同复核人/SLA、billing.onCalendarImported、OCR事件 |
| W4-05 | G4-A | 续费升级降级、到期清零与R1 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-02、W2-17 | L | 乙 | 4/0/1/3 | 升级履约/重放、延长后续费锚定日、日推进/清零；R1真实规则；I11/I13/I15/I17 |
| W4-06 | G4-A | 积分包管理与加购履约 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-02 | M | 乙 | 7/0/0/0 | 加购报价/履约/幂等、有效期与剩余积分；服务端购买策略 |
| W4-07 | G4-A | 套餐、价目修订与计费参数 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W1-10 | M | 乙 | 14/0/0/0 | 套餐版本/价格更正/撤回与参数；预发生效口径；不实现受控财务配置 |
| W4-08 | G4-A | 积分调整、套餐延长与账户流水 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-05 | L | 乙 | 17/0/0/0 | 双人审批/估值/天快照；回收与延长同事务；账本与审批不变量 |
| W4-09 | G4-A | 预发小额验证、自动退款与资金探活 | m07/a07/h01；03 §1–2；D7 §10.7；移交 #17/#55 | W2-01、W2-02、W4-03、W4-07、W4-10 | M | 乙 | 1/0/2/1 | 0.01–1.00且白名单；stg:pay-qr/三硬保护；shippingInfo默认关闭；finance真实探活 |
| W4-10 | G4-B | 退款三段式、通知/轮询与放弃事务CLI | a07；03 §1.7–1.8；移交 #17/#60 | W2-01、W2-02、W4-02、W4-05 | L | 甲 | 14/0/4/0 | 三段式单机制；重复/乱序/每段中断；refund:abandon-txn；不丢收回与闸门 |
| W4-11 | G4-B | 付款差异单处理 | a07；03 §1.7–1.8；移交 #17/#60 | W2-01、W2-02、W4-02、W4-10 | M | 乙 | 4/0/0/0 | 异常创建/解决与受阻修复；业务拒绝和基础设施故障边界 |
| W4-12 | G4-B | 账单下载与对账机制 | a07；03 §1.7–1.8；移交 #17/#60 | W2-01、W2-02、W4-02、W4-10 | L | 甲 | 2/0/2/0 | 单对账机制；重复导入/缺单/差额/乱序性质；同账单重跑不多记账 |
| W4-13 | G4-B | 发票邮件与受控财务配置 | a07；03 §1.7–1.8；移交 #17/#60 | W2-01、W2-02、W4-04、W2-17 | M | 乙 | 16/0/2/1 | 发票/红票/重发、邮件结果事件与SLA；财务配置审批；E20未配置降级 |
| W4-14 | G4-C | 小程序充值页与微信支付入口 | D7 §4.1/5.2；页面登记；移交 #55 | W4-01、W4-05、W4-06、W4-07 | M | 丙 | 0/1/0/2 | 白名单/未配置/支付取消/成功回查；旧钱包真实购买入口 |
| W4-15 | G4-C | 小程序积分流水页 | D7 §4.1/5.2；页面登记；移交 #55 | W4-08 | S | 丙 | 0/1/0/0 | 分页/筛选/余额服务端；老板与店员裁剪 |
| W4-16 | G4-C | 小程序发票与合同页 | D7 §4.1/5.2；页面登记；移交 #55 | W4-13、W2-12 | M | 丙 | 0/2/0/1 | 2页；关联单据真实业务标题；发票下载/签署协议 |
| W4-17 | G4-C | 后台套餐/积分/参数/账户/到期/线下开单六项 | D7 §4.1/5.2；页面登记；移交 #55 | W2-01、W2-02、W4-04、W4-05、W4-06、W4-07、W4-08 | L | 丙 | 0/6/0/1 | 6登记项；线下开单弹层计一项；既有订单菜单独立付款单视图增量，禁止订购/付款伪关联 |
| W4-18 | G4-C | 后台收款/退款/调整/发票/对账/财务配置八项 | D7 §4.1/5.2；页面登记；移交 #55 | W2-01、W2-02、W4-08、W4-10、W4-11、W4-12、W4-13、W2-06 | L | 丙 | 0/8/0/1 | 8登记项（两弹层）；已有审批页财务增量；服务端actions与双人检查 |
| W4-19 | M4合流 | M4端到端、demo:m4、计数与归属核对 | W1-21 形态；计划 §6.7/7.5 | W4-01、W4-02、W4-03、W4-04、W4-05、W4-06、W4-07、W4-08、W4-09、W4-10、W4-11、W4-12、W4-13、W4-14、W4-15、W4-16、W4-17、W4-18 | M | 丙 | 0/0/0/0 | 10次≤90秒、重复demo幂等；M4 pending清零；资金性质/支付退路与真机清单 |
| W4-20 | M5拆包 | M5订购交付、广告授权书与页面任务书 | W1-23 形态；计划 §7.5 M5 | W4-19 | M | 丙 | 0/0/0/0 | 只拆M5；保留取消执行甲类独包；接口/页/x01/桩唯一归属 |

## 3. 接口逐项归属（294 条）

这里只分工作包，不修改契约中的 milestone、权限、能力点、幂等或路径。后续任务书“要落地的接口”逐条照抄本表；单一 operationId 不得落入两个包。同份契约跨里程碑的 a01/a03/a09/m03/h01 仍按既有资源归属维护。

| 里程碑 | 包 | operationId |
| --- | --- | --- |
| M2 | W2-03 | `admin.assignmentPoolMember.list` |
| M2 | W2-03 | `admin.staff.bindWecom` |
| M2 | W2-03 | `admin.staff.disable` |
| M2 | W2-03 | `admin.staff.duty.update` |
| M2 | W2-03 | `admin.staff.enable` |
| M2 | W2-03 | `admin.staff.handover` |
| M2 | W2-03 | `admin.staff.inviteWecom` |
| M2 | W2-03 | `admin.staff.openWork.get` |
| M2 | W2-03 | `admin.staff.poolMembership.replace` |
| M2 | W2-03 | `admin.staff.reissueActivationCode` |
| M2 | W2-03 | `admin.staff.resetMfa` |
| M2 | W2-03 | `admin.staff.resetPassword` |
| M2 | W2-03 | `admin.staff.summary` |
| M2 | W2-03 | `admin.staff.unlock` |
| M2 | W2-03 | `admin.staff.update` |
| M2 | W2-03 | `admin.staffGroup.list` |
| M2 | W2-03 | `admin.staffSession.list` |
| M2 | W2-03 | `admin.staffSession.revoke` |
| M2 | W2-04 | `admin.auditLog.get` |
| M2 | W2-04 | `admin.auditLog.list` |
| M2 | W2-04 | `admin.auth.bindWecom` |
| M2 | W2-04 | `admin.auth.changePassword` |
| M2 | W2-04 | `admin.auth.me.confirmTotp` |
| M2 | W2-04 | `admin.auth.me.enrollTotp` |
| M2 | W2-04 | `admin.piiReveal.create` |
| M2 | W2-04 | `admin.role.defaults.get` |
| M2 | W2-04 | `admin.role.get` |
| M2 | W2-04 | `admin.role.replace` |
| M2 | W2-05 | `admin.calendarDay.batchImport` |
| M2 | W2-05 | `admin.calendarDay.list` |
| M2 | W2-05 | `admin.checklistTemplate.activate` |
| M2 | W2-05 | `admin.checklistTemplate.create` |
| M2 | W2-05 | `admin.checklistTemplate.discard` |
| M2 | W2-05 | `admin.dictItem.create` |
| M2 | W2-05 | `admin.dictItem.update` |
| M2 | W2-05 | `admin.dictType.list` |
| M2 | W2-05 | `admin.featureFlag.list` |
| M2 | W2-05 | `admin.featureFlag.update` |
| M2 | W2-05 | `admin.paramValue.list` |
| M2 | W2-05 | `admin.paramValue.replace` |
| M2 | W2-05 | `admin.paramValue.withdraw` |
| M2 | W2-09 | `m.me.changePhone` |
| M2 | W2-09 | `m.me.deletion.create` |
| M2 | W2-09 | `m.me.update` |
| M2 | W2-09 | `m.me.userNotice.acknowledge` |
| M2 | W2-09 | `m.me.wechatIdentity.delete` |
| M2 | W2-09 | `m.me.wechatIdentity.list` |
| M2 | W2-09 | `m.smsCode.create` |
| M2 | W2-09 | `admin.accountChangeRequest.approve` |
| M2 | W2-09 | `admin.accountChangeRequest.create` |
| M2 | W2-09 | `admin.accountChangeRequest.get` |
| M2 | W2-09 | `admin.accountChangeRequest.list` |
| M2 | W2-09 | `admin.accountChangeRequest.reject` |
| M2 | W2-09 | `admin.accountChangeRequest.withdraw` |
| M2 | W2-09 | `admin.merchantUser.disable` |
| M2 | W2-09 | `admin.merchantUser.enable` |
| M2 | W2-09 | `admin.merchantUser.forceLogout` |
| M2 | W2-09 | `admin.referralCode.create` |
| M2 | W2-09 | `admin.referralCode.disable` |
| M2 | W2-09 | `admin.referralCode.enable` |
| M2 | W2-09 | `admin.referralCode.list` |
| M2 | W2-10 | `m.invitation.accept` |
| M2 | W2-10 | `m.invitation.create` |
| M2 | W2-10 | `m.invitation.lookup` |
| M2 | W2-10 | `m.invitation.markShared` |
| M2 | W2-10 | `m.invitation.revoke` |
| M2 | W2-10 | `m.me.membership.leave` |
| M2 | W2-10 | `m.member.list` |
| M2 | W2-10 | `m.member.remove` |
| M2 | W2-10 | `m.member.update` |
| M2 | W2-10 | `m.store.archive` |
| M2 | W2-10 | `m.store.create` |
| M2 | W2-10 | `m.store.delete` |
| M2 | W2-10 | `m.store.restore` |
| M2 | W2-10 | `admin.entity.close` |
| M2 | W2-10 | `admin.entity.get` |
| M2 | W2-10 | `admin.entity.member.list` |
| M2 | W2-10 | `admin.entity.quota.update` |
| M2 | W2-11 | `m.qualificationDoc.downloadUrls` |
| M2 | W2-11 | `m.qualificationDoc.remove` |
| M2 | W2-11 | `m.qualificationSubmission.list` |
| M2 | W2-11 | `m.storeProfile.contactSmsCode.create` |
| M2 | W2-11 | `m.storeProfile.qualification.discard` |
| M2 | W2-11 | `admin.assignmentHistory.markContacted` |
| M2 | W2-11 | `admin.followUp.complete` |
| M2 | W2-11 | `admin.followUp.create` |
| M2 | W2-11 | `admin.followUp.list` |
| M2 | W2-11 | `admin.followUp.update` |
| M2 | W2-11 | `admin.qualificationDoc.update` |
| M2 | W2-11 | `admin.qualificationSubmission.rejectQuote` |
| M2 | W2-11 | `admin.store.activity.list` |
| M2 | W2-11 | `admin.store.profile.get` |
| M2 | W2-11 | `admin.store.profile.update` |
| M2 | W2-11 | `admin.store.qualification.get` |
| M2 | W2-11 | `admin.store.reassignDeliveryManager` |
| M2 | W2-11 | `admin.store.summary` |
| M2 | W2-12 | `admin.agreement.agreementVersion.create` |
| M2 | W2-12 | `admin.agreement.get` |
| M2 | W2-12 | `admin.agreement.list` |
| M2 | W2-12 | `admin.agreementConsent.get` |
| M2 | W2-12 | `admin.agreementConsent.list` |
| M2 | W2-12 | `admin.agreementVersion.schedule` |
| M2 | W2-12 | `admin.agreementVersion.update` |
| M2 | W2-12 | `admin.agreementVersion.withdraw` |
| M2 | W2-17 | `m.message.batchRead` |
| M2 | W2-17 | `m.message.list` |
| M2 | W2-17 | `m.message.read` |
| M2 | W2-17 | `m.message.summary` |
| M2 | W2-17 | `m.notifySetting.list` |
| M2 | W2-18 | `m.analyticsEvent.batchCreate` |
| M2 | W2-18 | `m.clientError.create` |
| M2 | W2-18 | `m.subscribeResult.create` |
| M2 | W2-18 | `admin.clientError.create` |
| M2 | W2-21 | `hooks.wechat.message.receive` |
| M2 | W2-21 | `hooks.wechat.message.verify` |
| M2 | W2-23 | `admin.outboxDelivery.list` |
| M2 | W2-23 | `admin.outboxEvent.retry` |
| M2 | W2-23 | `admin.timer.cancel` |
| M2 | W2-23 | `admin.timer.list` |
| M2 | W2-23 | `admin.timer.reschedule` |
| M2 | W2-23 | `admin.webhookEvent.list` |
| M2 | W2-23 | `admin.webhookEvent.retry` |
| M3 | W3-01 | `admin.file.cancel` |
| M3 | W3-01 | `admin.file.refreshCredentials` |
| M3 | W3-02 | `admin.uploadBatch.cancel` |
| M3 | W3-02 | `admin.uploadBatch.commit` |
| M3 | W3-02 | `admin.uploadBatch.create` |
| M3 | W3-02 | `admin.uploadBatch.get` |
| M3 | W3-02 | `admin.uploadBatch.refreshCredentials` |
| M3 | W3-02 | `admin.uploadBatch.start` |
| M3 | W3-02 | `admin.uploadBatchItem.complete` |
| M3 | W3-02 | `admin.uploadBatchItem.update` |
| M3 | W3-03 | `admin.mediaJob.list` |
| M3 | W3-03 | `admin.mediaJob.retry` |
| M3 | W3-03 | `hooks.ci.mediaJob.wake` |
| M3 | W3-06 | `admin.file.erase` |
| M3 | W3-06 | `admin.file.list` |
| M3 | W3-06 | `admin.file.restore` |
| M3 | W3-06 | `admin.purgeRun.approve` |
| M3 | W3-06 | `admin.purgeRun.list` |
| M3 | W3-06 | `admin.purgeRun.reject` |
| M3 | W3-09 | `admin.drama.activity.list` |
| M3 | W3-09 | `admin.drama.basic.update` |
| M3 | W3-09 | `admin.drama.cast.replace` |
| M3 | W3-09 | `admin.drama.commercial.update` |
| M3 | W3-09 | `admin.drama.create` |
| M3 | W3-09 | `admin.drama.delist` |
| M3 | W3-09 | `admin.drama.dramaEpisode.list` |
| M3 | W3-09 | `admin.drama.dramaPermit.create` |
| M3 | W3-09 | `admin.drama.dramaPermit.list` |
| M3 | W3-09 | `admin.drama.get` |
| M3 | W3-09 | `admin.drama.list` |
| M3 | W3-09 | `admin.drama.listingChecks.get` |
| M3 | W3-09 | `admin.drama.mediaReadiness.get` |
| M3 | W3-09 | `admin.drama.shelve` |
| M3 | W3-09 | `admin.drama.summary` |
| M3 | W3-09 | `admin.drama.trailer.replace` |
| M3 | W3-09 | `admin.dramaEpisode.update` |
| M3 | W3-09 | `admin.dramaPermit.retire` |
| M3 | W3-09 | `admin.dramaPermit.update` |
| M3 | W3-10 | `admin.drama.confirmPermitRecheck` |
| M3 | W3-10 | `admin.drama.copyright.replace` |
| M3 | W3-10 | `admin.drama.dramaCopyrightRevision.create` |
| M3 | W3-10 | `admin.drama.dramaPriceRevision.create` |
| M3 | W3-10 | `admin.dramaPrice.list` |
| M3 | W3-10 | `admin.dramaPrice.summary` |
| M3 | W3-10 | `admin.dramaPriceRevision.list` |
| M3 | W3-10 | `admin.dramaPriceRevision.withdraw` |
| M3 | W3-10 | `admin.priceTierRevision.list` |
| M3 | W3-11 | `m.drama.search` |
| M3 | W3-11 | `admin.homeBanner.batchReorder` |
| M3 | W3-11 | `admin.homeBanner.create` |
| M3 | W3-11 | `admin.homeBanner.list` |
| M3 | W3-11 | `admin.homeBanner.summary` |
| M3 | W3-11 | `admin.homeBanner.update` |
| M3 | W3-11 | `admin.siteConfig.draft.replace` |
| M3 | W3-11 | `admin.siteConfig.get` |
| M3 | W3-11 | `admin.siteConfig.publish` |
| M3 | W3-11 | `admin.siteConfig.revision.list` |
| M3 | W3-11 | `admin.siteNotice.list` |
| M3 | W3-14 | `m.assetDemand.list` |
| M3 | W3-14 | `m.storeAsset.create` |
| M3 | W3-14 | `m.storeAsset.feedback.create` |
| M3 | W3-14 | `m.storeAsset.get` |
| M3 | W3-14 | `m.storeAsset.list` |
| M3 | W3-14 | `m.storeAsset.portraitAuth.create` |
| M3 | W3-14 | `m.storeAsset.summary` |
| M3 | W3-14 | `admin.assetDemand.cancel` |
| M3 | W3-14 | `admin.assetDemand.complete` |
| M3 | W3-14 | `admin.assetDemand.create` |
| M3 | W3-14 | `admin.assetDemand.list` |
| M3 | W3-14 | `admin.storeAsset.confirmPortraitAuth` |
| M3 | W3-14 | `admin.storeAsset.create` |
| M3 | W3-14 | `admin.storeAsset.delete` |
| M3 | W3-14 | `admin.storeAsset.get` |
| M3 | W3-14 | `admin.storeAsset.list` |
| M3 | W3-14 | `admin.storeAsset.portraitAuth.create` |
| M3 | W3-14 | `admin.storeAsset.reprocess` |
| M3 | W3-14 | `admin.storeAsset.review` |
| M3 | W3-14 | `admin.storeAsset.summary` |
| M3 | W3-15 | `hooks.asr.mediaJob.wake` |
| M4 | W4-01 | `m.paymentOrder.wechatPrepay` |
| M4 | W4-02 | `m.paymentOrder.cancel` |
| M4 | W4-02 | `m.paymentOrder.list` |
| M4 | W4-02 | `m.paymentOrder.summary` |
| M4 | W4-02 | `m.paymentOrder.sync` |
| M4 | W4-02 | `admin.paymentOrder.list` |
| M4 | W4-02 | `admin.paymentOrder.summary` |
| M4 | W4-02 | `admin.paymentTransaction.list` |
| M4 | W4-02 | `admin.paymentTransaction.summary` |
| M4 | W4-02 | `hooks.wechatpay.transaction.notify` |
| M4 | W4-04 | `admin.paymentOrder.create` |
| M4 | W4-04 | `admin.paymentOrder.transferProof.create` |
| M4 | W4-04 | `admin.transferProof.approveReview` |
| M4 | W4-04 | `admin.transferProof.rejectReview` |
| M4 | W4-05 | `admin.subscriptionTerm.get` |
| M4 | W4-05 | `admin.subscriptionTerm.list` |
| M4 | W4-05 | `admin.subscriptionTerm.remind` |
| M4 | W4-05 | `admin.subscriptionTerm.summary` |
| M4 | W4-06 | `m.pointPack.list` |
| M4 | W4-06 | `admin.pointPack.create` |
| M4 | W4-06 | `admin.pointPack.delist` |
| M4 | W4-06 | `admin.pointPack.list` |
| M4 | W4-06 | `admin.pointPack.shelve` |
| M4 | W4-06 | `admin.pointPack.summary` |
| M4 | W4-06 | `admin.pointPack.update` |
| M4 | W4-07 | `admin.billingParam.list` |
| M4 | W4-07 | `admin.billingParam.withdraw` |
| M4 | W4-07 | `admin.plan.create` |
| M4 | W4-07 | `admin.plan.delist` |
| M4 | W4-07 | `admin.plan.list` |
| M4 | W4-07 | `admin.plan.planRevision.create` |
| M4 | W4-07 | `admin.plan.quote` |
| M4 | W4-07 | `admin.plan.shelve` |
| M4 | W4-07 | `admin.plan.summary` |
| M4 | W4-07 | `admin.plan.update` |
| M4 | W4-07 | `admin.planRevision.list` |
| M4 | W4-07 | `admin.planRevision.withdraw` |
| M4 | W4-07 | `admin.pricingChange.create` |
| M4 | W4-07 | `admin.pricingChange.list` |
| M4 | W4-08 | `m.pointLedgerEntry.list` |
| M4 | W4-08 | `admin.pointAccount.adjustmentQuote` |
| M4 | W4-08 | `admin.pointAccount.get` |
| M4 | W4-08 | `admin.pointAccount.list` |
| M4 | W4-08 | `admin.pointAccount.pointLedgerEntry.list` |
| M4 | W4-08 | `admin.pointAccount.summary` |
| M4 | W4-08 | `admin.pointAdjustmentRequest.approve` |
| M4 | W4-08 | `admin.pointAdjustmentRequest.create` |
| M4 | W4-08 | `admin.pointAdjustmentRequest.get` |
| M4 | W4-08 | `admin.pointAdjustmentRequest.reject` |
| M4 | W4-08 | `admin.pointAdjustmentRequest.withdraw` |
| M4 | W4-08 | `admin.subscriptionTerm.extensionQuote` |
| M4 | W4-08 | `admin.termExtensionRequest.approve` |
| M4 | W4-08 | `admin.termExtensionRequest.create` |
| M4 | W4-08 | `admin.termExtensionRequest.get` |
| M4 | W4-08 | `admin.termExtensionRequest.reject` |
| M4 | W4-08 | `admin.termExtensionRequest.withdraw` |
| M4 | W4-09 | `hooks.internalHealth.finance.get` |
| M4 | W4-10 | `admin.paymentOrder.refundQuote` |
| M4 | W4-10 | `admin.paymentOrder.refundRequest.create` |
| M4 | W4-10 | `admin.refundRequest.approve` |
| M4 | W4-10 | `admin.refundRequest.confirmNotAccepted` |
| M4 | W4-10 | `admin.refundRequest.execute` |
| M4 | W4-10 | `admin.refundRequest.get` |
| M4 | W4-10 | `admin.refundRequest.list` |
| M4 | W4-10 | `admin.refundRequest.recordOffline` |
| M4 | W4-10 | `admin.refundRequest.reject` |
| M4 | W4-10 | `admin.refundRequest.retry` |
| M4 | W4-10 | `admin.refundRequest.summary` |
| M4 | W4-10 | `admin.refundRequest.void` |
| M4 | W4-10 | `admin.refundRequest.withdraw` |
| M4 | W4-10 | `hooks.wechatpay.refund.notify` |
| M4 | W4-11 | `admin.paymentException.create` |
| M4 | W4-11 | `admin.paymentException.get` |
| M4 | W4-11 | `admin.paymentException.list` |
| M4 | W4-11 | `admin.paymentException.resolve` |
| M4 | W4-12 | `admin.reconciliation.list` |
| M4 | W4-12 | `admin.reconciliation.rerun` |
| M4 | W4-13 | `m.invoiceRequest.create` |
| M4 | W4-13 | `m.invoiceRequest.downloadUrls` |
| M4 | W4-13 | `m.invoiceRequest.list` |
| M4 | W4-13 | `m.invoiceRequest.summary` |
| M4 | W4-13 | `admin.financeConfigRevision.approve` |
| M4 | W4-13 | `admin.financeConfigRevision.create` |
| M4 | W4-13 | `admin.financeConfigRevision.list` |
| M4 | W4-13 | `admin.financeConfigRevision.reject` |
| M4 | W4-13 | `admin.financeConfigRevision.withdraw` |
| M4 | W4-13 | `admin.invoiceRequest.get` |
| M4 | W4-13 | `admin.invoiceRequest.issue` |
| M4 | W4-13 | `admin.invoiceRequest.issueRed` |
| M4 | W4-13 | `admin.invoiceRequest.list` |
| M4 | W4-13 | `admin.invoiceRequest.reject` |
| M4 | W4-13 | `admin.invoiceRequest.resend` |
| M4 | W4-13 | `admin.invoiceRequest.summary` |

## 4. 页面、x01 与留桩逐项归属

### 页面（49 项）

无独立地址的表单弹层也占一项。W2-23 按原 G2-D 单包包含流程运维一页，并不另添页面包；同样提供真实截图验收。

| 里程碑 | 包 | app | 登记 key | 名称/路由 |
| --- | --- | --- | --- | --- |
| M2 | W2-06 | admin | `approval.mine` | 我的待审批；`/approvals` |
| M2 | W2-06 | admin | `system.roles` | 角色权限；`/sys/roles` |
| M2 | W2-07 | admin | `system.dict` | 数据字典；`/sys/dict` |
| M2 | W2-07 | admin | `system.params` | 参数配置；`/sys/params` |
| M2 | W2-07 | admin | `system.flags` | 开关管理；`/sys/flags` |
| M2 | W2-07 | admin | `system.checklists` | 清单模板管理；`/sys/checklists` |
| M2 | W2-08 | admin | `system.logs` | 操作日志；`/sys/logs` |
| M2 | W2-13 | weapp | `sub/service/settings/index` | 设置；`sub/service/settings/index` |
| M2 | W2-14 | weapp | `sub/profile/stores/index` | 门店管理；`sub/profile/stores/index` |
| M2 | W2-14 | weapp | `sub/profile/store-add/index` | 新增门店；`sub/profile/store-add/index` |
| M2 | W2-14 | weapp | `sub/profile/staff-profile/index` | 店员档案；`sub/profile/staff-profile/index` |
| M2 | W2-14 | weapp | `sub/member/members/index` | 成员；`sub/member/members/index` |
| M2 | W2-14 | weapp | `sub/member/invite/index` | 邀请店员；`sub/member/invite/index` |
| M2 | W2-14 | weapp | `sub/member/join/index` | 加入门店；`sub/member/join/index` |
| M2 | W2-15 | admin | `merchant.list` | 商家列表；`/merchants` |
| M2 | W2-15 | admin | `merchant.detail` | 商家详情；`/merchants/$storeId` |
| M2 | W2-15 | admin | `merchant.referral_codes` | 渠道码登记；`/merchants/referral-codes` |
| M2 | W2-16 | admin | `ops.agreements` | 协议管理；`/ops/agreements` |
| M2 | W2-19 | weapp | `sub/service/messages/index` | 消息；`sub/service/messages/index` |
| M2 | W2-23 | admin | `system.flow_ops` | 流程运维；`/sys/flow-ops` |
| M3 | W3-08 | admin | `system.file_purges` | 文件清除放行；`/sys/file-purges` |
| M3 | W3-12 | admin | `drama.list` | 短剧列表；`/dramas` |
| M3 | W3-12 | admin | `drama.edit` | 编辑短剧；`/dramas/$id` |
| M3 | W3-12 | admin | `billing.pricing` | 单剧积分价；`/billing/pricing` |
| M3 | W3-12 | admin | `ops.home` | 首页配置；`/ops/home` |
| M3 | W3-12 | admin | `ops.mall` | 商城配置；`/ops/mall` |
| M3 | W3-13 | weapp | `sub/catalog/search/index` | 搜索；`sub/catalog/search/index` |
| M3 | W3-17 | weapp | `sub/asset/lib/index` | 素材库；`sub/asset/lib/index` |
| M3 | W3-17 | weapp | `sub/asset/upload/index` | 上传素材；`sub/asset/upload/index` |
| M3 | W3-17 | weapp | `sub/asset/detail/index` | 素材详情；`sub/asset/detail/index` |
| M3 | W3-17 | weapp | `sub/asset/uploader/index` | 上传中心；`sub/asset/uploader/index` |
| M4 | W4-14 | weapp | `sub/billing/topup/index` | 积分充值；`sub/billing/topup/index` |
| M4 | W4-15 | weapp | `sub/billing/ledger/index` | 积分流水；`sub/billing/ledger/index` |
| M4 | W4-16 | weapp | `sub/billing/invoices/index` | 发票；`sub/billing/invoices/index` |
| M4 | W4-16 | weapp | `sub/billing/contracts/index` | 合同；`sub/billing/contracts/index` |
| M4 | W4-17 | admin | `billing.plans` | 套餐管理；`/billing/plans` |
| M4 | W4-17 | admin | `billing.point_packs` | 积分包管理；`/billing/point-packs` |
| M4 | W4-17 | admin | `billing.params` | 积分价模板与参数；`/billing/params` |
| M4 | W4-17 | admin | `billing.accounts` | 积分账户与流水；`/billing/accounts` |
| M4 | W4-17 | admin | `order.renewals` | 套餐到期；`/orders/renewals` |
| M4 | W4-17 | admin | `order.offline_payment` | 线下开单；无独立地址弹层 |
| M4 | W4-18 | admin | `finance.payments` | 收款流水；`/finance/payments` |
| M4 | W4-18 | admin | `finance.refunds` | 退款管理；`/finance/refunds` |
| M4 | W4-18 | admin | `finance.credit_adjust` | 积分调整审批；`/finance/credit-adjust` |
| M4 | W4-18 | admin | `finance.invoices` | 发票管理；`/finance/invoices` |
| M4 | W4-18 | admin | `finance.reconcile` | 对账；`/finance/reconcile` |
| M4 | W4-18 | admin | `finance.offline_refund` | 线下退款登记；无独立地址弹层 |
| M4 | W4-18 | admin | `finance.red_invoice` | 红字发票；无独立地址弹层 |
| M4 | W4-18 | admin | `finance.settings` | 受控财务配置；`/finance/settings` |

### x01（63 项）

定时器按 kind × 主体计项；以下 sla.breach 的不同主体互不合并。事件发出点随所属业务包，不额外增加 x01 行。

| 里程碑 | 包 | 类别 | 名称 |
| --- | --- | --- | --- |
| M2 | W2-01 | 订阅者 | `security.onWebhookReceived` |
| M2 | W2-01 | 循环 | webhook.reprocess（`webhook_reprocess`） |
| M2 | W2-03 | 订阅者 | `staff.onCalendarImported` |
| M2 | W2-03 | 定时器 | `sla.breach`（主体 `assignment_history`） |
| M2 | W2-05 | 订阅者 | `approval.onCalendarImported` |
| M2 | W2-05 | 定时器 | `sla.breach`（主体 `approval_request`） |
| M2 | W2-05 | 周期任务 | `calendar.coverage_check` |
| M2 | W2-09 | 订阅者 | `identity.onWechatBound` |
| M2 | W2-10 | 订阅者 | `tenant.onEntitlementChanged` |
| M2 | W2-10 | 定时器 | `invitation.expire`（主体 `invitation`） |
| M2 | W2-11 | 订阅者 | `profile.onQualificationApproved` |
| M2 | W2-11 | 订阅者 | `profile.onTenantLifecycle` |
| M2 | W2-12 | 周期任务 | `docs.sweep` |
| M2 | W2-12 | 周期任务 | `evidence.consent_digest` |
| M2 | W2-17 | 订阅者 | `notify.onEvent` |
| M2 | W2-17 | 订阅者 | `notify.onMerchantUserDeleted` |
| M2 | W2-17 | 周期任务 | `notify.remind_scan` |
| M2 | W2-17 | 循环 | notify.scan（`notify_scan`） |
| M2 | W2-17 | 队列 | notify（并发 4，按通道限速）（`notify`） |
| M2 | W2-18 | 周期任务 | `analytics.dedup_purge` |
| M2 | W2-18 | 周期任务 | `analytics.partitions` |
| M2 | W2-18 | 命令行 | `ops analytics:repartition <YYYY-MM>`（`analytics_repartition`） |
| M2 | W2-21 | 回调 | `hooks.wechat.message.receive` |
| M2 | W2-22 | 周期任务 | `notify.sms_balance` |
| M2 | W2-22 | 周期任务 | `notify.sms_keepalive` |
| M2 | W2-23 | 命令行 | `cli.alerts.ack / 关闭告警、重置死信回调`（`alerts_ack`） |
| M2 | W2-24 | 周期任务 | `backup.pgdump` |
| M2 | W2-24 | 周期任务 | `ops.cert_check` |
| M2 | W2-24 | 循环 | 探针 probe()（`probe`） |
| M3 | W3-03 | 循环 | media_job 执行循环（`media_job_run`） |
| M3 | W3-03 | 队列 | 媒体任务（`media_job`） |
| M3 | W3-03 | 回调 | `hooks.ci.mediaJob.wake` |
| M3 | W3-06 | 周期任务 | `media.sweep` |
| M3 | W3-07 | 订阅者 | `delivery.onProductionChecked` |
| M3 | W3-09 | 订阅者 | `content.onMastersChanged` |
| M3 | W3-09 | 订阅者 | `content.onTrailerReady` |
| M3 | W3-09 | 周期任务 | `content.archive_sweep` |
| M3 | W3-09 | 周期任务 | `content.stat_refresh` |
| M3 | W3-10 | 订阅者 | `billing.onTierChanged` |
| M3 | W3-10 | 定时器 | `content.license_end`（主体 `drama`） |
| M3 | W3-10 | 定时器 | `pricing.drama_price_effective`（主体 `drama_price_revision`） |
| M3 | W3-14 | 订阅者 | `media.onCalendarImported` |
| M3 | W3-14 | 定时器 | `sla.breach`（主体 `store_asset`） |
| M3 | W3-15 | 回调 | `hooks.asr.mediaJob.wake` |
| M3 | W3-16 | 订阅者 | `profile.onFileModerated` |
| M4 | W4-02 | 订阅者 | `billing.applyPaymentFallback` |
| M4 | W4-02 | 定时器 | `po.expire`（主体 `billing_order`） |
| M4 | W4-02 | 周期任务 | `tx.unapplied_scan` |
| M4 | W4-02 | 回调 | `hooks.wechatpay.transaction.notify` |
| M4 | W4-04 | 订阅者 | `billing.onCalendarImported` |
| M4 | W4-04 | 订阅者 | `billing.onOcrCompleted` |
| M4 | W4-04 | 定时器 | `sla.breach`（主体 `transfer_proof`） |
| M4 | W4-05 | 周期任务 | `billing.sweep.daily` |
| M4 | W4-09 | 订阅者 | `billing.uploadShippingInfo` |
| M4 | W4-09 | 周期任务 | `stg.pay.autorefund` |
| M4 | W4-10 | 订阅者 | `billing.submitRefundTxn` |
| M4 | W4-10 | 定时器 | `rf.poll`（主体 `refund_txn`） |
| M4 | W4-10 | 回调 | `hooks.wechatpay.refund.notify` |
| M4 | W4-10 | 命令行 | `refund:abandon-txn`（`refund_abandon_txn`） |
| M4 | W4-12 | 周期任务 | `bill.download` |
| M4 | W4-12 | 周期任务 | `receipt.daily_digest` |
| M4 | W4-13 | 订阅者 | `billing.onMailResult` |
| M4 | W4-13 | 定时器 | `sla.breach`（主体 `invoice_request`） |

### 留桩（49 项）

本表指定唯一去桩责任人，跨包配合在第 5 节写明；仍保持原文件的留桩中状态、回补里程碑与原组归属，代码真实落地才可回补。正式正文 E8、云账号/真机等外部事实不能用测试通过代替。

| 里程碑 | 唯一去桩包 | 留桩文件 | 必须进入目标与验收 |
| --- | --- | --- | --- |
| M2 | W2-03 | [m2-staff-activation-sms.md](../stubs/m2-staff-activation-sms.md) | `admin.staff.create` 的激活码短信下发；禁用移交原子性、pickNext并发、负责人来源与staff不变量、激活码补发CLI |
| M2 | W2-03 | [m2-staff-assignment-pool.md](../stubs/m2-staff-assignment-pool.md) | 员工按城市轮询、分配池维护与各来源在办量；涉及 `staff.pickNext`、`admin.staff.list` 的推荐与在办量；禁用移交原子性、pickNext并发、负责人来源与staff不变量、激活码补发CLI |
| M2 | W2-09 | [m2-identity-dormant-branches.md](../stubs/m2-identity-dormant-branches.md) | 手机号登录的休眠检查里，“已休眠的店员移出门店后继续绑定”“已休眠的老板名下是空草稿时让位后继续绑定”两支没做，并到“需人工核实”一支；六阻断端口；注销/邀请撤回/主体关闭/会话吊销同事务；休眠两支 |
| M2 | W2-10 | [m2-order-store-quota.md](../stubs/m2-order-store-quota.md) | tenant.assertWithinQuota 调用点；邀请异常与重放；名额/门店额度；空草稿让位及Entitlement回补 |
| M2 | W2-10 | [m2-profile-overview-members.md](../stubs/m2-profile-overview-members.md) | 建档首页成员摘要暂不查询成员与邀请；邀请异常与重放；名额/门店额度；空草稿让位及Entitlement回补 |
| M2 | W2-11 | [m2-profile-admin-facts.md](../stubs/m2-profile-admin-facts.md) | admin.store.list/get 和 admin.qualificationSubmission.get/approve/reject 的套餐、积分、实付、关联单据、交付/上线、企业微信与联系时限字段；change/new_store/终局与联络短信；聚合端口真实字段；负责人归属 |
| M2 | W2-11 | [m2-profile-qualification-rounds.md](../stubs/m2-profile-qualification-rounds.md) | 资质暂只做首店 initial 与非终局驳回后重新提交；change/new_store/终局与联络短信；聚合端口真实字段；负责人归属 |
| M2 | W2-12 | [m2-docs-agreement-pdf-url.md](../stubs/m2-docs-agreement-pdf-url.md) | 协议版本正文接口返回的 PDF 签名读地址是占位值，端上只能看展示版 HTML，下载不了 PDF；PDF现签走端口；版本生效/撤回、sweep；E8正文仍外部待办 |
| M2 | W2-12 | [m2-docs-agreement-placeholder-text.md](../stubs/m2-docs-agreement-placeholder-text.md) | 六份协议的版本是占位文本，不是法务审定的正文（外部事项 E8）；PDF现签走端口；版本生效/撤回、sweep；E8正文仍外部待办 |
| M2 | W2-17 | [m2-billing-notification-scenes.md](../stubs/m2-billing-notification-scenes.md) | billing 事件通知场景端口；只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| M2 | W2-17 | [m2-delivery-notification-scenes.md](../stubs/m2-delivery-notification-scenes.md) | delivery 事件的通知场景解析、提醒派发；只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| M2 | W2-17 | [m2-identity-overview-notify.md](../stubs/m2-identity-overview-notify.md) | 我的聚合未读数等待通知模块的同口径事实；只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| M2 | W2-17 | [m2-order-notify-read.md](../stubs/m2-order-notify-read.md) | orderForNotify 通知读端口；只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| M2 | W2-17 | [m2-publish-notification-scenes.md](../stubs/m2-publish-notification-scenes.md) | publish 出站事件的通知场景解析与派发；只接M2场景；notify事实读端口与docs.N5上层取数端口；重复去重/删除清理；其余Rx留所属里程碑 |
| M2 | W2-18 | [m2-identity-bootstrap-subscribe.md](../stubs/m2-identity-bootstrap-subscribe.md) | 引导尚未查询已配置启用的订阅模板槽位；匿名为空，登录后订阅清单为空数组；四接口；结果注入/字段清单；跨月分区与重分区/去重；未配置错误转发降级 |
| M2 | W2-18 | [m2-weapp-analytics-report.md](../stubs/m2-weapp-analytics-report.md) | 端上埋点封装照调，接收调用未装配，不向服务端上报；四接口；结果注入/字段清单；跨月分区与重分区/去重；未配置错误转发降级 |
| M2 | W2-21 | [m2-identity-login-wechat-fake.md](../stubs/m2-identity-login-wechat-fake.md) | 静默登录与手机号登录的两次外呼（登录凭证换 openid、手机号组件的凭证换手机号）走替身，没有真实的微信驱动；微信身份行与同意记录里的 appid 是占位值；登录页的手机号凭证采集仍是替身表单；微信官方协议向量/替身；区号不丢；未配置受控；单AppID一个接收地址 |
| M2 | W2-21 | [m2-media-image-moderation.md](../stubs/m2-media-image-moderation.md) | 图片入库后暂不送内容安全审核；微信官方协议向量/替身；区号不丢；未配置受控；单AppID一个接收地址 |
| M2 | W2-21 | [m2-profile-text-moderation.md](../stubs/m2-profile-text-moderation.md) | 档案文本保存的内容检测暂用微信替身；微信官方协议向量/替身；区号不丢；未配置受控；单AppID一个接收地址 |
| M3 | W3-01 | [m3-media-storage.md](../stubs/m3-media-storage.md) | 对象存储与分块上传仍走本地小文件通道，真实存储与 STS、分块待回补；四桶分类/凭据/分块与promote；冻结索引问题只评估，结构另包 |
| M3 | W3-05 | [m3-media-video-moderation.md](../stubs/m3-media-video-moderation.md) | 视频和其余内容安全审核任务尚未接入；audit_image/audit_image_wx/audit_video/audit_text；block拒签/拒引用；file.moderated |
| M3 | W3-07 | [m3-delivery-media-production-sync.md](../stubs/m3-delivery-media-production-sync.md) | 样片与成片的制作体检、AI 标识流水线与真正水印播放版；media.production.checked；delivery订阅重复/乱序；去同步桩；真实AI/时长水印 |
| M3 | W3-09 | [m3-content-media-readiness.md](../stubs/m3-content-media-readiness.md) | L10 原片检查与 L6 预告片检查；内容校验/原片/预览就绪；上下架与archive/stats；现存字段不造零 |
| M3 | W3-09 | [m3-content-stats.md](../stubs/m3-content-stats.md) | drama_stat 与商城排序的 orders30d；内容校验/原片/预览就绪；上下架与archive/stats；现存字段不造零 |
| M3 | W3-10 | [m3-content-license-expiry.md](../stubs/m3-content-license-expiry.md) | content.license_end 定时器、I3 与到期下架的自愈；版权到期与R7去重；价格版本定时生效；billing.onTierChanged真实联动 |
| M3 | W3-11 | [m3-content-home-notice.md](../stubs/m3-content-home-notice.md) | m.home.get 老板视图的 noticeBar；site发布/并发版本、Banner重排与公告事实；搜索真实排序和游标 |
| M3 | W3-11 | [m3-content-title-search.md](../stubs/m3-content-title-search.md) | m.drama.list 的 q；site发布/并发版本、Banner重排与公告事实；搜索真实排序和游标 |
| M3 | W3-13 | [m3-weapp-mall-search.md](../stubs/m3-weapp-mall-search.md) | 首页与商城的搜索入口及搜索页面；搜索/分页/空态/历史与contextRev；保留商城算法 |
| M3 | W3-14 | [m3-order-reference-assets.md](../stubs/m3-order-reference-assets.md) | m.order.create 的 referenceStoreAssetIds 与 OrderDetail；20接口；未配置只入库人工复核；肖像授权/引用/读侧计数；reference资产端口 |
| M3 | W3-14 | [m3-profile-overview-assets.md](../stubs/m3-profile-overview-assets.md) | 建档首页素材聚合依赖素材事实端口；20接口；未配置只入库人工复核；肖像授权/引用/读侧计数；reference资产端口 |
| M3 | W3-14 | [m3-tenant-store-facts-asset.md](../stubs/m3-tenant-store-facts-asset.md) | 门店列表的门店卡里，门店素材数没有取数；20接口；未配置只入库人工复核；肖像授权/引用/读侧计数；reference资产端口 |
| M3 | W3-16 | [m3-profile-qualification-recognition.md](../stubs/m3-profile-qualification-recognition.md) | 证照上传暂不识别，提交暂不比对；ocr仅真实样本字段；profile文件审核事件；缺配置不阻断人工；E17/Q8 |
| M3 | W3-17 | [m3-weapp-clerk-assets.md](../stubs/m3-weapp-clerk-assets.md) | 店员首页的素材需求与我上传的摘要；4页；店员/老板裁剪、上传引用真实链；订购参考素材既有页增量 |
| M3 | W3-17 | [m3-weapp-order-reference-assets.md](../stubs/m3-weapp-order-reference-assets.md) | 确认订购页参考素材选择区域；4页；店员/老板裁剪、上传引用真实链；订购参考素材既有页增量 |
| M4 | W4-01 | [m4-billing-wechat-pay.md](../stubs/m4-billing-wechat-pay.md) | m.paymentOrder.wechatPrepay/sync/cancel 与微信 Provider；官方向量、未配置/失败降级；预下单三段式与来源校验 |
| M4 | W4-02 | [m4-billing-payment-channels.md](../stubs/m4-billing-payment-channels.md) | 微信渠道、孤儿与补单入账；差异处理；真实入口复用fulfill；回调重复乱序与查单竞态；I1/I2/I4/I12 |
| M4 | W4-04 | [m4-billing-proof-ocr-sla.md](../stubs/m4-billing-proof-ocr-sla.md) | transfer_proof 的 OCR、check_result、sla.breach；对公收款入账、不同复核人/SLA、billing.onCalendarImported、OCR事件 |
| M4 | W4-04 | [m4-billing-second-review.md](../stubs/m4-billing-second-review.md) | admin.transferProof.approveReview/rejectReview 与 transfer_confirm；对公收款入账、不同复核人/SLA、billing.onCalendarImported、OCR事件 |
| M4 | W4-05 | [m4-billing-fulfill-upgrade-topup.md](../stubs/m4-billing-fulfill-upgrade-topup.md) | 付清后的履约只做套餐（开通、续费、降级续费）一种内容；升级补差（当期权益换版本、补发、改写其后的发放计划）与加购（经履约入账）还没有；升级履约/重放、延长后续费锚定日、日推进/清零；R1真实规则；I11/I13/I15/I17 |
| M4 | W4-05 | [m4-billing-payment-reminders.md](../stubs/m4-billing-payment-reminders.md) | 提醒查询 R1；升级履约/重放、延长后续费锚定日、日推进/清零；R1真实规则；I11/I13/I15/I17 |
| M4 | W4-05 | [m4-billing-purchase-actions.md](../stubs/m4-billing-purchase-actions.md) | m.plan.quote、m.paymentOrder.create 的续费/升级/降级/pointPackId 分支；升级履约/重放、延长后续费锚定日、日推进/清零；R1真实规则；I11/I13/I15/I17 |
| M4 | W4-09 | [m4-ops-probe-finance.md](../stubs/m4-ops-probe-finance.md) | `GET /internal/health/finance` 只出框架，没有取数。登记键 `hooks.internalHealth.finance.get`；0.01–1.00且白名单；stg:pay-qr/三硬保护；shippingInfo默认关闭；finance真实探活 |
| M4 | W4-13 | [m4-billing-invoices.md](../stubs/m4-billing-invoices.md) | PaymentOrderDetail 开票字段与后台 invoice/refundRequests；发票/红票/重发、邮件结果事件与SLA；财务配置审批；E20未配置降级 |
| M4 | W4-14 | [m4-weapp-wallet-entries.md](../stubs/m4-weapp-wallet-entries.md) | 钱包生效中套餐的续费、升级、加购、积分明细、发票入口；白名单/未配置/支付取消/成功回查；旧钱包真实购买入口 |
| M4 | W4-14 | [m4-weapp-wechat-payment.md](../stubs/m4-weapp-wechat-payment.md) | 小程序微信支付调起、付款结果页查单轮询；白名单/未配置/支付取消/成功回查；旧钱包真实购买入口 |
| M4 | W4-16 | [m4-docs-signed-agreement-biz-title.md](../stubs/m4-docs-signed-agreement-biz-title.md) | 已签署协议的同意记录里，关联付款单的标题（“续费专业版时”“开通专业版时”）没有取数；2页；关联单据真实业务标题；发票下载/签署协议 |
| M4 | W4-18 | [m4-billing-finance-config-ui.md](../stubs/m4-billing-finance-config-ui.md) | admin.financeConfigRevision.list/propose/approve/reject/withdraw 与页面；8登记项（两弹层）；已有审批页财务增量；服务端actions与双人检查 |
| M3 | W3-02 | [m3-admin-output-batch-upload.md](../stubs/m3-admin-output-batch-upload.md) | 既有制作工单页成片批量上传、真实批次commit/消费与归属拒绝；0新页 |
| M4 | W4-17 | [m4-admin-order-payment-tab.md](../stubs/m4-admin-order-payment-tab.md) | A:Orders订单菜单独立付款单视图及子页签，真实付款ID/DTO/权限/空态；与订购单互不关联，0新页 |

## 5. 既有页增量、共享登记与真实前置

| 面 | 唯一牵头包与分工 |
| --- | --- |
| M2 员工与用户菜单 | W2-06 在 M1 员工页接完整操作/计数与修改密码/TOTP；后端 W2-03/04。只补自身页面登记事实，不重复把员工页计为 M2 新页。 |
| M2 登录/我的/档案 | W2-13 接真实手机号组件、设置退出；W2-14 接地图选点/成员与多门店；W2-11 接既有档案资质多轮。driver W2-21 是 login-wechat-fake 唯一去桩方，W2-13 完成真实组件后配合去桩；V19 未结论按任务既定默认，真机事项另记。 |
| staff 短信边界 | W2-03 牵头激活码短信桩，通过 kernel 端口/进程装配注入调用 notify，不新增 staff→notify 同层 import；W2-17 提供通知能力，W2-22 提供真实 SMS 与初始化。公共白名单需变时另走 gate-change，不能混在本包。 |
| 协议 PDF / docs.N5 | W2-12 通过既有 files 端口或新增端口现签/登记引用，不直接 docs→media；E8 文本依旧待法务。W2-17 承接移交 #54 的 docs.N5 取数归属：下层只声明端口，上层 billing/order/ad 注册各自事实，禁止 L1 直接查三张上层表。 |
| 上报与环境依赖 | m.clientError.create、admin.clientError.create 同归 W2-18，并接 weapp server 调用；W2-27 两个文字前置确定为 W2-24（第二 PR actual）和 W2-18。错误转发缺配置只日志；环境未实际配置不挡代码侧。五个环境任务/状态本段不改，后续单一整合作者核现有公开交付物。 |
| W2-24 同编号两 PR | 调度已批准：PR1 甲只改 kernel 事务作用域隔离/公共出口及必要性质和隔离测试，不含 probe/业务规则；PR2 乙只能在 PR1 actual main 后开工，再交 ops 的 probe、alerts、backup.pgdump、ops.cert_check、ADMIN_IP_ALLOWLIST、IP_NOT_ALLOWED 与每晚 P95 基线。整本任务书/状态级别甲，PR1 后状态仍进行中，PR2 actual 才完成。本基线 tx.ts 的 AsyncLocalStorage scope 没有脱离能力；不得写直接 SQL、临时全局逃逸或把它假称已有。kernel 方案须遵守唯一事务入口与事务内不外呼；告警写独立短事务而不被调用方回滚。 |
| G2-0 与跨里程碑 | M3/M4 后端回调与后台页依赖 W2-01/02 actual；没有等整个 M2 退出。R7 的 W3-10、R1 的 W4-05、邮件的 W4-13 另等 W2-17。环境/真机/预发仅写外部事项，未混入三张代码依赖列。 |
| M3 媒体 16 种任务 | W3-01 promote（既有 M1，改真实存储）；W3-04 probe/restamp/transcode_mp4/watermark_sample/normalize；W3-05 audit_image/audit_image_wx/audit_video/audit_text；W3-16 ocr；W3-15 asr/vision/doc_extract/digest；zip_package 仍 M6，不前移。W3-03 唯一登记循环/队列与 CI callback；G3-C 向该入口提供 handler，不重复注册 callback。 |
| media.sweep / production | W3-06 独占 media.sweep 登记，接 W3-14 素材清理策略；W3-03 循环接手后删除 M1 promote 补偿扫描。W3-07 去制作体检同步桩，W3-04/05 提供真实事实。M1 的已知 MP4 夹具不代表 probe/AI/水印已做。 |
| 冻结索引结构事项 | W3-01 只核 noscope 索引未含 entity_id 的移交事实，保持跨主体拒绝与同归属重用；必要迁移由调度另立结构包且一时一个在途，不能混进媒体功能包或本图假定 schema 已改变。 |
| M3 短剧与原片 | W3-09 接真实 mediaReadiness/原片/预告片；W3-10 接版权到期 I3、自愈与 R7；原 stats桩由 W3-09，homeNotice/search由 W3-11。同一 content 登记文件按资源各自入口整合，不复制已有订阅者。 |
| M3 后台两处增量 | W3-08 在 M2 system.flow_ops 加 mediaJob 两接口；W3-18 在 M2 merchant.detail 接素材人工复核，任务书引用现有页路径并保留 M3 新页总数 11。不新增 M3 复核 route 或静默修改归属。 |
| M3 商家素材增量 | W3-17 接订购参考素材选择、店员首页素材入口；后端事实与采用数由 W3-14 给出，禁止页面自算或中央 request 伪造。四个素材页照原登记。 |
| M4 公共登记 | billing.onCalendarImported 由 W4-04 单一登记，invoice W4-13 接自身到期目标，不再注册同名订阅者；hooks.wechatpay.transaction.notify W4-02、refund.notify W4-10 各一份。billing.register 的并行资源入口按现有登记机制汇合，不改中间件顺序/锁序/模块层。 |
| M4 钱与甲机制 | W4-01因换付款人前查得已付须就地入账，伴随最小可信channel-success→公共applyPayment微信适配→fulfill；W4-02消费该actual公口完善回调/兜底，与受阻保存点语义保持；W4-03 只做入账并发机制，W4-10 只退款三段式，W4-12 只对账，各甲 PR 不混页面/别的机制。升级/加购桩 W4-05 牵头并由 W4-06 接加购；冻结与清零性质 W4-08/10 与 W4-05 配合。 |
| M4 既有购买/后台增量 | W4-14 接钱包、plan-pick、结果页的真实微信与续费/升级/加购；W4-17 接既有订单菜单独立付款单视图及子页签，禁止drama_order/billing_order伪关联；W4-18 在 M2 approval.mine 加财务审批。W4-16 保持 signed-agreement-biz-title 桩原 G4-C 归属，W4-13 给 billing 批量取数。 |
| 规模修正 | 路由分配后 G2-C 接收包含四接口与端上注入，W2-18 从估算 S 记 M；W2-09 含六阻断/原子注销，W4-04/08 含资金逻辑按 §7.1 记 L。其余本表用组的既有规模或平台能力口径；乙最大 20 条，丙最大 8 项，没有扩大业务范围。 |
| 独立登记与公共文件 | 各书第 4 节须列实际 resource/私有文件目录；每模块仍一个 register.ts，先合入的本模块基础包持有聚合入口，兄弟只加自身登记函数并在独立同步提交接线。contracts 按资源私有文件，API handler 按域私有文件、登记一行；共享冻结组件需变只走 W2-02 或独立构件 PR。三份路由/页面/x01生成物只官方重生。 |

## 6. 实际移交逐项承接

以下保留出处的真实行号和原事项，不把已经办结的 M1 半项重做。多包行是原事项本来含多个子项，每个子项在第 2–5 节已有唯一主责；环境五包仅核对，不在本段改其任务/状态。领域 errors.details 的共同要求逐域进入对应书，不增加泛门禁。

| 出处（本基线行） | 接收包 | 事项 |
| --- | --- | --- |
| `docs/plan/tasks/README.md:120` | W2-17、W2-18 | 小程序请求层的可注入调用函数接上真实接口：引导与会话；订阅结果与埋点接收 |
| `docs/plan/tasks/README.md:122` | W2-04 | 明文查看接口、审计查询与导出；“先在独立事务写 `access` 审计再返回数据” |
| `docs/plan/tasks/README.md:123` | W3-03、W3-04、W3-07 | mediatool 调用端挂到 `media` 接口；`ProduceID` 的格式；媒体任务、租约与留痕写入 |
| `docs/plan/tasks/README.md:124` | W3-15 | `docText`（文档抽文本） |
| `docs/plan/tasks/README.md:125` | W2-01、W4-01、W4-02、W4-12 | 微信支付驱动接进选择分支与组合根；补 `loadEnv` 与 `.env.example` 缺的变量；到 `WEBHOOK_*` 的错误映射；真实账单复核 V13 |
| `docs/plan/tasks/README.md:128` | W2-17、W2-18 | ① 通知注册表登记的场景键与契约的 `NOTIFY_SCENES` 一一对应（启动自检或用例）。② 埋点接收接口对端上 10 个事件的属性校验结构，与契约 `ClientEventProps` 的类型同形（用例断言） |
| `docs/plan/tasks/README.md:129` | W2-03、W2-04、W2-05、W2-09、W2-10、W2-11、W2-12、W2-17、W2-18、W2-21、W3-01、W3-02、W3-03、W3-04、W3-05、W3-06、W3-07、W3-09、W3-10、W3-11、W3-14、W3-15、W3-16、W4-01、W4-02、W4-04、W4-05、W4-06、W4-07、W4-08、W4-10、W4-11、W4-12、W4-13 | 本域里标了带 `details` 的领域错误码，各登记 `details` 的结构；默认文案不合适的同 PR 改（文案不在对账之内） |
| `docs/plan/tasks/README.md:130` | W2-25、W2-26 | W1-01b：登记 `staff.I8`（`packages/services/src/staff/invariants.ts`）。发布流程：`migrate deploy` 之后跑播种；命令行入口 `pnpm db:seed` 靠 `tsx` 直接跑源码，生产镜像里没有它时由构建产物里的入口调 `runSeed` |
| `docs/plan/tasks/README.md:131` | W2-18、W2-22 | 订阅槽位的字段定义、短信模板的变量定义、模板编号与签名：种子里是空数组与 `unconfigured`，模板选定、报备通过后写 |
| `docs/plan/tasks/README.md:152` | W2-03、W2-04、W2-05、W2-06、W2-08 | 员工其余接口与页面、staff 其余不变量（`staff.I2` 在没引导过首位管理员的库上必然违规，M1 没登记）、在办来源端口、分配池与 `pickNext` 去桩、发布专员的指派、激活码短信（staff 调 notify 不在 06 第 3.6 节的同层白名单里，要定走端口还是改白名单）；用户菜单的修改密码与动态口令设置两项及页面清单补登、员工页的行内操作与页头计数；审批决定时限（`due_at`、`sla.breach`、`approval.onCalendarImported`、`approval.I3`、`I5`）、“只升锁版本”入口、字典写侧与引用计数 |
| `docs/plan/tasks/README.md:153` | W2-09、W2-10、W2-11、W2-12、W2-13、W2-14 | 登录表单换成手机号组件并去桩；休眠检查的两支；“退出登录”移进设置页；协议 PDF 的读地址与 docs 登记文件引用怎么走（06 第 3.6 节的同层白名单没有 docs → media，13 分组 第 5.1 节却要 docs 调 `files.link()`：走端口或单独的 `gate-change`）；`notices.withdraw`；资质的 `change`、`new_store` 轮次与终局驳回、联系人发码、后台商家聚合端口的各键、建档首页成员摘要、小程序地图选点入口（业主申请的 `chooseLocation` 通过后）；门店数额度校验 |
| `docs/plan/tasks/README.md:154` | W2-02、W2-17、W2-18、W2-21、W2-24、W2-25、W2-27 | G2-0 的构件包：`QueryTablePage` 的列脱敏声明 `mask`、路由 `validateSearch` 复用契约的查询结构；并排比对表与驳回弹层若还是页面私有就提升。G2-C：事实端口的 `notify` 键；billing、order、delivery、publish、approval 的通知场景解析（M1 的事件已照发）；定 `docs.N5` 的归属（要读付款单、订购单、广告三张上层表，docs 在 L1 登记不了）。G2-D 的代码包：后台来源 IP 白名单（`ADMIN_IP_ALLOWLIST`、`IP_NOT_ALLOWED`）；锁定告警的规则键 `auth.staff_untrusted_locked` 进告警最小集；事件型告警规则的登记处收进 `sla.calendar_fallback` 等已在用的键；`alerts.raise` 在业务事务里被调不能丢（`sla.dueAt` 就在业务事务里调它；实现要另开独立事务时会被 kernel 的嵌套检测拦下，得先由 kernel 给一个“脱离当前事务作用域”的办法，G2-D 的代码包开工前做）；`ops.cert_check` 对还解析不到的读域名记“未配置”；`backup.pgdump` 的上传走存储 Provider；两条错误上报转发接口归到一个代码包（同时接上小程序 `apps/weapp/src/lib/server.ts` 里错误上报的那个调用，W0-27a 留的），并把 W2-27 依赖里的两处文字换成编号；预发的 `AUTH_KEYS_FILE` 生成步骤进环境包的密钥清单；计划 第 5.5 节“M2 起加”的每晚 P95 基线归到一个包 |
| `docs/plan/tasks/README.md:155` | W3-01、W3-02、W3-03、W3-04、W3-05、W3-06、W3-07、W3-09、W3-11、W3-14、W3-16、W4-02、W4-04、W4-05、W4-06、W4-08、W4-14、W4-17 | G3-A：真实存储与分块、`media.sweep`；执行循环接手后删掉 W1-07 的 promote 补偿扫描；体检接入包替换 `media/production-stub.ts`；成片批量上传；预发 mediatool 的内存上限实测后定是否升配。G3-B：原片与预告片就绪、版权到期定时器与 `content.I3`、订购统计、公告条、搜索。G3-C：OCR 接上证照识别与提交时的字段比对；事实端口的 `asset` 键；参考素材。G4-A、G4-B、G4-C：续费、升级、降级、加购的报价与履约；微信渠道入账（付款人与回传数据校验、孤儿交易、补单）；对公二人复核；凭证的 `sla.breach` 与回单识别；unexpire、revoke、extend、调整审批；估值与日快照及 `billing.I11`、`I13`、`I15`、`I17`；payment 不变量从 I16 续编；延长后续费的锚定日；提醒查询 R1；钱包里生效中的续费、升级、加购入口与微信支付调起；订购单页的付款单页签 |
| `docs/plan/tasks/README.md:159` | W4-13 | 审计按键名里的词脱敏（`packages/services/src/audit/sensitive.ts`），有几个不敏感的键会被多遮：`storeTel`（门店公开的联系电话，W1-08）、`bankAccountFinanceConfigRevisionId`（收款账户版本的 id，W1-11b）、`emailState` 与 `emailSentAt`（发票邮件的投递状态，M4）。本域写审计的前后值带到这些键时由本域的包收：在敏感键清单里加例外（只增，带用例），或写审计时换一个不撞词的键名；做法记偏差 |
| `docs/plan/tasks/README.md:162` | W2-17、W3-11 | W1-08：`tenant.setStoreQualification` 通过时两个主体的信用代码撞唯一索引 `uq_entity_uscc_bidx_verified` 会让事务中止，要接它就包在 `savepoint` 里并用 `isUniqueViolation` 认；认证字段的三件套由调用方做好传入。G2-C：`notices.announce` 的深链现在写的是 `agreement.version`，深链路由表进契约时登记它（或改成表里的键）；`site_notice.announced` 的订阅与首页公告条的读取 |
| `docs/plan/tasks/README.md:164` | W2-05 | `lockRows` 只有 `FOR UPDATE`、`FOR SHARE` 两种强度，`flow.transition` 也按 `FOR UPDATE` 锁对象行；03 分组 第 2.12 节写审批单用 `FOR NO KEY UPDATE`（领域表插行时的外键检查要取 `FOR KEY SHARE`）。现在照 `FOR UPDATE` 锁，结果对，只是别的事务往领域表插行要等决定的事务结束。要照文档就给 `lockRows` 加一种强度并让 flow 按表选。另：x01 第 2.3 节“其余本文定的取法”里补 `approval.executed:{approvalRequestId}`（`approval.recordExecuted` 用的去重键） |
| `docs/plan/tasks/README.md:165` | W4-05、W4-08、W4-10 | 第二个 PR：冻结（`hold`）走账户锁的那一条（验收 4）、“清零与冻结落在同一时刻”（验收 8）在第一个 PR 里用加购入账代替，冻结落地后各补一条；自检与写入顺序里冻结单、分摊的那一半；契约里冻结一族的文案码参数是照 m07 第 4.5 节先写的，用到时核一遍。W1-11a：建计费账户的端口实现调 `ledger.ensureAccount`；建好生效周期后调 `ledger.grant(tx, { grantScheduleId, ctx })` 发首月（它连 `next_due_at` 一起算），建预约周期后调 `ledger.refreshNextDue`；api 进程的运行时里还没有账本，要用时照任务进程的写法 `createLedger({ clock, events })` 建一次。G4-A：`billing.points.expired` 的去重键照 x01 第 2.3 节是按周期的，周期延长复活后再次到期会被当成已发过，做延长时改成带止日（同 PR 改 x01）；`advance` 现在只在“上一期到期”时接续预约周期，退款提前生效由 `revokeTerm` 自己做 |
| `docs/plan/tasks/README.md:167` | W2-09、W2-21、W2-22 | 调度会话的几件接到 main 时已办：`merchant/services.ts` 取 `runtime.providers.wechat` 与运行时上的 `events`，接口用例的假微信经 `createRuntime` 的 `providers` 给；`audit/auth-event.ts` 只留 W1-01a 的那一份。G2-D：AppID 的配置来源接到 `createIdentity` 的 `appid`、替掉占位值，`smsConfigured` 接短信驱动的状态；微信驱动的 `getPhoneNumber` 要把区号交出来（Provider 的接口现在只交 `phone`，`identity/phone.ts` 只能看原串里的国际前缀：区号不是 86 的号码不能不带加号地拼成一串数字交回来，`+1` 的号码去掉符号与大陆号同形）。G2-B：休眠检查的两支、订阅者 `identity.onWechatBound`、会话过期清理的登记、openid 的 HMAC 要不要专用的密钥用途 |
| `docs/plan/tasks/README.md:179` | W2-25、W2-27 | 限流额度、可信代理的跳数与网段接成部署配置；预发实测负载均衡怎么写 `X-Forwarded-For` 之后照实填网段 |
| `docs/plan/tasks/README.md:183` | W2-06、W2-07、W2-08、W2-15、W3-12、W4-17、W4-18 | 在真实浏览器（有头的 Chrome，最好再加一种）里核日期范围选择器的键盘：Tab 走得进、走得出，Esc 关浮层；走不出去走构件 PR |
| `docs/plan/tasks/README.md:184` | W2-02 | W0-28 没做的构件：胶囊单选与原因单选、单选卡、月份切换、只读值、中性款提示条、橙色强调信息块、驳回弹窗、步骤进度、三列日志行、并排比对表、变更前后；主从页的可点行选中样式。列脱敏声明 `mask` 与 `validateSearch` 已在第 54 行 |
| `docs/plan/tasks/README.md:185` | W2-03、W2-25 | 环境：本地整套环境 `pnpm stack:up` 起的 api、worker 没有三份密钥文件（`DATA_KEYS_FILE`、`BIDX_KEYS_FILE`、`AUTH_KEYS_FILE`），进程起得来但后台登录与 `staff:bootstrap` 用不了：起环境时在不入库的位置现生成一份本机用的并挂进容器，另把引导与演示种子接进起环境的步骤；演示种子现在只有 `tsx` 的入口，预发要跑就照 `apps/worker/src/cli/seed.ts` 加一个镜像内入口。W1-02 的 `admin:e2e:live` 自己现造密钥文件（做法照 `apps/worker/test/staff-bootstrap-cli.test.ts`）。G2-A：首位管理员的激活码 24 小时没用即过期，而引导命令不会再执行，要有重新生成激活码的入口（接口 `admin.staff.reissueActivationCode` 之外，给命令行留一个）；权限矩阵的黄金文件 `apps/api/golden/admin-permission-matrix.txt` 还没登记成门禁文件（登记成 `append` 时注意它的行里不能出现分类脚本认的放行关键字）。W1-04、W1-06 等同时在改 `packages/services/src/runtime.ts` 的包：`flow` 已由本包接进运行时（`runtime.flow`），合并时只留一份 |
| `docs/plan/tasks/README.md:187` | W4-05、W4-06、W4-08、W4-10 | 第二个 PR：履约的入口是 `createFulfillment({ clock, events })` 给出的 `fulfill(tx, { billingOrderId, ctx })`，返回 `{ result, replayed }`；它要求付款单已是已支付，自己不改付款单（履约状态、结果、说明、`fulfilled_at` 由入账函数按 `result` 写回）；`ACCOUNT_BUSY` 与可重试的数据库错误它原样抛出，入账函数不要接。“入账函数只接对公一个入口”的留桩、`payment.I1`、`I2`、`I4` 由第二个 PR 登记。W1-11b：api 进程的运行时里还没有账本与履约，接入账函数时照任务进程的写法各建一次。G4-A：升级、加购的履约（留桩 `m4-billing-fulfill-upgrade-topup.md`）；`billing.I12` 现在只查套餐与加购两种付款单，升级付款单与已退款付款单的两句随升级、退款补；链尾被延长过之后再续费，止日的次日不在锚定日上，现在按受阻处理（`detail.problem = term_dates`），做延长时定规则；测试夹具 `openTerm` 可以换成经 `fulfill` 造 |
| `docs/plan/tasks/README.md:188` | W2-03、W2-22 | W1-01b 员工最小集：既有 staff.I8 保留单份登记；G2-A 接 staff 其余不变量、在办来源端口、池维护与城市轮询，并去两项留桩。短信要定 staff→notify 走端口还是改白名单（真实驱动随 G2-D）。业务事务先调 `staff.pickNext(tx, pool, scopeKey)` 再锁业务行，展示摘要复用 `staff.staffBriefs(tx, ids)` |
| `docs/plan/tasks/README.md:190` | W3-01 | 冻结的 file_object noscope 上传去重索引未包含 entity_id。W1-07 对同上传人、分类、clientToken 的跨主体 pending 冲突回 VALIDATION_FAILED 并提示重新生成 clientToken；保持现有 schema，不返回其他主体凭证。结构包对照主文档核定是否将主体归属纳入索引，并保留同归属重用与跨主体反例 |
| `docs/plan/tasks/README.md:191` | W2-13、W3-17、W4-14、W4-15、W4-16 | 账户接线已由W1-05②交付：页面监听既有contextRev废弃门店维度缓存并拒绝旧响应；登录返回页非标签路由保留查询。八态H5注入只替换账户API，后续为自己的接口建同样固定离线DTO入口，不改生产中央请求层伪造证据；钱包入口随pages.ts对应页implemented自动显示。通用陈列继续冻结，两个业务组件在实际使用页看样 |
| `docs/plan/tasks/README.md:195` | W2-02、W2-06、W2-08 | 真实后台验收复用 `pnpm admin:e2e:live`：造数在 services/testing/admin-live 新增 *.fixture.ts，单进程顺序共享 make/runtime；浏览器只新增 live-*.spec.ts，由项目依赖复用 storageState。不改起栈脚本或配置，不从前端导入服务端。G2-0 接 mask/validateSearch，G2-A 补用户菜单两项与员工操作 |
| `docs/plan/tasks/README.md:197` | W2-03 | W1-16a PR1 公共 createTickets/prepareTicketAssignees、reevaluate 与按订单项工单/按订购单方案摘要可复用；开工须同 TX 先 staff20 prepare（同 TX/order 重入无计数变化，main pickNext 无游标/计数写），后 store130/order160/item170/account420，create 只重入预持父锁及 INSERT，传首 capture 返回 Tf 给 at。确认需注册 orderSidePort.applyConfirmedPlan，default INTERNAL；rederive 在新步骤写入后同 TX 调，稳态上线事实也回调且带 launchFacts，不重开事务。方案应用前父锁和选中账号190已持，不能 release210 后首次补锁账号。PR2 补样片/包写侧及相应详情聚合/I7–13/I15；G2-A 补工单三负责人在办来源端口，当前 main 未注册，承接 W1-01b M2 既有留桩 |
| `docs/plan/tasks/README.md:198` | W3-02、W3-04、W3-07 | W1-16a PR2 十接口交样片、逐集/包质检与成片包。media 公开 ensureProductionStubs/consumeFinalReleaseBatch/recordAdoptedStoreAssets；批次消费是真实 ready final_release 行与引用交接，上游批次管理 API 仍待 G3-A。M1 只桥接本上下文人工无 AI，已有 mediaInfo 才回写时长/尺寸；无时长 uploaded 的 QC 受控拒绝零写，真实探测/水印留 G3-A。W1-19 live 造数须明确已知媒体事实并标注替身。W1-16b 写访问证据，GET 与确认不制造 evidence；G5-A 替换首次登记认领；G6-A 接清单编辑、ZIP 与到期定时器 |
| `docs/plan/tasks/README.md:199` | W3-17、W4-14 | W1-09 分类上传入口：`lib/upload/taro.ts` 的 prepareTaroFile/createTaroUpload/useUploadBusy，纯编排 queue.ts 与生成 DTO 的 api.ts。pay_receipt 图片/PDF、channel_screenshot 及 licenseKind 复用；非图片/视频精确上限由登记 API 判，post 之外给小文件/代传说明；切店/退出取消、暂停可恢复，原 token/确认意图沿重试。审核 CompareTable/RejectDialog 仍私有，第二调用方先走构件 PR 提升 |
| `docs/plan/status/W1-01a.md:40` | W2-03 | \| 17 \| 03 分组 状态机“新增”两行的守卫 \| 只核对操作人是员工：权限点由路由的鉴权链判，手机号未占用由唯一索引兜底。启用、禁用三行的守卫没登记（G2-A），在那之前迁移这三行即抛错 \| `staff/README.md` 第 5 节 \| |
| `docs/plan/status/W1-01b.md:30` | W2-03、W2-22 | 见 tasks README 第 5 节“W1-01b 员工最小集”无编号行及第 52 行：G2-A 接其余 staff 不变量、在办来源与池维护，短信的同层依赖由拆包时决定；上层业务先调 pickNext 再锁业务行。 |
| `docs/plan/status/W1-02.md:30` | W2-06 | 第二段②以真实 staff/role 查询展示8列，姓名/手机号后4位、角色、状态、页码与每页条数写入URL；默认工号排序，不显示M2页头汇总或M1空actions的操作按钮。新增固定manual、不邀请企微，未开放角色只能暂不启用；失败重试复用幂等键、修改内容换键，同步锁拦同一事件循环双提交；首次激活码只留弹层内存，关闭清除，重放或空码不回放。 |
| `docs/plan/status/W1-03.md:31` | W2-10、W2-12 | \| 8 \| 02 分组 第 2.10 节：资质撤回的守卫是“主体被关闭或放弃”；回到“提交前的值” \| 主体关闭与放弃在 M2。守卫现在只认“操作人是系统”；提交前的值取自本链的状态历史（最近一次进入 `pending` 的那一行） \| `tenant/README.md` 第 5 节 \| |
| `docs/plan/status/W1-03.md:34` | W2-17 | \| 11 \| 13 分组 第 5.4 节登记 `docs.N5` \| 照任务书 第 5 节没有登记：它要查付款单、订购单、广告三张上层表，docs 在 L1 读不到，归属随 G2-C 定 \| 移交表第 54 行已有 \| |
| `docs/plan/status/W1-04.md:40` | W2-09、W2-22 | \| 13 \| m01 第 2.2 节：短信通道已配置时 `actions` 里有 `change-phone` \| 现在恒不出：装配处没给 `smsConfigured`（短信驱动随 G2-D），换绑接口也在 M2 \| `identity/README.md` 第 4 节 \| |
| `docs/plan/status/W1-04.md:41` | W2-21 | \| 14 \| D4 第 3.2 节第 2 步：区号按 `countryCode` 判 \| Provider 的 `getPhoneNumber` 只交 `phone`，没有区号。复审查出原先按去掉符号后的长相判，`+1` 的号码与大陆号同形，会登进数字相同的账号并绑上微信。改成看原串（`identity/phone.ts`）：只认不带区号或带 86 的“1 开头 11 位”，别的回 `PHONE_REGION_UNSUPPORTED`。真实驱动（G2-D）要把区号交出来 \| `identity/phone.ts`；留桩文件；移交表第 68 行 \| |
| `docs/plan/status/W1-04.md:42` | W2-18 | \| 15 \| m08 第 2.2 节：订阅冷却与一次模板上限来自共享参数 \| main 的参数登记尚无 `notify.wx.ask_cooldown_days`、`notify.wx.max_per_ask`。按任务书与调度会话确认的默认取 7、3；与引导订阅清单一起留给 G2-C，不越界改共享参数 \| 引导订阅留桩 \| |
| `docs/plan/status/W1-05.md:33` | W2-13、W2-12 | \| 10 \| 退出登录应放设置页，真实手机号凭证、协议PDF、客服页未到 \| 按任务 第10节默认5–8：我的末行先退出，表单采集替身凭证，协议正文为空显示“正文准备中”，重新核验仅说明 \| 默认已实施；真实表单与退出位置交G2-B，PDF与客服沿既有桩 \| |
| `docs/plan/status/W1-05.md:44` | W2-13、W2-17、W2-18 | 沿既有登录替身文件补登记 `PhoneForm`（G2-B）；订阅清单/上报沿既有 `m2-identity-bootstrap-subscribe.md` 合并登记（G2-C）；端上埋点新增 `m2-weapp-analytics-report.md`（G2-C）。没有订阅按钮点位，替身形态不调隐私接口。 |
| `docs/plan/status/W1-05.md:48` | W2-13、W3-17、W4-14 | 任务移交表既有第37、53行继续适用，不重复登记任务明定事项。新接收细节：后续页面监听既有contextRev废弃门店维度缓存、丢弃旧响应；登录返回页非标签路由保留查询。八态注入只替换账户API调用，后续页面为自己的接口建立同样独立固定DTO入口，不能修改生产中央请求层来伪造接口证据。钱包入口按pages.ts已实现状态自动显示。 |
| `docs/plan/status/W1-07.md:37` | W3-01 | 移交表第 39 行已办：演示六 PDF 与协议版本接线、系统海报/许可文档能力、引导上限和 SignedUrl 已交付。冻结 noscope 索引未含 entity_id 的事实已加在移交表中接收方是“未来 media 结构包”的一行。分类守卫、业务引用类型与读侧授权由原下游各自接收；公共入口和签名见 media README。 |
| `docs/plan/status/W1-08.md:28` | W2-11、W3-16 | \| 7 \| 首店 initial 与非终局重新提交为 M1，识别、变更轮次等留后续 \| 按任务默认 1–5：首页成员/素材/广告事实为 0，I7 随 M2；识别不可用不拦，联系人非登录号记 unverified；change/new_store、终局驳回、confirmReview 入口明确拒绝；a 先登记资格审批类型与动作；b 补真实门店经理 handlerOf，空经理继续门店范围回退，后台路由随 b \| profile README、八项留桩；后台聚合留桩随 b 交 \| |
| `docs/plan/status/W1-08.md:34` | W2-11 | \| 13 \| a03 全量默认按最近订单排序、跨层字段完整 \| M1 只按registeredAt（默认倒序），regionCode、isManagerUnassigned沿实际契约；其他筛选排序400。后台五来源 keyed 端口默认none/0/null，M2 G2-B回补；动作只列实际开放入口 \| a03 第2.2节、后台聚合留桩 \| |
| `docs/plan/status/W1-10.md:37` | W2-24 | \| 12 \| D1 第 8.4 节：扫描里某个主体出错“记录错误并告警” \| D7 第 9.4 节没有这条规则：经告警端口报 `billing.advance_failed`（P1，按主体），端口现在是空实现（G2-D） \| `billing/README.md` 第 3 节 \| |
| `docs/plan/status/W1-10.md:46` | W4-10 | - 退款处理中的闸门只验了读函数与操作行上的可花为 0；打开、关上它的函数在 M4。 |
| `docs/plan/status/W1-11a.md:24` | W4-02、W4-05、W4-06 | \| 1 \| 任务书 第 2 节：`fulfill(tx, billingOrderId)` \| 账本操作与事件要记操作人：签名是 `fulfill(tx, { billingOrderId, ctx })`，返回 `{ result, replayed }`（`result` 即 `FulfillResult`）。它不改付款单，履约状态由入账函数写回 \| `billing/subscription/README.md` 第 2 节；移交表中接收方为 W1-11a 第二个 PR、W1-11b 与 G4-A 的一行 \| |
| `docs/plan/status/W1-11a.md:31` | W4-05、W4-10 | \| 8 \| D1 第 9 节的 I12 一句话里含升级付款单、已退款付款单、受阻的付款单 \| 这里只登记套餐与加购两种付款单的两句：升级与退款的履约、收回在 M4；受阻有没有未决差异单归 `payment.I4`（第 2 个 PR） \| 移交表中接收方为 W1-11a 第二个 PR、W1-11b 与 G4-A 的一行 \| |
| `docs/plan/status/W1-11a.md:35` | W4-02、W4-05 | \| 12 \| D2 第 4.5 节写 `exception`、`fulfillment_exception`，程序错误整体回滚；第 6.3 节仍有旧名 \| 本段按已合并契约、03/08 与 ADR-0046 使用 `blocked`、`fulfillment_blocked`；保存点业务/完整性/自检/推进失败仅回滚履约，可重试与基础设施故障继续外抛。仅勘误 D2 第 4.5 节，不扩展 M4 旧草案 \| D2 第 4.5 节；`billing/payment/README.md` 第 2 节（调度会话已同意） \| |
| `docs/plan/status/W1-13.md:21` | W3-10 | - I2 在 M1 检测并告警（heal=none）；到期迁移与 I3 定时器恢复随 M3。 |
| `docs/plan/status/W1-14.md:24` | W2-17 | 5. 按 W0-17 实际契约登记两项真实只读通知事实供 M2 框架调用；7 个领域事件及审批事件仍由 outbox 派发。按 m05/x01 的实际归属，publish_link_submit 留给 M7 出站派生，不虚构同步通知或重复直记。调度已批准本任务书的窄范围解释。 |
| `docs/plan/status/W1-15.md:46` | W2-10、W2-17、W3-14 | 商城三事实留桩已回补；其余已登记9项：广告（M5）、参考素材（M3）、门店额度（M2）、待办（M7）、售后/授权书（M5）、履约读侧与开工处理器（W1-17）、通知取数（M2）、outbox埋点消费者（M7）。首次指派经理后的订购单同步已回补，delivery 同步一半仍归 W1-16a。 |
| `docs/plan/status/W1-16a.md:43` | W2-03、W2-17 | 已回补 profile.delivery_manager_assign、publish.launch_changed、publish.launch_handler 两份既有留桩。新增分别登记的留桩：M1 order_side；M2 通知场景；M5 广告/授权恒真、环节时限、暂停与补发 I2/I14；M6 逐集发布清单 I16。三个工单负责人在办来源按 10 分组 第 2.1、5 节准确移交 G2-A：当前 staff 无注册端口，承接 W1-01b M2 留桩，不新增跨域依赖、不伪造在办量。 |
| `docs/plan/status/W1-16a.md:53` | W3-04、W3-07 | 冻结 ck_sample_duration_ms 要求质检后正时长：保留 m05 推送版本 durationMs integer 承诺，已有可信 mediaInfo 才回写；缺时长可以 uploaded，但 QC 返回 PRODUCTION_NOT_READY 且零 QC/历史/审计/事件。没有自动探测、真实水印、AIGC 检验或探测 Provider 接线，准确移交 G3-A；W1-19 live 必须提供明确已知媒体事实，不用虚构默认时长。同步 Playable 的空元数据不输出虚构像素档位。 |
| `docs/plan/status/W1-16a.md:71` | W3-04、W3-07 | 唯一正式复审固定 c6b85af1、基线 f5ebd093，发现两条 P2。四个样片签名写响应通过本域私有回包设置 no-store；首次签名和幂等重放均保留该头，C50 重放仍返回 null，不缓存签名。声明登记以及样片、成片兼容登记读取真实所属订单项的剧目 isAiGenerated；最终 used 为客户端声明 OR 剧目事实，forcedByDrama 只来自服务端。AI 文件保持 pending，非 AI 人工 stored 文件仍可桥接；错误、拒收与真实派生不覆盖。只修可信剧目声明，不提前探测、AI 补标或 G3-A 流水线。 |
| `docs/plan/status/W1-16b.md:33` | W3-04、W3-07 | 测试上游使用真实分类登记、fakeStorage入库、质检与推包；服务夹具明确保留原 orderSide 测试实现，不声称改动订单生产推导，API用实际main真实计划端口。视频元数据是显式已知测试事实，M3探测/水印留桩原登记不变。本包无匿名/门户/整包/回报/重新生成授权入口，不新增状态迁移、出站事件、表、依赖、锁表项或共享 TTL 变更。 |
| `docs/plan/status/W1-17.md:37` | W2-03、W2-17 | - b 回补：[开工触发点](../stubs/m1-order-start.md)。[资质驳回后续](../stubs/m5-order-qualification-reject-followup.md) 的 rejected_stale 与终局整店取消留 M5；[售后与授权书](../stubs/m5-order-aftersales-licenses.md)、[通知读侧](../stubs/m2-order-notify-read.md)、[埋点消费者](../stubs/m7-order-analytics-consumer.md) 保留既有范围。M1 分配池仍按已登记 G2-A 最小候选口径，发布池空则 publisher=null。纯函数覆盖未来展示分支；取消、终止、撤销核验、归档、下架等写入口按 M5/M6 回补，不新造触发器。I3 无合法迁移的污染保留未自愈告警。 |
| `docs/plan/status/W1-19.md:29` | W3-04、W3-07 | \| 6 \| PR2 只列前端目录；制作体检在 M3，已有 main 上传只完成到 promoting \| 调度批准本域 testing 窄桥与薄 CLI：仅 APP_ENV=test、本轮 lyx_test_admin_live 库/前缀/runId，锁内核文件/分类/制作/上传人/clientToken/ETag/时间及全部父归属，调用已有 job 的真实 runtime.media.promote；本机 MinIO copy/head 到 stored 后才写已声明固定 MP4 的 1秒、160×90、17947B 已知事实。无元数据仍真实 QC 409 PRODUCTION_NOT_READY，五类业务计数零增；不直改 stored、制作状态、QC，不启 worker或改公共 harness \| 本状态、后台 README、既有 M3 留桩、PR 正文 \| |
| `docs/plan/status/W1-19.md:37` | W3-07、W4-17 | 本 PR 不新增空业务实现。付款单页签/导出/取消/操作日志/授权书与流程运维入口按任务 §5、§7 隐藏；分配候选不显示尚无 DTO 的在办量/轮询推荐。广告页签与方案广告位显示“暂无”，发布账号只在原订购账号中选择，逐个上传后一次登记；推送成片包留给 W1-20。制作体检、AI 与真正水印仍见 [M3 留桩](../stubs/m3-delivery-media-production-sync.md)，本域已知媒体造数不代表自动探测已实现。五页菜单事实及工单跳转均已交付，页面清单由菜单官方生成。 |
| `docs/plan/pages.md:103` | W4-18 | M4 在既有 approval.mine（/approvals，当前归 M2 G2-A）补财务审批；已有页增量，不另计新页。 |
| `docs/plan/pages.md:113` | W3-08 | M3 在既有 system.flow_ops（/sys/flow-ops，当前归 M2 G2-D）接 media 任务列表/重投两条；已有页增量，不另计新页。 |
| `docs/08-development-plan.md:600` | W3-18 | 计划 G3-C 明写“后台复核页”，但当前 admin 页面登记没有 M3 G3-C 页。首段拆包表应明确这是一项既有商家详情/资质复核页的增量，或另走页面归属变更；原 11 页总数不能静默添页。 |

## 7. 首段验收与下一步

一次性脚本在 `/tmp/lyx-w123-map.py`，输入是实际 routes 与独立提取 `/tmp/lyx-w123-inventory.json`，不新增仓库门禁。检查包括 set 相等、owner 单写、里程碑一致、依赖存在/DAG、乙接口上限、丙新页上限；以本文第 3–4 节逐行再解析核对，不能只证明临时 JSON。结果：M2 25/122/20/29/19；M3 19/79/11/16/15；M4 20/93/18/18/13；漏项 0、重项 0；乙最大 20、丙最大 8；包内依赖无环。

a已实际合入M2的25本九节任务书、全部64份状态与计划/README；本段b交齐M3/M4的39本，整体任务书范围完成，代码开工仍看actual依赖。调度可按 G2-0、G2-A、G2-B、G2-C、G2-D＋合流拆包分派 M2 的 25 本；各作者只写分配的编号，90–170 行九节，实际路径、机制/不变量/事件/定时器、命令与失败边界按本图及 actual source 展开。统一作者已创建全部状态并回写计划/README；环境五包仍只执行任务指定的最小核对与编号接线；M3/M4的39本由本段b交齐。W1-21 已 actual；已重读回顾和官方四计数，再交 W1-23a PR。Q8/Q10/Q13按既定默认到点采用，明确记录为默认、非业主已确认；不移动现有归属，不提前标 M1 整体完成或编造外部联调。

环境五包核对：W2-25–29保留原编号、环境泳道及镜像/Compose/CLI入口（W1-22实际入口已在原环境交付中接通），不重写已完成包。W2-27日志首段只等25/26；告警接通另等W2-24第二PR，错误上报另等W2-18。`m.clientError.create`、`admin.clientError.create`唯一归W2-18，不放在环境包。现场部署、账号与密钥仍待实际授权，不据文档核对记外部完成。

W3-06依actual a01第3.63/3.64节预拆：当前kernel/db没有公开跨两TX持有同一PG session advisory mutex的生产能力。PR1甲只新增该能力、最小工厂注入与真实并发/故障测试；PR2乙的领域恢复/彻删仅在PR1实际合入main后开工，两PR齐才整体完成。四个原上游、6接口/0页/1x01/0桩与里程碑不变，不以领域裸连接或事务级行锁代替session锁。

## 8. W1-21 actual 后的最终核对

本包重读 M1 回顾：主路径、账本/付款/开工并发、权限与固定媒体事实沿已合实际实现；不重复软件套件，也不将固定夹具冒充 M3 探测。官方当前源挂载报告 M0 3/3、M1 130/130落地；两里程碑接口/留桩/页面/x01待落地均0，M1 x01为9。全局480未来接口、77未回补桩和79未来页面保留，未来里程碑未假清零。

M1补登记三桩中，M3成片批量上传交W3-02，M4付款单视图交W4-17；M6全门店账号改选留M6、不前移。四个M1事实端口真实回补不纳入未来责任。故M2/M3/M4桩从19/15/13变19/16/14、合计47→49，仅补遗漏登记，294接口/49页/63x01和64包DAG不变。付款单桩按03§1.1/a07的独立单据边界写，旧M1任务原词只作历史出处，不伪造单据关联。

Q8/Q10/Q13已记2026-10-07默认采用日期、非业主明确答复。M0看样、M1 A/B真机与实际预发仍待外部反馈，自动化不替代整体退出。

## 9. b阶段交付

本段从实际main `3600065915f51a824e82581126ed44db0f1f00f5` 正常同步a后交M3 19本、M4 20本；39本九节齐、99–150行、共4686行。172新增API逐项唯一归属，M3/M4的29页/弹层、34x01、30桩分别进入原主责书目标/验收；消费已有API不重复计owner。G2-0两书已actual，下游等它们代码实际合入再开，不暗等完整M2退出。

实际apply仍仅银行入账，所以W4-01必须伴随最小微信成功事实/唯一apply适配，W4-02复用后扩回调，W4-03仍独占甲并发机制；不增加01→02反向依赖、不搬HTTP/x01归属。Provider本地重解密/退款查询/发货等缺失能力各归02/10/09窄扩口，旧fake/unconfigured兼容。持久告警消费W2-24实际能力，当前noop触发不称持久告警完成。M3恢复/彻删跨TX session mutex仍先甲机制后乙业务、两PR齐才完成。

本段只交文档和既定边界，未把真实云、资金、OCR/AI、税务或真机验证写成完成，未改变冻结契约、页/事件目录、锁序、层白名单、规则或整体里程碑退出条件。
