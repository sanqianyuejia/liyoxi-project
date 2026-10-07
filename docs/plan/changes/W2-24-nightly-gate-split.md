# W2-24 nightly门禁独立后继

2026-10-08，本会话调度按CLAUDE第7节裁决，仍为同一W2-24工作包，不增加里程碑包数或提前关闭验收。

普通同步actual main后，原分类器报告3项放松：nightly注释修改，以及既有workflow测试的命令提取/任务清单修改。测试本意是保留Node26全部命令并追加P95，但原规则要求这类修改独立成纯gate-change，不能给混合功能PR套标签。原RED结果保留。

PR2恢复actual main的nightly.yml与workflows.test.ts；新增p95.test.ts保留默认20/10/42/500ms、有界完整请求和失败不得过门的两项用例。完整nightly接线用例迁至后继的p95-nightly.test.ts，原断言全部保留。

后继分支codex/w2-24-nightly-gates只含三个门禁路径：nightly.yml、workflows.test.ts、p95-nightly.test.ts。命令提取只查原node26作业，仍逐项对照全部原命令；任务清单增加独立p95且两者都不在required。P95仍实际完整规模、失败不吞、always上传报告且缺报告报错。

后继只能在PR2代码实际main后发布/运行，否则P95命令前置尚不存在。它仍需独立审查、CI绿色与main同步；GitHub suspended时仅本地准备，当前既有nightly不变。

本包完成必须同时满足两代码PR、门禁后继actual与所有核心验收；订单创建500ms与默认全规模要求仍保留。
