# 狸有戏（liyoxi）

面向本地生活商家的短剧营销工具：平台把自有版权短剧按门店定制成片并植入商家广告，商家在自己的抖音号、视频号上线，为门店引流。

V1.0 交付商家端微信小程序、运营管理后台与商家电脑端下载页。

## 当前状态

技术架构、设计规范、数据模型与接口契约已完成，开发计划已确认并执行。按 2026-10-07 核对的 main（`36000659`，PR #124），M0 的 37 个工作包及 W0-30a 已全部合入，M1 已完成商家与后台骨架、20 集短剧订购到交付上线的自动化合流。官方计数确认 M0 3 个、M1 130 个接口全部落地，两里程碑的接口、留桩、页面与后台任务待落地数均为零。[M1 最终 CI](https://github.com/byfire-dev/liyoxi-project/actions/runs/37622067946)与 Node 26、镜像和全栈检查均通过；[实际主分支十轮验证](https://github.com/byfire-dev/liyoxi-project/actions/runs/37624700220)10/10 成功、零失败和跳过、无重试。M0 业主看样和 M1 演示点 A/B 真机反馈仍未闭环，自动化结果不代替整体退出；见 [M0 退出条件](docs/plan/m0-exit.md)和 [M1 回顾](docs/plan/retro/m1.md)。

截至 2026-10-08 的实际 main（`3a4eee73`，PR #136），M2 已合入回调框架 W2-01、后台通用构件 W2-02、角色/自助安全/审计与 PII 写侧 W2-04、系统配置与审批 SLA 写侧 W2-05，以及审计日志页面 W2-08。W2-10 的门户授权撤销前置和 W2-24 的告警事务隔离前置已合入，各自主包仍进行中；W2-12 的正文技术能力预拆计划已合入，实际转换能力和八接口主包仍待实施。系统配置四页 W2-07 的 [PR #137](https://github.com/byfire-dev/liyoxi-project/pull/137) 尚未合并，不能计入实际 main 完成数。

M2/M3/M4 的 25/19/20 本任务书均已合入，按实际已合依赖并行开发。任务书与代码依赖必须 actual main 后才可开工，不需要暗等整个 M2 退出。具体编号、边界和责任见 [分配表](docs/plan/changes/W1-23-m2-m4-package-map.md)，单包进度以 [状态台账](docs/plan/status/README.md)为准；`pnpm status:summary` 可现生成汇总。

环境先只建一套预发，生产在预发初步稳定后再建（[ADR-041](docs/adr/0041-预发先行-单机预发-共用AppID.md)）。main 已提供 W1-22 本地全栈演练、W2-25 节点初始化与四镜像/四桶校验，以及 W2-26 的持续探测、发布回滚与私有上传消费者；工作流接线按独立门禁 PR 收口，外部开关默认关闭。服务器实际部署、真实 SSH/云账号与微信上传仍未有完成记录。实际合并进度以 [docs/plan/status/](docs/plan/status/README.md) 和合并记录为准，可用 `pnpm status:summary` 现生成汇总；近期业主待办见 [业主清单](docs/plan/owner-checklist.md)第 4.3 节。

业主将仓库设为 public 后，GitHub Actions 已恢复运行，原 #63 的账单/额度阻断已解除。2026-10-08 合并 PR #136 后，本会话又实际收到 GitHub 认证 REST/GraphQL 的 `403: Your account was suspended`，匿名仓库/PR 查询为 404；当前推送、CI 状态查询和合并受账号状态阻断，已请业主检查 GitHub 账号并在恢复后通知。开发在本地继续，恢复后须重新核对最终源码与 actual main 的 CI；此前通过不能冒充新提交通过。继续执行独立复审、完整 CI 和同步 main 后合并的既有规约；部署、服务器操作与真实平台联调仍按业主授权另行推进。

## 设计

界面依据都在仓库里，开发不依赖 Figma。

| 内容 | 说明 |
| --- | --- |
| [design/design-spec.md](design/design-spec.md) | 设计规范：颜色、字号、组件规格、状态取色、文案规则 |
| [design/tokens.json](design/tokens.json) | 样式变量 |
| [design/prototype/](design/prototype/README.md) | 原型快照：商家端 47 个画板、后台 56 个画板的源码与截图 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 文档索引与阅读顺序 |
| [docs/01-architecture.md](docs/01-architecture.md) | 技术架构 |
| [docs/02-tech-selection.md](docs/02-tech-selection.md) | 技术选型 |
| [docs/03-key-designs.md](docs/03-key-designs.md) | 关键技术方案 |
| [docs/04-adr.md](docs/04-adr.md) | 架构决策记录 |
| [docs/05-risks-and-open-issues.md](docs/05-risks-and-open-issues.md) | 风险、待确认事项与上线前验证清单 |
| [docs/06-data-model.md](docs/06-data-model.md) | 数据模型（字段级定义在 docs/data-model/） |
| [docs/07-api-contract.md](docs/07-api-contract.md) | 接口契约（字段级定义在 docs/api/） |
| [docs/08-development-plan.md](docs/08-development-plan.md) | 开发计划（已确认，执行中；进度见 docs/plan/） |
| [docs/plan/](docs/plan/README.md) | 开发计划的执行台账：任务书、工作包状态、留桩、计划变更、外部验证、业主清单、三份运维文档 |
| [CLAUDE.md](CLAUDE.md) | 会话开工须知：每个开发会话开工前必读的总纲与出处 |
| [docs/appendix/](docs/appendix/README.md) | 子系统设计草案、外部事实核实记录、调研记录 |

建议先读 [docs/05-risks-and-open-issues.md](docs/05-risks-and-open-issues.md) 的第 0、1 节。

## 校验工具

| 工具 | 说明 |
| --- | --- |
| [tools/schema-check](tools/schema-check/README.md) | 在临时 PostgreSQL 库里建表、执行手写约束，并逐列比对数据模型文档与库结构 |
| [tools/api-check](tools/api-check/README.md) | 核对接口文档、路线图与结构化清单是否一致，生成接口索引、错误码与权限点登记表 |
