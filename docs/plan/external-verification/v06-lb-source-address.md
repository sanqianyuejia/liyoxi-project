# V6 负载均衡的来源地址

| 项 | 内容 |
| --- | --- |
| 编号 | V6 |
| 来源 | [计划](../../08-development-plan.md) 第 8.6 节表一；[05](../../05-risks-and-open-issues.md) 第 5 节 V6；[D7](../../appendix/design/d7-platform.md) 第 10.6 节第 15 项 |
| 验证什么 | 负载均衡的转发源地址与 `X-Forwarded-For` 行为 |
| 通过标准 | 能取到真实客户端 IP |
| 依赖的业主事项 | E4（负载均衡；预发先不启用，引入时再开） |
| 谁来做 | 引入负载均衡的包（默认 G2-E，待业主定）；预发的宿主机 nginx 一跳由 G2-D 验 |
| 最晚关闭点 | 引入负载均衡时（业主的原话是功能开发基本完成后引入并测试；默认随 G2-E）。预发启用时先验宿主机 nginx 一跳能取到真实客户端 IP，预发最晚 M6 的闭环演示前到位 |
| 不通过的退路 | 调可信代理跳数 |
| 状态 | 进行中 |
| 结论 |  |
| 证据 |  |
| 关闭日期 |  |

备注：预发先不启用负载均衡，由宿主机 nginx 终止 TLS 后转到 gateway（业主提议、会话同意，[ADR-041](../../adr/0041-预发先行-单机预发-共用AppID.md)）。负载均衡挂在哪个包引入待业主定。

预发的宿主机 nginx 一跳：脚本已交付，待业主执行（W2-25 的第一步）。宿主机 nginx 的站点模板覆盖写 `X-Forwarded-For`，gateway 只信固定网段的网桥地址（`infra/compose/env/stg.env` 的 `LYX_TRUSTED_PROXY_CIDRS`）。本机演练（`pnpm stg:rehearse`）里从宿主机进 gateway 的来源就是网桥地址，访问日志记下的是转发头里的客户端地址。在节点上的验法：`infra/bootstrap/README.md` 第 7 节第 5 项（用访问日志；`admin.debug.clientIp.get` 归 M7，落地后再复核一次），实测值回填平台配置核对表 第 2.5 节。负载均衡的那一部分不变。

业主事项的状态见 [业主清单](../owner-checklist.md)。填写规则见 [README](README.md)。
