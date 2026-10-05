# 协议版本的 PDF 读地址

| 项 | 内容 |
| --- | --- |
| 状态 | 留桩中 |
| 留桩内容 | 协议版本正文接口返回的 PDF 签名读地址是占位值，端上只能看展示版 HTML，下载不了 PDF |
| 骨架里的做法 | `packages/services/src/docs/read.ts` 的 `getAgreementVersion` 里 `pdf.url` 恒为空串、`expiresAt` 取现在加 30 分钟。签名地址要经 media 现签，docs → media 不在同层白名单里（06 第 3.6 节），走端口还是单独的 gate-change 随 G2-B 定 |
| 登记的工作包 | W1-03 |
| 回补里程碑 | M2，G2-B |
| 回补的工作包 | 待 W1-23 拆包后填 |
| 依据 | 计划 第 7.3 节留桩清单“协议版本的 PDF 读地址”一行；m01 第 2.9、3.13 节；任务书 W1-03 第 7 节 |
