# 协议管理（W2-16）

唯一登记页 `/ops/agreements`。页面消费 W2-12 的八条 typed HTTP，不改协议、公告、同意记录或系统任务。六协议键为 `user/privacy/member/points/custom_license/ad_service`；未来 partner 不展示。phase/actions、公告期、撤回资格与重同意进度均使用服务端事实。

## 行为与权限

ops≥v 可查看，ops≥e 可编辑。主版本与短公告理由分别按实际 `sys.super_admin`、`agreement.short_notice` 权限点控制，服务端仍作最终校验。草稿初始法务确认始终关闭；E8 真实正文与法律审核待外部交付，虚构文件的本地操作不能证明法律审定。Word/PDF 走原 `legal_doc` uploader，只有真实文件 GET 为 stored 后才交版本 ID。默认双文件规则不由页面放宽。

编辑同一意图复用幂等键，实际保存返回的 ID/lockVersion 供后续安排；安排失败不重新创建草稿。改字段才换键，冲突保留输入并要求刷新核对，中央 step-up 重放保持原意图。清空四个可空字段发送 null；withdraw 只按实际 `newDraft` 新 ID/null 导航，原 withdrawn ID 不再作为草稿写。

主从切换、权限身份更换和卸载丢弃旧响应、旧错误与旧 finally；同意列表范围与页码全部进 URL。16 查询字段按正式 schema 处理，默认近30天、单侧补界由服务端负责。签署证据直接呈现脱敏事实，设备/UA 另作有界显示；无明文 reveal 请求。下载每次现签，不把 URL 写入 localStorage 或埋点。正文 iframe 使用空 sandbox、禁止脚本/网络的 CSP 与 no-referrer。

## 验收入口

- 私有模型与编辑：`pnpm --filter @liyoxi/admin exec vitest run src/features/ops/agreements/model.test.ts src/features/ops/agreements/editor.test.tsx --maxWorkers=1 --no-file-parallelism`。
- 原后台全 unit：`pnpm --filter @liyoxi/admin test -- --maxWorkers=1 --no-file-parallelism`。
- 原全样例：`pnpm admin:e2e`；本页文件 `test/e2e/agreements-m2.spec.ts` 明确拦截虚构 API，只证明页面与键盘/状态/脱敏。
- 日期有头：`pnpm --filter @liyoxi/admin build:e2e && LYX_E2E_CHANNEL=chrome pnpm --filter @liyoxi/admin exec playwright test agreements-m2.spec.ts --project=samples --headed`。
- 原全真实服务：`pnpm admin:e2e:live`。`live-agreements-m2.spec.ts` 经真实八接口、文件登记/完整上传/promote、实际 API 构建产物 document-converter.js、安排/撤回与签署读侧。`x-agreements-m2.fixture.ts` 在已有版本输入后只造虚构签署输入，以正式 reconsent 场景隔离分页；最终上传文件与转换不直接改库。不拦截业务 API，不以样例回包证明服务通过。
- 真实权限后置注册在原 staff 用例末尾；临时修改 publisher 的 ops=v/e，finally 用当前 lockVersion 恢复完整原 moduleLevels/actions/dataScope。短公告沿正式仅超管权限：编辑员工先真实被拒，随后由实际管理员核当前草稿并填原因；不向普通角色造授权。只读/无ops/编辑员工通过真实 staff/auth 创建，沿既有可信回环代理为各自有身份分配隔离的虚构客户端来源，保留原认证限流。当前新增场景只验证 fresh auth/me 与短公告分权；过期再验证由原服务/HTTP边界与本页同键恢复分别证明，不冒称浏览器过期弹层已过。

样例与 live 截图为 `dist/e2e-shots/agreements-*.png`，1440×900；另核1366×768无整页横滚，版本表仅私有内部横滚。实际运行结果以状态文件和本轮日志为准，源码中的场景不等于已经执行。所有重验证按全局单窗口运行；无需真实云、真机或正式法律文件。

最终live覆盖来自原bare自动发现47项的联合候选：旧32+本包5项全部通过，未合W3-12的10项中3项失败，整体exit1；各组身份、共享三个组合路径及源码SHA分别记录，不能写成47全绿或作者HEAD独立跑过47。正文预览测试只用raw Frame读取真实渲染文本、矩形和样式，另核空sandbox/CSP/srcdoc绑定与console零错；未放开脚本或过滤console。确认框等待真实入场类消失，角色finally经GET→PUT→GET核完整恢复。原失败轮次、离线观测对照和清场证明保留，最终本包尾门禁单独通过。
