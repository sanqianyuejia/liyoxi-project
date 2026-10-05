# 后台：登录、员工、权限与系统

| 项 | 内容 |
| --- | --- |
| 范围 | 后台登录与本人（登录两步、激活、设置密码、绑定动态口令、再验证、当前员工、修改密码、绑定企业微信、退出）；员工、分组、分配池、会话；角色权限；审批单的跨类型只读视图（各队列页的计数、我的待审批）；操作日志与明文查看；数据字典、系统参数、工作日历、特性开关、清单模板；后台上传与文件签发、文件清除放行、媒体任务；系统健康（告警、不变量）；流程运维（定时器、死信、回调收件箱）；前端错误上报与部署核对。画板：A:SysStaff、A:SysRoles、A:SysDict、A:SysParams、A:SysLogs；跨页共用：A:Main，各队列页 A:Review、A:Accounts、A:Verify、A:Refunds、A:CreditAdjust、A:Receipts，A:MerchantDetail，以及各上传与文件预览处（A:DramaEdit、A:AdTasks、A:TicketDetail、A:Offline、A:Patrol、A:Invoices、A:OpsHome、A:OpsAgreements、A:ServiceDetail、A:Delivery、A:OrderDetail、A:Tickets、A:Service、A:Merchants、A:Dramas、A:OpsMall）。原型没画的：登录页、首次激活与绑定动态口令、用户菜单（修改密码、动态口令设置、退出登录）、我的待审批、开关管理、系统健康、流程运维、文件清除放行、清单模板管理（设计规范第 12 节；`05-risks-and-open-issues.md:271`） |
| 接口数 | 89（V1.0 89，V1.1 0）。第二轮按 A43、A57、A60、A23 把初稿 3.86 的建议接口收进路线图切片：退出登录改为 3.11 `admin.session.current.delete`，新增 3.86–3.89 |
| 状态 | 第三轮修订（2026-10-03） |
| 依据 | 数据模型 03 分组（`staff_role`、`staff_group`、`staff`、`staff_activation`、`staff_session`、`assignment_pool_member`、`assignment_cursor`、`assignment_history`、`audit_log`、`auth_event`、`approval_request`）、01 分组（`timer`、`outbox_event`、`outbox_delivery`、`status_transition`、`work_calendar_day`）、14 分组（`dict_type`、`dict_item`、`param_value`、`feature_flag`、`checklist_template`）、15 分组（`webhook_event`、`alert_event`、`invariant_run`、`invariant_violation`）、06 分组（`file_object`、`file_ref`、`file_purge_run`、`media_job`、`production_record`、`media_check`、`playable_asset`）；草案 d4-identity 第 6、7、9 节与附录 A–C，d7-platform 第 4.13、5.2、5.4、5.5、5.8、9.3、9.4 节，d6-notify-docs-data 第 4.1、4.2、4.4、4.5 节，d3-flow 第 17.6、22、24、25.7 节与附录 B，d5-media 第 5.3、7 节与接口表，d1-ledger 接口表；原型梳理 proto-admin-e 第 1.6–1.10 节、proto-admin-d 第 3 节；设计规范第 11、12 节；接口裁决 A1–A146（第二轮按第十节 A76–A120、第三轮按第十二节 A127–A146 修订）、约定 C1–C87；事件目录 x01-events-jobs |

## 1. 概览

后台员工用手机号 + 密码 + 动态口令（TOTP）登录，会话是 `__Host-lyx_admin` Cookie，非 GET 带 `X-LYX-Admin: 1` 并校验 `Origin`（C4）。员工没有自助注册：超级管理员新增员工后系统生成一次性激活码，员工凭激活码设置密码、绑定动态口令后进入后台；重置密码、重置第二因子、重新启用都回到这条激活路径（d4-identity.md:1038-1063）。登录本身算一次第二因子验证，此后 10 分钟内的敏感操作不再要求动态口令；超出窗口时由权限点注册表标了再验证的接口返回 `STEP_UP_REQUIRED`，前端弹再验证框后用原幂等键重放（C66）。

权限 = 13 个模块的等级（`n` / `v` / `o` / `e`）× 敏感操作权限点（可带“仅主管”）× 数据范围（本人 / 本组 / 全部）。`GET /admin/auth/me` 给前端菜单、路由守卫与按钮显隐用；接口每次请求都在服务端重新判定（C4、C58）。查看类不设权限点，用模块等级表达；本文的系统类页面（员工、角色、字典、参数、日志、开关、系统健康、流程运维、文件清除放行）都归“系统”模块 `system`（A45）。数据范围按资源在鉴权模块里各登记一个谓词（d4-identity.md 第 7.3 节），全仓只此一处；本文的 `dataScope`（2.3）是谓词的输入。客服工单的谓词按 A92：本人负责的门店（`byStore`），或 `service_ticket.owner_staff_id` 属于本人或本组成员（a08 的请求）。

审批的决定与撤回都在各领域资源上（A14），本文只提供审批单的跨类型只读列表、计数与详情，供各队列页计数与“我的待审批”页（A16）使用。

本文接口 `x-auth` 为 `staff`；登录前的六条为 `public`，前端错误上报为 `optional`（C2）。后台不区分店员视图（`clerkView` 不适用）。

| 节 | operationId | 方法 路径 | 用途 | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| 3.1 | `admin.auth.login` | `POST /admin/auth/login` | 登录第一步（手机号 + 密码） | public | none |
| 3.2 | `admin.auth.verifyMfa` | `POST /admin/auth/verify-mfa` | 登录第二步（动态口令或恢复码） | public（持 mfa 票据） | none |
| 3.3 | `admin.auth.activate` | `POST /admin/auth/activate` | 凭激活码换设置密码票据 | public | none |
| 3.4 | `admin.auth.setPassword` | `POST /admin/auth/set-password` | 设置登录密码 | public（持 set_password 票据） | none |
| 3.5 | `admin.auth.enrollTotp` | `POST /admin/auth/enroll-totp` | 生成动态口令密钥 | public（持 enroll_totp 票据） | none |
| 3.6 | `admin.auth.confirmTotp` | `POST /admin/auth/confirm-totp` | 确认绑定动态口令并建会话 | public（持 enroll_totp 票据） | none |
| 3.7 | `admin.auth.stepUp` | `POST /admin/auth/step-up` | 再验证 | staff（本人） | none |
| 3.8 | `admin.auth.me.get` | `GET /admin/auth/me` | 当前员工 | staff（本人） | none |
| 3.9 | `admin.auth.changePassword` | `POST /admin/auth/change-password` | 修改本人密码 | staff（本人） | required |
| 3.10 | `admin.auth.bindWecom` | `POST /admin/auth/bind-wecom` | 本人绑定企业微信（手填账号或扫码） | staff（本人） | required |
| 3.11 | `admin.session.current.delete` | `DELETE /admin/sessions/current` | 退出登录 | staff（本人） | none |
| 3.12 | `admin.staff.list` | `GET /admin/staff` | 员工列表与选人下拉 | staff；system ≥ v，或分配类权限点（选人） | none |
| 3.13 | `admin.staff.get` | `GET /admin/staff/{staffId}` | 员工详情 | staff；system ≥ v | none |
| 3.14 | `admin.staff.create` | `POST /admin/staff` | 新增员工 | staff；`sys.staff.manage` | required |
| 3.15 | `admin.staff.update` | `PATCH /admin/staff/{staffId}` | 编辑员工 | staff；`sys.staff.manage` | required |
| 3.16 | `admin.staff.enable` | `POST /admin/staff/{staffId}/enable` | 启用员工 | staff；`sys.staff.manage` | required |
| 3.17 | `admin.staff.disable` | `POST /admin/staff/{staffId}/disable` | 禁用员工 | staff；`sys.staff.secure_ops`（A46，要再验证） | required |
| 3.18 | `admin.staff.openWork.get` | `GET /admin/staff/{staffId}/open-work` | 名下在办事项 | staff；`sys.staff.manage` | none |
| 3.19 | `admin.staff.handover` | `POST /admin/staff/{staffId}/handover` | 只移交不禁用 | staff；`sys.staff.manage` | required |
| 3.20 | `admin.staff.resetPassword` | `POST /admin/staff/{staffId}/reset-password` | 重置登录密码 | staff；`sys.staff.secure_ops`（A46，要再验证） | required |
| 3.21 | `admin.staff.resetMfa` | `POST /admin/staff/{staffId}/reset-mfa` | 重置第二因子 | staff；`sys.staff.secure_ops`（A46，要再验证） | required |
| 3.22 | `admin.staff.reissueActivationCode` | `POST /admin/staff/{staffId}/reissue-activation-code` | 重新生成激活码 | staff；`sys.staff.manage` | required |
| 3.23 | `admin.staff.unlock` | `POST /admin/staff/{staffId}/unlock` | 解除登录锁定 | staff；`sys.staff.manage` | required |
| 3.24 | `admin.staff.inviteWecom` | `POST /admin/staff/{staffId}/invite-wecom` | 邀请绑定企业微信 | staff；`sys.staff.wecom_bind` | required |
| 3.25 | `admin.staff.bindWecom` | `POST /admin/staff/{staffId}/bind-wecom` | 手工录入企业微信 userid | staff；`sys.staff.wecom_bind` | required |
| 3.26 | `admin.staff.poolMembership.replace` | `PUT /admin/staff/{staffId}/pool-memberships` | 设置员工所在的分配池 | staff；`sys.staff.manage` | required |
| 3.27 | `admin.staff.duty.update` | `PATCH /admin/staff/{staffId}/duty` | 切换客服当班 | staff；本人或持 `service.ticket.assign` 的主管 | required |
| 3.28 | `admin.assignmentPoolMember.list` | `GET /admin/assignment-pool-members` | 分配池成员与游标 | staff；system ≥ v，或该池的分配类权限点 | none |
| 3.29 | `admin.staffGroup.list` | `GET /admin/staff-groups` | 员工分组 | staff；system ≥ v | none |
| 3.30 | `admin.staffSession.list` | `GET /admin/staff-sessions` | 在线会话 | staff；`sys.session.revoke` | none |
| 3.31 | `admin.staffSession.revoke` | `POST /admin/staff-sessions/{staffSessionId}/revoke` | 强制下线 | staff；`sys.session.revoke` | required |
| 3.32 | `admin.role.list` | `GET /admin/roles` | 角色列表 | staff；system ≥ v | none |
| 3.33 | `admin.role.get` | `GET /admin/roles/{roleKey}` | 角色详情 | staff；system ≥ v | none |
| 3.34 | `admin.role.defaults.get` | `GET /admin/roles/{roleKey}/defaults` | 角色的代码默认配置 | staff；system ≥ v | none |
| 3.35 | `admin.role.replace` | `PUT /admin/roles/{roleKey}` | 保存角色权限 | staff；`sys.role.edit` | required |
| 3.36 | `admin.approval.list` | `GET /admin/approvals` | 审批单列表（含我的待审批） | staff；按 kind 的查看等级与数据范围 | none |
| 3.37 | `admin.approval.summary` | `GET /admin/approvals/summary` | 审批计数 | staff；同上 | none |
| 3.38 | `admin.approval.get` | `GET /admin/approvals/{approvalId}` | 审批单详情 | staff；同上 | none |
| 3.39 | `admin.auditLog.list` | `GET /admin/audit-logs` | 操作日志列表 | staff；system ≥ v（`access` 流仅超级管理员） | none |
| 3.40 | `admin.auditLog.get` | `GET /admin/audit-logs/{auditLogId}` | 操作日志详情 | staff；同上 | none |
| 3.41 | `admin.piiReveal.create` | `POST /admin/pii-reveals` | 查看字段明文 | staff；按字段的权限点与数据范围 | none |
| 3.42 | `admin.dictType.list` | `GET /admin/dict-types` | 字典类型 | staff；system ≥ v | none |
| 3.43 | `admin.dictItem.list` | `GET /admin/dict-items` | 字典项 | staff；已登录；带引用计数需 system ≥ v | none |
| 3.44 | `admin.dictItem.create` | `POST /admin/dict-items` | 新增字典项 | staff；`sys.dict.edit` | required |
| 3.45 | `admin.dictItem.update` | `PATCH /admin/dict-items/{dictItemId}` | 修改字典项 | staff；`sys.dict.edit` | required |
| 3.46 | `admin.paramValue.list` | `GET /admin/param-values` | 系统参数 | staff；system ≥ v | none |
| 3.47 | `admin.paramValue.replace` | `PUT /admin/param-values` | 整批保存参数 | staff；`sys.param.edit` | required |
| 3.48 | `admin.paramValue.withdraw` | `POST /admin/param-values/{paramValueId}/withdraw` | 撤销预约参数值 | staff；`sys.param.edit` | required |
| 3.49 | `admin.calendarDay.list` | `GET /admin/calendar-days` | 工作日历 | staff；system ≥ v | none |
| 3.50 | `admin.calendarDay.batchImport` | `POST /admin/calendar-days/import` | 导入年度放假安排 | staff；`sys.param.edit` | required |
| 3.51 | `admin.featureFlag.list` | `GET /admin/feature-flags` | 特性开关 | staff；`sys.super_admin`（A45） | none |
| 3.52 | `admin.featureFlag.update` | `PATCH /admin/feature-flags/{flagKey}` | 修改开关 | staff；`sys.super_admin`（A45） | required |
| 3.53 | `admin.checklistTemplate.list` | `GET /admin/checklist-templates` | 清单模板 | staff；已登录读启用版本；草稿与历史需 `flow.checklist.manage` | none |
| 3.54 | `admin.checklistTemplate.create` | `POST /admin/checklist-templates` | 新建清单模板版本 | staff；`flow.checklist.manage` | required |
| 3.55 | `admin.checklistTemplate.activate` | `POST /admin/checklist-templates/{checklistTemplateId}/activate` | 启用清单模板版本 | staff；`flow.checklist.manage` | required |
| 3.56 | `admin.checklistTemplate.discard` | `POST /admin/checklist-templates/{checklistTemplateId}/discard` | 放弃清单模板草稿 | staff；`flow.checklist.manage` | required |
| 3.57 | `admin.file.create` | `POST /admin/files` | 上传登记 | staff；按文件分类判权 | natural（`uq_file_object_client_token_store`、`uq_file_object_client_token_noscope`） |
| 3.58 | `admin.file.refreshCredentials` | `POST /admin/files/{fileId}/refresh-credentials` | 续签直传凭证 | staff；上传人本人 | none |
| 3.59 | `admin.file.complete` | `POST /admin/files/{fileId}/complete` | 上传确认 | staff；上传人本人 | required |
| 3.60 | `admin.file.get` | `GET /admin/files/{fileId}` | 文件状态 | staff；上传人或对该分类有读权的员工 | none |
| 3.61 | `admin.file.downloadUrls` | `POST /admin/files/{fileId}/download-urls` | 签发文件读地址 | staff；按文件分类判权 | none |
| 3.62 | `admin.file.list` | `GET /admin/files` | 文件查询（已清除文件） | staff；system ≥ v | none |
| 3.63 | `admin.file.restore` | `POST /admin/files/{fileId}/restore` | 恢复已清除文件 | staff；`files.restore` | required |
| 3.64 | `admin.file.erase` | `POST /admin/files/{fileId}/erase` | 彻底删除文件 | staff；`files.erase`（要再验证） | required |
| 3.65 | `admin.purgeRun.list` | `GET /admin/purge-runs` | 清除运行 | staff；system ≥ v | none |
| 3.66 | `admin.purgeRun.approve` | `POST /admin/purge-runs/{purgeRunId}/approve` | 放行清除运行 | staff；`files.purge.approve` | required |
| 3.67 | `admin.purgeRun.reject` | `POST /admin/purge-runs/{purgeRunId}/reject` | 驳回清除运行 | staff；`files.purge.approve` | required |
| 3.68 | `admin.mediaJob.list` | `GET /admin/media-jobs` | 媒体任务 | staff；system ≥ v | none |
| 3.69 | `admin.mediaJob.retry` | `POST /admin/media-jobs/{mediaJobId}/retry` | 媒体任务人工重试 | staff；`media.job.retry` | required |
| 3.70 | `admin.alert.list` | `GET /admin/alerts` | 告警 | staff；system ≥ v 或财务主管（只读） | none |
| 3.71 | `admin.alert.acknowledge` | `POST /admin/alerts/{alertId}/acknowledge` | 认领告警 | staff；`sys.health.manage` | required |
| 3.72 | `admin.alert.resolve` | `POST /admin/alerts/{alertId}/resolve` | 人工关闭告警 | staff；`sys.health.manage` | required |
| 3.73 | `admin.invariantRun.list` | `GET /admin/invariant-runs` | 不变量校验运行记录 | staff；system ≥ v | none |
| 3.74 | `admin.invariantRun.create` | `POST /admin/invariant-runs` | 手动触发不变量校验 | staff；`flow.ops.manage`（计费范围另需 `billing.invariant.resolve`） | required |
| 3.75 | `admin.invariantViolation.list` | `GET /admin/invariant-violations` | 不变量违规 | staff；system ≥ v、`flow.ops.view` 或财务主管（只读） | none |
| 3.76 | `admin.invariantViolation.resolve` | `POST /admin/invariant-violations/{invariantViolationId}/resolve` | 填写违规处理结论 | staff；按级别与检查项判权 | required |
| 3.77 | `admin.timer.list` | `GET /admin/timers` | 定时器 | staff；system ≥ v 或 `flow.ops.view` | none |
| 3.78 | `admin.timer.reschedule` | `POST /admin/timers/{timerId}/reschedule` | 定时器重新排期 | staff；`flow.ops.manage` | required |
| 3.79 | `admin.timer.cancel` | `POST /admin/timers/{timerId}/cancel` | 定时器标记为不再需要 | staff；`flow.ops.manage` | required |
| 3.80 | `admin.outboxDelivery.list` | `GET /admin/outbox-deliveries` | 出站投递（死信） | staff；system ≥ v 或 `flow.ops.view` | none |
| 3.81 | `admin.outboxEvent.retry` | `POST /admin/outbox-events/{outboxEventId}/retry` | 死信重投 | staff；`flow.ops.manage` | required |
| 3.82 | `admin.webhookEvent.list` | `GET /admin/webhook-events` | 回调收件箱 | staff；system ≥ v 或 `flow.ops.view` | none |
| 3.83 | `admin.webhookEvent.retry` | `POST /admin/webhook-events/{webhookEventId}/retry` | 死信回调重置 | staff；`flow.ops.manage` | required |
| 3.84 | `admin.clientError.create` | `POST /admin/client-errors` | 前端错误上报 | optional | none |
| 3.85 | `admin.debug.clientIp.get` | `GET /admin/debug/client-ip` | 回显客户端 IP | staff；`sys.super_admin`（A45） | none |
| 3.86 | `admin.auth.me.enrollTotp` | `POST /admin/auth/me/enroll-totp` | 本人重新绑定动态口令：生成新密钥 | staff（本人）；`self.mfa.reset` | none |
| 3.87 | `admin.auth.me.confirmTotp` | `POST /admin/auth/me/confirm-totp` | 本人重新绑定动态口令：确认并换发恢复码 | staff（本人）；`self.mfa.reset` | required |
| 3.88 | `admin.staff.summary` | `GET /admin/staff/summary` | 员工计数（页头） | staff；system ≥ v | none |
| 3.89 | `admin.file.cancel` | `POST /admin/files/{fileId}/cancel` | 取消未确认的上传登记 | staff；上传人本人 | required |

路由注册顺序（A8）：`/admin/auth/*` 全是字面段（含 `/admin/auth/me/enroll-totp`、`/admin/auth/me/confirm-totp`）；`/admin/auth/me` 先于将来可能出现的 `/admin/auth/{…}` 参数段；`/admin/sessions/current` 是视图别名（A41）；`/admin/staff/summary` 先于 `/admin/staff/{staffId}`；`/admin/approvals/summary` 先于 `/admin/approvals/{approvalId}`；`/admin/calendar-days/import` 是集合动作；`/admin/debug/client-ip` 是字面段。

### 1.1 本文引用的权限点

接口文档引用的权限点必须在注册表里（A13）；注册表没有的列为“增补”，由汇总人并入 07 主文档附录（A45；权限点以 07 主文档的注册表为准，d4 附录的旧表不再回改，A129）。本文提出的增补键及默认授予、是否再验证、是否要求二次确认回显（C54）同时写进清单的 `permissionSupplements`（A140）。再验证一栏以注册表为准；再验证按键标记，同一个键用在几条接口上就几条都要求（A13）。本表只列本文用到的键；增补表的全集（含其他文档提出的 `delivery.export`、`service.export`、`drama.export`、`billing.export`、`channel.export`、`report.month_close.reissue`、`flow.admin.transition` 等）由汇总人维护，A:SysRoles 的敏感操作清单按注册表全集渲染（2.9）。

| 权限点 | 本文用在 | 默认角色 | 再验证 | 待分配池 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `sys.staff.manage` | 新增、编辑、启用、移交、在办事项、重新生成激活码、解除锁定、设置分配池；上传员工的企业微信二维码（`wecom_qr`） | 仅超级管理员 | 否（A46） | 否 | 注册表已有（d4-identity.md:1201） |
| `sys.staff.secure_ops` | 禁用、重置密码、重置第二因子 | 仅超级管理员 | 是 | 否 | 增补（A46、A88） |
| `self.mfa.reset` | 本人重新绑定动态口令（3.86、3.87） | 全体员工（标记，不进角色配置） | 是 | 否 | 增补（A129 采纳；C66：自助类再验证标记） |
| `sys.staff.wecom_bind` | 邀请绑定、手工录入企业微信 userid | 仅超级管理员 | 否 | 否 | 注册表已有 |
| `sys.session.revoke` | 在线会话、强制下线 | 仅超级管理员 | 否 | 否 | 注册表已有 |
| `sys.role.edit` | 保存角色权限 | 仅超级管理员 | 是 | 否 | 注册表已有 |
| `sys.dict.edit` | 新增、修改字典项 | 仅超级管理员 | 否 | 否 | 注册表已有 |
| `sys.param.edit` | 保存参数、撤销预约、导入放假安排 | 仅超级管理员 | 否 | 否 | 注册表已有 |
| `sys.super_admin` | 开关管理（读与改）、部署核对；a09 的场景开关等也用它（A45） | 仅超级管理员 | 否（A129：不另设再验证标记） | 否 | 增补（A45、A129） |
| `flow.checklist.manage` | 清单模板的新建、启用、放弃；读草稿与历史版本 | 超级管理员、内容运营 | 否 | 否 | 注册表已有 |
| `flow.ops.view` | 流程运维的只读列表：定时器、出站投递、回调收件箱、不变量违规（与 a02 工作台 `flow_ops` 待办同一判定） | 仅超级管理员 | 否 | 否 | 增补（A129 采纳；C66 已列，a02 共用） |
| `flow.ops.manage` | 定时器重新排期与标记不再需要、死信重投、回调重置、手动校验、处理违规 | 仅超级管理员 | 否 | 否 | 增补 |
| `sys.health.manage` | 认领、关闭告警；处理非资金类违规 | 超级管理员、财务主管 | 否 | 否 | 增补 |
| `billing.invariant.resolve` | 处理资金类违规（`severity = P1`，或检查项编号以 `billing.`、`payment.` 开头）；限定计费范围的手动校验 | 财务 | 否 | 否 | 注册表已有 |
| `media.job.retry` | 媒体任务人工重试 | 超级管理员、内容运营 | 否 | 否 | 增补 |
| `files.purge.approve` | 放行、驳回清除运行 | 仅超级管理员 | 建议是（批量不可逆；驳回按 C86 豁免，A149） | 否 | 增补 |
| `files.restore` | 恢复已清除文件 | 仅超级管理员 | 否 | 否 | 增补 |
| `files.erase` | 彻底删除文件 | 仅超级管理员 | 是（A36） | 否 | 增补 |
| `pii.phone.reveal`、`pii.license.view`、`pii.bank.reveal` | 明文查看（按字段） | 客服、交付经理、财务（`pii.bank.reveal` 仅财务） | 否 | 否 | 注册表已有 |
| `docs.consent.evidence` | 明文查看同意记录里的手机号与信用代码 | 仅超级管理员（a09） | 是（a09） | 否 | 增补（a09 提出） |
| `service.ticket.assign` | 客服主管切换他人当班；看客服池；选人时只读列出交付经理池（a08） | 客服（仅主管） | 否 | 是：`service_ticket`（负责人为空的未结客服工单，即客服主管待办，`ix_service_ticket_unassigned`；a08 的建议） | 注册表已有 |
| 各分配类权限点 | 选人下拉（`merchant.manager.assign`、`merchant.manager.transfer`、`delivery.ticket.assign_editor`、`delivery.ad.assign`、`delivery.ticket.assign_publisher`、`service.ticket.assign`、`service.ticket.transfer`） | 见注册表 | — | — | 注册表已有 |
| 文件分类授权矩阵引用的键 | 后台上传登记与签发（2.17 的矩阵）：`merchant.profile.proxy_edit`、`merchant.qualification.review`、`pii.license.view`、`merchant.asset.upload_on_behalf`、`merchant.asset.review`、`merchant.account_change.request`、`merchant.account_change.approve`、`finance.invoice.issue`、`finance.invoice.red`、`finance.refund.execute`、`order.payment.create_offline`、`publish.takedown.check`、`publish.patrol.do`、`publish.link.verify`、`service.ticket.reply`、`drama.media.manage`、`drama.copyright.revise`、`delivery.download`、`docs.consent.evidence` | 见注册表与各文档 | 按注册表 | — | 注册表已有，或由 a03、a04、a07、a08 增补 |
| 各审批的决定权限点 | 审批单列表的 `actions` 与“我的待审批”判定（2.10） | 见注册表 | — | — | 注册表已有或由对应文档增补 |
| `audit.export` | 操作日志导出（经 `admin.exportJob.create`，导出键 `audit_logs.list`，a02） | 仅超级管理员 | 是 | 否 | 注册表已有 |

`permission: assert-in-handler`（A45）的接口在“鉴权”一栏写明处理器里的判定规则。系统模块的查看等级：PRD 矩阵里只有超级管理员对 `system` 是 `v` 以上，其余角色为 `n`，所以“system ≥ v”实际等于“超级管理员”，角色页改了矩阵后自动放开。

## 2. 公共结构

### 2.1 分页

| 结构 | 字段 | 用于 |
| --- | --- | --- |
| `AdminPage<T>` | `items: array<T>`、`page: integer`、`pageSize: integer`、`total: integer` | 后台页码分页（C43）：查询参数 `page`（从 1 起）、`pageSize`（默认 20，上限 100）、`sort` |
| `AdminCursorPage<T>` | `items: array<T>`、`nextCursor: string \| null`、`hasMore: boolean`、`totalApprox: integer` | 只增大表（`audit_log`、`webhook_event`）：查询参数 `cursor`、`limit`（默认 20，上限 100）；`totalApprox` 封顶 10,000（A22） |

`AdminPage<T>` 由本文定义（A132、C87），后台各文档的页码分页响应都引用它，不另起 `PageResult` 等同构结构；`AdminCursorPage<T>` 同理。

有界小集合（A78，C43 已按 operationId 登记）一次返回全部，响应 `data = { items, … }`，不带分页字段：`admin.role.list`、`admin.dictType.list`、`admin.dictItem.list`、`admin.featureFlag.list`、`admin.staffGroup.list`、`admin.assignmentPoolMember.list`、`admin.checklistTemplate.list`、`admin.paramValue.list`、`admin.calendarDay.list`。`items` 之外并列返回的只有页面需要的上下文（字典的类型版本号、参数的分组标题与最近保存、日历的年份与批次号、分配池的游标），见各结构。

### 2.2 `StaffBrief` 员工摘要

列表、详情里引用员工的地方都用它（认领人、处理人、发起人、接收人等）。这是后台全仓共用的员工摘要 schema：其他后台文档引用员工时直接引用 `StaffBrief`，不另定同名或近义结构（a03、a05 的 `StaffBrief`、a04、a06、a07、a09 的 `StaffRef` 并入本结构；商家端给商家看的服务经理名片另起名字，m08 已改为 `MerchantStaffBrief`）。本文是 `StaffBrief` 的归属文档（A132、C87）。

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `staffId` | string(uuid) | 是 | 员工 id | `staff.id` |
| `staffNo` | integer | 是 | 工号（1001 起） | `staff.staff_no` |
| `name` | string | 是 | 姓名 | `staff.name` |
| `roleKey` | enum | 是 | 角色键，取值见第 4 节 | `staff.staff_role_key` |
| `isLead` | boolean | 是 | 是否主管 | `staff.is_lead` |
| `status` | enum | 是 | `pending` / `active` / `disabled` | `staff.status` |

### 2.3 `StaffMe` 当前员工

`admin.auth.me.get` 的响应，也是两个建会话接口（3.2、3.6）的响应主体。前端据此渲染菜单、路由守卫与按钮；收到 `PERMISSION_DENIED` 时重取（d7-platform.md:1105）。

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `staff` | object（`StaffBrief`） | 是 | 本人 | `staff` |
| `displayName` | string \| null | 是 | 对商家展示的称呼 | `staff.display_name` |
| `phoneMask` | string | 是 | 登录手机号脱敏串；本人也只看脱敏值（C40） | `staff.phone_mask` |
| `roleName` | string | 是 | 角色名称 | `staff_role.name` |
| `staffGroup` | object \| null | 是 | `{ staffGroupId, name }`；未分组为 `null` | `staff_group.id`、`staff_group.name` |
| `moduleLevels` | object | 是 | 13 个模块的等级，键见第 4 节 `ModuleKey`，值 `n` / `v` / `o` / `e`；缺失的键按代码默认值补齐，注册表外的键丢弃 | `staff_role.module_levels` |
| `permissions` | array<string> | 是 | 本人此刻生效的敏感操作权限点：角色 `actions` 里 `on = true` 的键，带 `leadOnly` 的只在 `is_lead = true` 时计入；超级管理员为 V1.0 的全部键 | `staff_role.actions`、`staff.is_lead` |
| `dataScope` | enum | 是 | 生效的数据范围：`own` / `group` / `all`。角色为 `own` 且本人是主管时升为 `group`（proto-admin-e.md:138） | `staff_role.data_scope`、`staff.is_lead` |
| `wecomBindStatus` | enum | 是 | `none` / `invited` / `bound` / `unbound` | `staff.wecom_bind_status` |
| `mustChangePassword` | boolean | 是 | 参数 `admin.password_max_age_days` 大于 0 且密码已超期时为真，前端引导到修改密码；默认参数为 0，恒为假 | 计算：`staff.password_changed_at` |
| `recoveryCodesLeft` | integer | 是 | 剩余恢复码个数（0–10）；少于 3 个时用户菜单提示到“动态口令设置”重新绑定（3.86、3.87） | 计算：`staff.recovery_codes` 的元素个数 |
| `session` | object | 是 | `{ staffSessionId, authMethod, idleExpiresAt, absoluteExpiresAt, stepUpValidUntil }`；`stepUpValidUntil` = 最近一次第二因子验证 + 10 分钟，前端可据此预判是否会被要求再验证 | `staff_session.id`、`auth_method`、`idle_expires_at`、`absolute_expires_at`；`staff_session.stepup_at` + `ADMIN_STEPUP_TTL` |
| `flags` | object | 是 | `exposed_to = 'client'` 的特性开关求值结果（键 → 值），后台菜单按 `release.*` 过滤 V1.1 页面（d7-platform.md:1094） | `feature_flag`（求值） |
| `serverTime` | string(date-time) | 是 | 服务器时刻，前端校正倒计时 | 计算 |

### 2.4 `AuthNext` 登录前的下一步

登录第一步、激活、设置密码三个接口的响应。票据是 HMAC 签名的短票据（员工 id、用途、过期时间、随机数），不是会话，访问不了任何业务接口（d4-identity.md:1035）。三种用途的票据共用字段名 `ticket`（请求体同名）；约定 C4 的示例已统一为 `ticket`（A139）（一个字段承载三种用途，端上不必按步骤换名）。

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `next` | enum | 是 | `mfa` 输入动态口令或恢复码 → 3.2；`set_password` 设置密码 → 3.4；`enroll_totp` 绑定动态口令 → 3.5；`login` 回登录页用新密码登录 | 计算 |
| `ticket` | string \| null | 是 | 下一步要带的票据；`next = login` 时为 `null`。不透明串，不超过 512 字符 | 计算 |
| `ticketExpiresAt` | string(date-time) \| null | 是 | 票据过期时刻：`mfa` 5 分钟；`set_password`、`enroll_totp` 15 分钟（本稿补充） | 计算 |
| `methods` | array<enum> | 是 | `next = mfa` 时为 `['totp','recovery']`，其余为 `[]` | 计算 |

### 2.5 员工：`StaffListItem`、`StaffDetail`

`StaffListItem`（员工列表与选人下拉）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| （`StaffBrief` 的全部字段） | | 是 | | 2.2 |
| `phoneMask` | string \| null | 是 | 手机号脱敏串；选人下拉模式（调用方没有 `system ≥ v`）为 `null` | `staff.phone_mask` |
| `staffGroup` | object \| null | 是 | `{ staffGroupId, name }` | `staff_group` |
| `dataScope` | enum | 是 | 生效的数据范围，算法同 2.3 | `staff_role.data_scope`、`staff.is_lead` |
| `wecomBindStatus` | enum | 是 | 企业微信绑定状态 | `staff.wecom_bind_status` |
| `pools` | array<string> | 是 | 所在分配池（池名即角色键）；没有为 `[]` | `assignment_pool_member.pool` |
| `lastLoginAt` | string(date-time) \| null | 是 | 最近登录；`null` 即“从未登录” | `staff.last_login_at` |
| `isActivated` | boolean | 是 | 是否已设置密码；`status = active` 且为假即“待激活” | 计算：`staff.password_hash` 非空 |
| `isLocked` | boolean | 是 | 任一失败桶在锁定期内 | 计算：`staff.locked_until_trusted`、`staff.locked_until_untrusted` |
| `disabledReason` | enum \| null | 是 | 禁用原因 | `staff.disabled_reason` |
| `handoverTo` | object（`StaffBrief`）\| null | 是 | 禁用时的接收人，用于“离职，工单已移交宋佳” | `staff.handover_to_staff_id` |
| `openWorkCount` | integer \| null | 是 | 在办量合计：各在办来源 `countOpen` 之和（禁用弹层用）；只在 `withLoad=true` 时计算，否则 `null` | 计算（各业务模块注册的在办来源，d4-identity.md:1089） |
| `openWorkBySource` | array<object> \| null | 是 | 按来源与对象类型拆开的在办量 `{ source, subjectType, count }`，只列数量大于 0 的项；选人弹层按页面含义取其中一项：分配交付经理的“进行中 N 单”取 `store_manager` / `delivery_ticket`，广告任务的“进行中 N 条”取 `ad_editor` / `ad`，客服工单的“待处理 N 单”取 `service_ticket_owner` / `service_ticket`。只在 `withLoad=true` 时计算，否则 `null` | 计算：同上；`source` 取第 4 节 `WorkSource`，`subjectType` 取 `assignment_history.subject_type` 的取值 |
| `onDuty` | boolean \| null | 是 | 客服池的当班开关；不在客服池为 `null` | `assignment_pool_member.on_duty` |
| `isRecommended` | boolean | 是 | 带 `recommendPool` 时，按轮询游标排在下一位的候选为真，其余为假（与 `PoolMemberList` 同名同义） | 计算：`assignment_cursor.last_staff_id` 之后的第一个候选 |
| `isSelf` | boolean | 是 | 是否当前登录员工（“当前登录”标签；禁用按钮置灰） | 计算 |
| `actions` | array<enum> | 是 | 当前观察者可执行的动作（C16），取值见第 4 节 `StaffAction` | 计算 |

`StaffDetail`（详情、编辑弹层回显；编辑类接口的响应）：`StaffListItem` 的全部字段，另加：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `displayName` | string \| null | 是 | 对商家展示的称呼（服务经理名片） | `staff.display_name` |
| `servicePhone` | string \| null | 是 | 对商家展示的服务电话（工作电话或座机，可带分机号）；不是登录手机号 | `staff.service_phone` |
| `wecom` | object | 是 | `{ status, userid, boundAt, qrFileId, qrUrl }`：`userid` 原样返回（企业内部标识，不是个人信息）；`qrUrl` 为二维码图片的签名地址 `{ url, expiresAt }`，30 分钟对齐窗口（C61），没有图片为 `null` | `staff.wecom_bind_status`、`staff.wecom_userid`、`staff.wecom_bound_at`、`staff.wecom_qr_file_id` |
| `poolMemberships` | array<`PoolMember`> | 是 | 所在分配池与城市（2.8） | `assignment_pool_member` |
| `security` | object | 是 | `{ isActivated, totpEnrolledAt, passwordChangedAt, recoveryCodesLeft, lockedUntilTrusted, lockedUntilUntrusted, failTrusted, failUntrusted, lastLoginAt, lastLoginIpMask }`；IP 隐去第三段（d4-identity.md:1719） | `staff.password_hash`（是否非空）、`staff.totp_enrolled_at`、`staff.password_changed_at`、`staff.recovery_codes`（个数）、`staff.locked_until_trusted`、`staff.locked_until_untrusted`、`staff.fail_trusted`、`staff.fail_untrusted`、`staff.last_login_at`、`staff.last_login_ip`（脱敏） |
| `pendingActivation` | object \| null | 是 | 未用、未作废的激活码：`{ purpose, delivery, expiresAt, attempts }`；没有为 `null`。只有哈希，不返回码 | `staff_activation.purpose`、`delivery`、`expires_at`、`attempts`（`used_at`、`revoked_at` 都为空的那一行） |
| `disabledAt` | string(date-time) \| null | 是 | 禁用时间 | `staff.disabled_at` |
| `disabledBy` | object（`StaffBrief`）\| null | 是 | 执行禁用的员工 | `staff.disabled_by_staff_id` |
| `createdAt` | string(date-time) | 是 | 创建时间 | `staff.created_at` |
| `createdBy` | object（`StaffBrief`）\| null | 是 | 创建人；命令行引导的第一位超级管理员为 `null` | `staff.created_by_staff_id` |
| `updatedAt` | string(date-time) | 是 | 更新时间 | `staff.updated_at` |
| `lockVersion` | integer | 是 | 乐观锁版本号（C52） | `staff.lock_version` |

### 2.6 `OpenWorkSummary` 名下在办事项

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `staff` | object（`StaffBrief`） | 是 | 被查询的员工 | `staff` |
| `total` | integer | 是 | 在办事项总数 | 计算 |
| `bySource` | array<object> | 是 | `{ source, subjectType, count, samples }`：`source` 取第 4 节 `WorkSource`，`subjectType` 取 `assignment_history.subject_type`（门店交付经理一个来源拆成 `store`、`drama_order`、`delivery_ticket` 三行，3.17）；`samples` 至多 5 条 `{ subjectId, label }`，`label` 为单号或门店名 | 各在办来源的 `countOpen` 与列举 |
| `candidates` | array<`StaffBrief`> | 是 | 可接收的员工：同角色、`status = active`、不是本人；按工号排序。为空时界面提示“请先新增一名 <角色>，再禁用”（proto-admin-e.md:258） | `staff`（`ix_staff_staff_role_key_status`） |
| `pendingApprovalsAsRequester` | integer | 是 | 本人作为发起人的在途审批数；这些不移交，发起人被禁用后由有决定权的人代为撤回（A15） | `approval_request`（`ix_approval_request_requester_staff_id_status`） |

### 2.7 `ActivationIssue` 激活码下发结果；`StaffMutationResult`

`ActivationIssue`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `purpose` | enum | 是 | `activate` / `reset_password` | `staff_activation.purpose` |
| `delivery` | enum | 是 | `sms` 已排队短信下发 / `manual` 由超级管理员线下转交 | `staff_activation.delivery` |
| `expiresAt` | string(date-time) | 是 | 过期时间（生成 + 24 小时） | `staff_activation.expires_at` |
| `activationCode` | string \| null | 是 | 仅 `delivery = manual` 且是首次执行时返回 8 位明文，只出现这一次；`sms` 为 `null`。幂等重放时为 `null`（见下） | 生成时的明文，库里只存 `staff_activation.code_hash` |
| `replayed` | boolean | 是 | 本次响应是幂等重放（C50“结果脱敏”）；为真时 `activationCode` 一定为 `null` | 计算 |

结果脱敏（A80、C50）：幂等记录不存激活码明文（01 分组第 4 节），带激活码的五条接口（3.14、3.16、3.20、3.21、3.22）写幂等记录时把激活码置为 `null`，重放时返回 `null` 并带 `replayed: true`；超级管理员要再拿码只能用新键重新生成（3.22）。路由元数据 `x-redact-on-replay`（C75）：3.14、3.16、3.20、3.21 登记 `['activation.activationCode']`，3.22 登记 `['activationCode']`。

`StaffMutationResult` = `{ staff: StaffDetail, activation: ActivationIssue | null, replayed: boolean }`：新增、启用、重置密码、重置第二因子的响应；没有生成激活码时（新增为“暂不启用”）`activation` 为 `null`；`replayed` 同上（嵌套的 `activation.replayed` 与它取值相同）。

`HandoverResult` = `{ staff: StaffDetail, batchId: string(uuid) | null, moved: array<{ source, subjectType, count }>, handoverTo: StaffBrief | null }`：禁用与移交的响应；`batchId` 为本次改派批次（`assignment_history.batch_id`），没有在办事项时为 `null`；`moved` 按来源与对象类型计数（门店交付经理一项会拆成门店、订购单、交付工单三行）。

### 2.8 `PoolMember` 分配池成员

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `pool` | enum | 是 | `delivery_manager` / `editor` / `publisher` / `cs` | `assignment_pool_member.pool` |
| `staff` | object（`StaffBrief`） | 是 | 池内员工 | `assignment_pool_member.staff_id` |
| `city` | `DictRef` \| null | 是 | 城市（行政区划字典 `region` 的市级项，`{ code, name }`，C85、A151；字典项停用后仍返回名称）；不限城市为 `null`（库里是空串哨兵）。请求与查询参数仍收 `cityCode` | `assignment_pool_member.city_code`；名称取 `dict_item.name`（`dict_type_key = 'region'`） |
| `onDuty` | boolean | 是 | 当班；非客服池恒为真 | `assignment_pool_member.on_duty` |
| `updatedAt` | string(date-time) | 是 | 最近更新 | `assignment_pool_member.updated_at` |

`PoolMemberList` = `{ items: array<PoolMember & { isRecommended: boolean }>, cursors: array<{ pool, scopeKey, lastStaff: StaffBrief | null, updatedAt }> }`：`isRecommended` 表示轮询的下一位（初稿名 `isNext`，与 `StaffListItem` 统一）（同池、同范围里 `staff_id` 大于游标的第一个当班成员，没有则回到第一个，d3-flow.md:646-653）；`cursors` 来自 `assignment_cursor.pool`、`scope_key`、`last_staff_id`、`updated_at`。

### 2.9 角色：`RoleSummary`、`RoleConfig`、`RoleDetail`

`RoleSummary`（`admin.role.list` 的 `items`，`RoleSummaryList = { items }`）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `roleKey` | enum | 是 | 角色键 | `staff_role.key` |
| `name` | string | 是 | 名称 | `staff_role.name` |
| `description` | string | 是 | 职责描述 | `staff_role.description` |
| `dataScope` | enum | 是 | 角色的数据范围 | `staff_role.data_scope` |
| `isLocked` | boolean | 是 | 超级管理员为真，只读 | `staff_role.is_locked` |
| `availableFrom` | enum | 是 | `v1.0` / `v1.1`（渠道运营） | `staff_role.available_from` |
| `members` | array<`StaffBrief`> | 是 | 启用中的成员，按工号排序 | `staff`（`staff_role_key`、`status = 'active'`） |
| `memberCount` | integer | 是 | 启用中的成员数 | 计算 |
| `updatedAt` | string(date-time) | 是 | 最近保存时间 | `staff_role.updated_at` |
| `updatedBy` | object（`StaffBrief`）\| null | 是 | 最近保存人；迁移播种后未改过为 `null` | `staff_role.updated_by_staff_id` |

`RoleConfig`（角色的可编辑部分；`admin.role.defaults.get` 的响应）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `roleKey` | enum | 是 | 角色键 | `staff_role.key` |
| `moduleLevels` | object | 是 | 13 个模块 → `n` / `v` / `o` / `e`；`o` 只允许出现在 `delivery`、`publish` | `staff_role.module_levels`（defaults 取代码注册表） |
| `actions` | object | 是 | 权限点 → `{ on: boolean, leadOnly: boolean }`；只含该角色适用的权限点（注册表里为该角色登记了默认值的键），即原型“按角色预置的敏感操作清单” | `staff_role.actions`（defaults 取代码注册表） |
| `dataScope` | enum | 是 | `own` / `group` / `all` | `staff_role.data_scope` |

`RoleDetail` = `RoleSummary` 的全部字段 + `RoleConfig` 的 `moduleLevels`、`actions` + `lockVersion`（`staff_role.lock_version`）+ `isDefault: boolean`（与代码默认值完全相同，即原型“当前为默认配置”，计算）。权限点的名称、说明、所属菜单模块、是否再验证由前端直接取 `packages/contract` 的注册表（C74），接口不返回。

### 2.10 审批：`ApprovalItem`、`ApprovalDetail`

审批单只记录“批没批”（03 分组 2.12）；列表项只有审批单这一种形状，摘要取提交时生成的快照，领域内容到领域资源取（A14）。

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `approvalId` | string(uuid) | 是 | 审批单 id | `approval_request.id` |
| `requestNo` | string \| null | 是 | 业务单号（`TK`、`TZ`、`YQ`、`ZH` 开头）；审核类等为 `null` | `approval_request.request_no` |
| `kind` | enum | 是 | 审批类型，12 个取值见第 4 节 | `approval_request.kind` |
| `category` | enum | 是 | `review` 商家提交的审核 / `approval` 员工发起的审批 | `approval_request.category` |
| `status` | enum | 是 | `pending` / `approved` / `rejected` / `withdrawn` | `approval_request.status` |
| `roundNo` | integer | 是 | 同一对象第几次提交 | `approval_request.round_no` |
| `subjectType`、`subjectId` | string、string(uuid) | 是 | 对象（最终表名与 id） | `approval_request.subject_type`、`subject_id` |
| `entityId`、`storeId` | string(uuid) \| null | 是 | 归属主体与门店（商家链接用） | `approval_request.entity_id`、`store_id` |
| `deliveryTicketId` | string(uuid) \| null | 是 | 所属交付工单；只有 `launch_link` 非空 | `approval_request.delivery_ticket_id` |
| `summary` | object（`ApprovalSummary`） | 是 | `{ title, lines: [{ label, value }], amountFen: integer(分) \| null, points: integer(积分) \| null }`：已脱敏的展示摘要；`amountFen`、`points` 只作展示与排序，真相在领域表。契约 schema 名沿用数据模型的 `ApprovalSummary`（按 `kind` 的判别联合，03 分组第 4 节）；各 `kind` 的 `lines` 由该 `kind` 的处理器在提交时生成、由登记它的文档定义（如 a06 队列卡片的门店名、平台与账号名，a07 的发起人角色、可用积分 a → b、关联订单或广告单号），本接口原样返回 | `approval_request.summary_snapshot` |
| `domain` | object | 是 | `{ type, id }`：一对一的领域行（最终表名与 id），前端据此跳到下表的领域接口 | `approval_request.summary_snapshot` 的 `domain` |
| `badges` | array<enum> | 是 | 读队列时从领域表派生的角标：`check_mismatch` 比对异常、`final_rejected` 终局驳回、`overdue` 超时；没有为 `[]` | 各 `kind` 处理器从领域表派生（如 `qualification_submission`）；`overdue` = `pending`，且 `approval_request.due_at` 已过，或 `due_at` 为空（V1.0 不设决定时限的类型，A93）而提交已超过参数 `approval.escalate_workdays` 个工作日（`approval.I5`，03-staff-authz-audit.md:832；与 a02 工作台同一口径） |
| `submitter` | object | 是 | `{ actorType, actorId, label }`：`label` 员工为姓名、商家为“老板 · 称呼”、系统为“系统” | `approval_request.submit_actor_type`、`submit_actor_id`；`staff.name` 或 `merchant_user.display_name` |
| `requester` | object（`StaffBrief`）\| null | 是 | 发起员工；商家提交的审核为 `null` | `approval_request.requester_staff_id` |
| `handler` | object（`StaffBrief`）\| null | 是 | 当前处理人，读取时派生，不取快照：`launch_link` 取所属工单当前的发布专员（工单改派、员工禁用移交后即是新人，d3-flow.md:3113）；其他 `kind` 为 `null`（队列页“审批人”看 `decidedBy`） | `delivery_ticket.publisher_id`（经 `approval_request.delivery_ticket_id`，由 delivery 模块注册的读取函数给出，approval 不读 L3 表） |
| `submittedAt` | string(date-time) | 是 | 提交时间 | `approval_request.submitted_at` |
| `dueAt` | string(date-time) \| null | 是 | 决定时限 | `approval_request.due_at` |
| `decidedBy` | object（`StaffBrief`）\| null | 是 | 审批人；撤回与系统决定为 `null` | `approval_request.decided_by_staff_id` |
| `isDecidedBySystem` | boolean | 是 | 系统自动决定 | `approval_request.is_decided_by_system` |
| `decidedAt` | string(date-time) \| null | 是 | 进入终态的时间 | `approval_request.decided_at` |
| `decisionNote` | string \| null | 是 | 决定或撤回说明 | `approval_request.decision_note` |
| `reasons` | array<`DictRef`> | 是 | 驳回原因，`DictRef = { code, name }`（C85、C87；字典项停用后仍返回名称）；没有为 `[]` | `approval_request.reason_codes`；名称取 `dict_item.name`（`dict_type_key = 'reject_reason'`） |
| `lockVersion` | integer | 是 | 审批单的乐观锁版本号；领域资源的决定接口回传它（C53） | `approval_request.lock_version` |
| `actions` | array<enum> | 是 | 当前观察者能在领域资源上执行的动作（C16）：`approve` / `reject` / `withdraw` / `approve-review` / `reject-review` | 计算，规则见下表与 3.36 |

`ApprovalDetail`：`ApprovalItem` 的全部字段，另加：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `checklist` | object \| null | 是 | `{ code, versionNo, result: [{ key, result, note }] }`：审核所用清单与结论；没有为 `null` | `approval_request.checklist_code`、`checklist_version_no`、`checklist_result` |
| `confirmChecks` | array<string> | 是 | 决定时勾选的核对项 | `approval_request.confirm_checks` |
| `sla` | object \| null | 是 | 时限快照 `SlaSnapshot`（`policy`、`amount`、`unit`、`calendarVersion`、`computedAt`） | `approval_request.sla_snapshot` |
| `timeline` | array<object> | 是 | 状态历史：`{ fromState, toState, event, actorType, actorLabel, occurredAt, reasonCode, note, elapsedWorkMin }`，按 `seq` 升序；日历修正产生的 `from_state = to_state` 行也在其中 | `status_transition`（`machine = 'approval_request'`、`state_field = 'status'`） |
| `operations` | object | 是 | `{ get, approve, reject, withdraw }`：该 `kind` 的领域接口 operationId（下表），不适用的为 `null` | 代码登记 |

`ApprovalDecisionView`（全仓共用的审批决定信息）：各领域详情接口（a03、a05、a06、a07）返回所挂审批单的决定信息时引用本结构，不再各自定义 `ApprovalBrief`、`reasonCodes: string[]` 等形状。字段取 `ApprovalItem` 的子集：`approvalId`、`kind`、`status`、`roundNo`、`submittedAt`、`dueAt`、`badges`、`requester`、`decidedBy`、`isDecidedBySystem`、`decidedAt`、`decisionNote`、`reasons`（`DictRef[]`）、`lockVersion`、`actions`，来源同上表。读接口一律返回 `reasons: DictRef[]`（带名称）；决定接口的请求体提交 `reasonCodes: string[]`（C85 的出入形态）。

审批类型与领域接口（A14；03 分组 3.2）：

| `kind` | 查看所需模块等级 | 决定权限点 | 领域详情 | 决定 | 撤回 |
| --- | --- | --- | --- | --- | --- |
| `qualification` | `merchant` ≥ v | `merchant.qualification.review` | `admin.qualificationSubmission.get` | `admin.qualificationSubmission.approve` / `reject` | 商家在小程序撤回 |
| `channel_account` | `publish` ≥ v；持 `publish.account.verify` 即全量可见（角色队列，见下） | `publish.account.verify` | `admin.channelAccountSubmission.get` | `admin.channelAccountSubmission.approve` / `reject` | 无（商家提交） |
| `launch_link` | `publish` ≥ v | `publish.link.verify` | `admin.launchSubmission.get` | `admin.launchSubmission.approve` / `reject` | 系统（任务作废） |
| `order_cancel`、`ad_cancel`、`qualification_cancel` | `order` ≥ v 或 `finance` ≥ v | `finance.refund.approve` | `admin.cancelRequest.get` | `admin.cancelRequest.approve` / `reject` | `admin.cancelRequest.withdraw` |
| `plan_refund` | `finance` ≥ v 或 `order` ≥ v | `finance.refund.approve` | `admin.refundRequest.get` | `admin.refundRequest.approve` / `reject` | `admin.refundRequest.withdraw` |
| `points_adjust` | `finance` ≥ v 或 `billing` ≥ v | `billing.adjust.approve` | `admin.pointAdjustmentRequest.get` | `admin.pointAdjustmentRequest.approve` / `reject` | `admin.pointAdjustmentRequest.withdraw` |
| `subscription_extend` | `order` ≥ v 或 `billing` ≥ v | `billing.extension.approve`（仅主管，且是发起人所在组的主管） | `admin.termExtensionRequest.get` | `admin.termExtensionRequest.approve` / `reject` | `admin.termExtensionRequest.withdraw` |
| `finance_config_change` | `finance` ≥ v | `finance.config.approve` | `admin.financeConfigRevision.list`（`tab=history&financeConfigRevisionId=…`，没有按 id 取单的接口，a07 3.80） | `admin.financeConfigRevision.approve` / `reject` | `admin.financeConfigRevision.withdraw` |
| `account_change` | `merchant` ≥ v | `merchant.account_change.approve` | `admin.accountChangeRequest.get` | `admin.accountChangeRequest.approve` / `reject` | `admin.accountChangeRequest.withdraw` |
| `transfer_confirm` | `finance` ≥ v | `finance.receipt.confirm` | `admin.transferProof.get` | `admin.transferProof.approveReview` / `rejectReview` | 无（A58） |

查看还要套数据范围（本人负责、本组、全部；发起人总能看到自己发起的），不在范围内的详情返回 404（d3-flow.md:2399-2405）。例外：`kind = channel_account` 是角色队列（账号核验没有交付工单，按权限点进入队列，任何持有者都能处理，`11-publish.md:17`；a06 1.1、3.5–3.7 同一口径），持有 `publish.account.verify` 即全量可见、可决定，不套数据范围；不持有的仍按 `publish` ≥ v 加数据范围只读。列表、计数（3.36、3.37）与详情（3.38）都按此判定。`actions` 的判定：`approve`、`reject`（`transfer_confirm` 为 `approve-review`、`reject-review`）要求 `status = pending`、持有决定权限点、对象在数据范围内（`channel_account` 不要求）、观察者不是发起人（`ck_approval_request_decider_not_requester`），`subscription_extend` 另要求观察者是 `requester_staff_group_id` 那一组的启用主管；`withdraw` 要求 `status = pending` 且观察者是提交人本人，或发起人已不是启用状态而观察者持有该类型的决定权限点（A15），商家提交的三类不给员工 `withdraw`。

### 2.11 操作日志：`AuditLogItem`、`AuditLogDetail`

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `auditLogId` | string(uuid) | 是 | 日志 id | `audit_log.id` |
| `logNo` | string | 是 | 日志编号（`RZ` + 日期 + 序号） | `audit_log.log_no` |
| `createdAt` | string(date-time) | 是 | 时间 | `audit_log.created_at` |
| `stream` | enum | 是 | `ops` / `activity` / `access` | `audit_log.stream` |
| `category` | string | 是 | 类别编码（代码登记，`x-open-enum`），操作日志页的类型筛选与彩色标签按它 | `audit_log.category` |
| `action` | string | 是 | 机器可读的动作 `<领域>.<对象>.<动作>` | `audit_log.action` |
| `summary` | string | 是 | 写入时渲染好的中文标题 | `audit_log.summary` |
| `actor` | object | 是 | `{ actorType, actorId, name, role, client }`：`actorType = system` 时 `actorId`、`client` 为 `null`，`name` 为“系统”，`role` 为“自动任务” | `audit_log.actor_type`、`actor_id`、`actor_name`、`actor_role`、`client` |
| `target` | object \| null | 是 | `{ type, id, key, label }`：`id` 与 `key` 只有一个非空 | `audit_log.target_type`、`target_id`、`target_key`、`target_label` |
| `entityId`、`storeId` | string(uuid) \| null | 是 | 所属主体与门店 | `audit_log.entity_id`、`store_id` |

`AuditLogDetail`：`AuditLogItem` 的全部字段，另加：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `reason` | object \| null | 是 | `{ code, text }` | `audit_log.reason_code`、`reason_text` |
| `before`、`after` | object \| null | 是 | 变更前后，只含变化的字段，已脱敏；超过 16KB 时是 `{ keys, length, sha256 }` | `audit_log.before`、`after` |
| `meta` | object \| null | 是 | 扩展键值（审批状态、规则、通知结果、影响范围等），页面渲染为“键值”区 | `audit_log.meta` |
| `authMethod` | string \| null | 是 | 登录方式编码；页面显示“账号密码 ＋ 动态口令”“系统任务”等（设计规范第 11 节） | `audit_log.auth_method` |
| `ipMask` | string \| null | 是 | 来源 IP，隐去第三段；系统任务为 `null` | `audit_log.ip`（脱敏） |
| `requestId` | string \| null | 是 | 请求追踪号 | `audit_log.request_id` |
| `jobName` | string \| null | 是 | 系统任务或命令行的命令名 | `audit_log.job_name` |
| `onBehalfOfEntityId` | string(uuid) \| null | 是 | 代操作时的被代理主体 | `audit_log.on_behalf_of_entity_id` |
| `link` | object \| null | 是 | 关联页面 `{ route, params, label }`，按 `target.type` 与 id 由代码映射（原型“关联页面”）；映射不到为 `null` | 计算 |

### 2.12 字典：`DictTypeView`、`DictItemView`

`DictTypeView`（`DictTypeList = { items }`）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `typeKey` | string | 是 | 类型键（路径参数名 `dictTypeKey`） | `dict_type.type_key` |
| `name` | string | 是 | 类型名称 | `dict_type.name` |
| `structure` | enum | 是 | `flat` / `tree` | `dict_type.structure` |
| `maxDepth` | integer | 是 | 最大层级 | `dict_type.max_depth` |
| `isSystem` | boolean | 是 | 系统枚举（只可改名称与说明） | `dict_type.is_system` |
| `canCreate` | boolean | 是 | 可否新增 | `dict_type.can_create` |
| `disablePolicy` | enum | 是 | `free` / `block_if_referenced` / `never` | `dict_type.disable_policy` |
| `isMerchantVisible` | boolean | 是 | 小程序可读 | `dict_type.is_merchant_visible` |
| `versionNo` | integer | 是 | 数据版本号 | `dict_type.version_no` |
| `itemCount`、`enabledCount` | integer | 是 | 项数、启用数（“N 项 · 启用 N 项”） | 计算：`dict_item` |
| `levelCounts` | array<integer> | 是 | 各层级项数（树形类型显示“N 个一级 · N 个二级”）；平铺为一个元素 | 计算：`dict_item.parent_code` |

页面上随类型变化的列名（“适用场景”“默认规则”“商家数”“本月工单”等）是前端常量，按 `typeKey` 取，不由接口返回。

`DictItemView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `dictItemId` | string(uuid) | 是 | 字典项 id | `dict_item.id` |
| `typeKey` | string | 是 | 所属类型 | `dict_item.dict_type_key` |
| `code` | string | 是 | 编码（保存后不可改） | `dict_item.code` |
| `parentCode` | string \| null | 是 | 上级编码 | `dict_item.parent_code` |
| `name` | string | 是 | 名称 | `dict_item.name` |
| `description` | string \| null | 是 | 说明 | `dict_item.description` |
| `isEnabled` | boolean | 是 | 启用 | `dict_item.is_enabled` |
| `tags` | array<string> | 是 | 标记（“特殊行业”“功能区”） | `dict_item.tags` |
| `ext` | object | 是 | 按类型的扩展属性（14 分组 4.1），如行业的 `{ open, special, requiredCerts }` | `dict_item.ext` |
| `position` | integer | 是 | 同级顺序 | `dict_item.position` |
| `refCount` | integer \| null | 是 | 引用计数；只在 `withRefCount=true` 时计算，否则 `null` | 计算：字典引用计数端口（14 分组 5.3） |
| `updatedAt` | string(date-time) | 是 | 更新时间 | `dict_item.updated_at` |
| `lockVersion` | integer | 是 | 乐观锁版本号 | `dict_item.lock_version` |

### 2.13 参数：`ParamItem`

参数的定义（类型、范围、单位、默认值、分组、说明）在代码里（`packages/shared/src/params/defs.ts`），库里只存值（14 分组 2.3）。`ParamList = { items: array<ParamItem>, groups: array<{ group, title }>, lastSaved: { at, staff: StaffBrief } | null }`（A78 的有界小集合形态）：`items` 按定义顺序平铺，前端按 `ParamItem.group` 分组；`groups` 给分组的标题与顺序；`lastSaved` 是本次返回的各键最近一次保存（原型“最近保存：09-26 10:00 · 周航”）。参数定义里标为敏感的值路径（如 a09 提出的 `notify.test_recipients`：`[{ staffId, phone?, wxOpenid? }]` 的 `phone`、`wxOpenid`，A107 待回写）只返回脱敏串（手机号前 3 后 4，openid 只留末 4 位）；保存时某个元素的敏感字段原样回传脱敏串，表示沿用原值（按 `staffId` 对应），改动的才传新值。

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `key` | string | 是 | 参数键 | 代码定义；`param_value.key` |
| `group`、`label`、`description` | string | 是 | 分组、显示名、说明 | 代码定义 |
| `type` | enum | 是 | `int` / `bp` / `int_list` / `time_hm` / `bool` / `enum` / `text` / `json` / `sla_policy` | 代码定义（14 分组 4.2） |
| `unit` | string \| null | 是 | 单位（分钟、小时、工作日、天、集） | 代码定义 |
| `range` | object \| null | 是 | `{ min, max }` 或 `{ options }` | 代码定义 |
| `defaultValue` | any | 是 | 代码默认值（“恢复默认值”回填用） | 代码定义 |
| `value` | any | 是 | 当前生效值；库里没有时等于默认值 | `param_value.value`（未撤销、已生效、`effective_at` 最大的一行） |
| `rev` | string(bigint) \| null | 是 | 当前生效值那一行的修订号（展示与排障用）；库里没有已生效的行时为 `null` | `param_value.seq`（生效中的那一行） |
| `latestRev` | string(bigint) \| null | 是 | 该键最新一行未撤销值的修订号（有预约值时就是最新那条预约），保存时作 `expectedRev` 回传；库里没有未撤销的行时为 `null` | `param_value.seq`（`cancelled_at` 为空、`seq` 最大的一行，14 分组 2.3“并发保存”） |
| `effectiveAt` | string(date-time) \| null | 是 | 当前值的生效时间 | `param_value.effective_at` |
| `savedBy` | object（`StaffBrief`）\| null | 是 | 当前值的保存人 | `param_value.created_by_staff_id` |
| `savedAt` | string(date-time) \| null | 是 | 当前值的保存时间 | `param_value.created_at` |
| `pending` | array<object> | 是 | 尚未生效的预约值 `{ paramValueId, value, rev, effectiveAt, reason, savedBy, savedAt, canWithdraw }`；`canWithdraw` = 距生效超过 10 分钟 | `param_value`（`cancelled_at` 为空、`effective_at` 晚于现在） |
| `snapshotOn` | enum | 是 | 何时快照：`create`（之后产生的单据按新值，如各步时限）/ `read`（每次读取当前值，如提醒时刻） | 代码定义（d6-notify-docs-data.md:1598） |

### 2.14 日历：`CalendarYear`、`CalendarImportResult`

`CalendarYear`（A78 的有界小集合形态：`items` 加并列的年份上下文）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `items` | array<object> | 是 | 该年的放假与调休上班日 `{ date: string(date), kind, note }`，按日期升序（初稿名 `exceptions`） | `work_calendar_day.day`、`kind`（`holiday`、`adjusted_workday`）、`note` |
| `year` | integer | 是 | 年份 | 查询参数 |
| `calendarVersion` | integer | 是 | 全表最大批次号（时限快照记的就是它） | `work_calendar_day.calendar_version` 的最大值 |
| `holidays` | array<object> | 是 | 节假日表（连续且同名的日期合并）：`{ name, kind, from: string(date), to: string(date), days }` | 计算：按 `work_calendar_day.note` 与 `kind` 合并 |
| `days` | array<object> \| null | 是 | 全年每一天 `{ date, kind, isWorkday }`；只在 `includeAllDays=true` 时返回 | `work_calendar_day.day`、`kind`、`is_workday` |
| `importedAt` | string(date-time) \| null | 是 | 该年最近一次实际改动的时间 | `work_calendar_day.updated_at` 的最大值 |
| `workHours` | object | 是 | `{ start: "HH:mm", end: "HH:mm" }`，来自参数 `work.start`、`work.end` | `param_value`（键 `work.start`、`work.end`） |

`CalendarImportResult` = `{ year, isChanged: boolean, changedDays: array<string(date)>, calendarVersion: integer, holidayCount: integer, adjustedWorkdayCount: integer, source: string | null, calendar: CalendarYear }`：`holidayCount` 为不同节日名的个数，`adjustedWorkdayCount` 为调休上班的天数，`source` 为所用安排的依据（内置数据的文号，或请求里的 `source`），对应 toast“已导入 2026 年放假安排（依据……）……共 7 个节日、6 个调休上班日”（proto-admin-e.md:410）。

### 2.15 `FeatureFlagView` 特性开关

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `flagKey` | string | 是 | 开关键 | `feature_flag.key` |
| `valueType` | enum | 是 | `bool` / `enum` / `json` | `feature_flag.value_type` |
| `defaultValue` | any | 是 | 无规则命中时的值 | `feature_flag.default_value` |
| `rules` | array<object> | 是 | 有序规则 `{ when: { platform?, clientVersion?, envVersion?, entityIds? }, value }` | `feature_flag.rules` |
| `exposedTo` | enum | 是 | `client` / `server` | `feature_flag.exposed_to` |
| `description` | string \| null | 是 | 说明 | `feature_flag.description` |
| `options` | array<string> \| null | 是 | `enum` 类型的可选值；其余为 `null` | 代码登记表 `packages/contract/config/flags.ts` |
| `updatedAt` | string(date-time) | 是 | 最近修改 | `feature_flag.updated_at` |
| `updatedBy` | object（`StaffBrief`）\| null | 是 | 最近修改人；播种后未改过为 `null` | `feature_flag.updated_by_staff_id` |
| `lockVersion` | integer | 是 | 乐观锁版本号 | `feature_flag.lock_version` |

`FeatureFlagList = { items }`。

### 2.16 `ChecklistTemplateView` 清单模板

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `checklistTemplateId` | string(uuid) | 是 | 模板版本 id | `checklist_template.id` |
| `code` | enum | 是 | 9 个编码之一（第 4 节） | `checklist_template.code` |
| `versionNo` | integer | 是 | 版本号 | `checklist_template.version_no` |
| `status` | enum | 是 | `draft` / `active` / `retired` | `checklist_template.status` |
| `items` | array<object> | 是 | `{ key, label, required, allowNa, merchantVisible, hint }` | `checklist_template.items` |
| `activatedAt`、`retiredAt` | string(date-time) \| null | 是 | 启用、停用时间 | `checklist_template.activated_at`、`retired_at` |
| `createdBy` | object（`StaffBrief`）\| null | 是 | 创建人；迁移播种为 `null` | `checklist_template.created_by_staff_id` |
| `createdAt`、`updatedAt` | string(date-time) | 是 | | `checklist_template.created_at`、`updated_at` |
| `lockVersion` | integer | 是 | 乐观锁版本号 | `checklist_template.lock_version` |
| `actions` | array<enum> | 是 | `activate` / `discard`（仅草稿，且观察者有 `flow.checklist.manage`） | 计算 |

`ChecklistTemplateList = { items }`。

### 2.17 文件：`FileRegistration`、`AdminFileView`、`SignedUrl`

`FileRegistration`（后台登记与续签的响应，C59）：与 m08 2.10 是同一个 `FileRegistration`，结构由 m08 定义（C87），本文引用，不另定义。后台一次登记一个文件，响应就是单个 `FileRegistration`（m08 按批登记时是它的列表）。凭证子结构 `post` 用 m08 的 `PostPolicy`，`sts` 用 m08 的 `StsCredential`（a04 批量上传的凭证同样引用它）。下表是字段速查，以 m08 2.10 为准：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `fileId` | string(uuid) | 是 | 文件 id | `file_object.id` |
| `clientToken` | string | 是 | 回显请求里的续传标识 | `file_object.client_token` |
| `status` | enum | 是 | 登记后为 `pending` | `file_object.status` |
| `mode` | enum | 是 | `post`（≤20MB，预签名表单）/ `multipart`（STS 临时密钥） | `file_object.upload_mode` |
| `bucket`、`region` | string | 是 | 写入区所在桶与地域 | `file_object.incoming_bucket`；部署配置 |
| `key` | string | 是 | 写入区对象键（`incoming/{fileId}/…`），只能写这一处 | `file_object.incoming_key` |
| `post` | object（`PostPolicy`，m08）\| null | 是 | `mode = post` 时的表单 `{ url, fields }`，10 分钟有效 | 计算（签名） |
| `sts` | object（`StsCredential`，m08）\| null | 是 | `mode = multipart` 时的临时密钥 `{ tmpSecretId, tmpSecretKey, sessionToken, startTime, expiredTime }`（后两者 string(date-time)），权限只到 `incoming/{fileId}/*`，30 分钟有效 | 计算（STS） |
| `chunkSize`、`chunkParallel` | integer \| null | 是 | 分块大小（字节）与并发；`post` 时为 `null` | 部署配置 |
| `expiresAt` | string(date-time) | 是 | 本次凭证过期时刻 | 计算 |
| `uploadExpiresAt` | string(date-time) | 是 | 登记过期时刻（登记 + 24 小时），过期未确认即作废 | `file_object.upload_expires_at` |
| `credentialsLeft` | integer | 是 | 还能续签临时密钥的次数（上限 30）；`post` 通道重签表单不计次，值不变（m08 2.10） | 计算：30 − `file_object.sts_issued` |

`AdminFileView`（文件状态、已清除文件列表、恢复与彻底删除的响应）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `fileId` | string(uuid) | 是 | 文件 id | `file_object.id` |
| `category` | enum | 是 | 文件分类（06 分组 3.1 的 32 个分类码，`x-open-enum`） | `file_object.category` |
| `scopeType` | enum | 是 | `platform` / `entity` / `store` | `file_object.scope_type` |
| `entityId`、`storeId` | string(uuid) \| null | 是 | 归属 | `file_object.entity_id`、`store_id` |
| `status` | enum | 是 | `pending` / `promoting` / `stored` / `rejected` / `expired` / `deleting` / `deleted` | `file_object.status` |
| `rejectReason` | enum \| null | 是 | 拒收原因 | `file_object.reject_reason` |
| `originalName` | string \| null | 是 | 原始文件名；系统写入的文件与彻底删除后为 `null` | `file_object.original_name` |
| `ext`、`mime` | string、string \| null | 是 | 扩展名；入库后的规范类型 | `file_object.ext`、`mime` |
| `sizeBytes` | string(bigint) \| null | 是 | 正式区字节数；未入库为 `null` | `file_object.size_bytes` |
| `declaredSizeBytes` | string(bigint) | 是 | 登记时声明的字节数 | `file_object.declared_size` |
| `moderationState` | enum | 是 | `none` / `pending` / `pass` / `review` / `block` | `file_object.moderation_state` |
| `uploader` | object | 是 | `{ actorType, actorId, client, label }`；系统派生物 `actorId`、`client` 为 `null` | `file_object.upload_actor_type`、`upload_actor_id`、`upload_client` |
| `onBehalfStoreId` | string(uuid) \| null | 是 | 员工代商家上传时的门店 | `file_object.on_behalf_store_id` |
| `storedAt` | string(date-time) \| null | 是 | 入库时间 | `file_object.stored_at` |
| `purgeAfter` | string(date-time) \| null | 是 | 可清除时间 | `file_object.purge_after` |
| `deletedAt` | string(date-time) \| null | 是 | 清除完成时间 | `file_object.deleted_at` |
| `erasedAt` | string(date-time) \| null | 是 | 彻底删除时间（3.64）；没有为 `null`。只在 `status = deleted` 时可能非空（`ck_file_object_erased_at`） | `file_object.erased_at`（06-media.md 2.1，`06-media.md:127`，A141） |
| `restorableUntil` | string(date-time) \| null | 是 | 可恢复截止：`deleted_at` + 非当前版本保留期（`secure` 桶 90 天，其余 30 天，d5-media.md:327）；不是 `deleted`、或已彻底删除（`erasedAt` 非空）为 `null` | 计算：`file_object.deleted_at`、`bucket`、`erased_at` |
| `liveRefCount` | integer | 是 | 在用引用数 | 计算：`file_ref`（`state = 'live'`） |
| `production` | object \| null | 是 | 制作文件（样片、成片、广告）的 `{ kind, pipelineState, aigcState, orderItemId, adId, episodeNo }`；其余为 `null` | `production_record.kind`、`pipeline_state`、`aigc_state`、`order_item_id`、`ad_id`、`episode_no` |
| `check` | object \| null | 是 | 体检结论 `{ profile, gate, hard, soft, checkedAt }`；未体检为 `null` | `media_check.profile`、`gate`、`hard`、`soft`、`checked_at` |
| `actions` | array<enum> | 是 | `restore`（`deleted`、未彻底删除、在可恢复期内，且有 `files.restore`）/ `erase`（`stored` 或 `deleted`、未彻底删除，且有 `files.erase`）/ `cancel`（`pending` 且观察者是上传人） | 计算 |

`SignedUrl` = `{ url: string, expiresAt: string(date-time) }`（C60）；`expiresAt` 按分类取 C61 的有效期。本文是归属文档（A132、C87）：`url` 不可空；字段可能没有地址时整个对象为 `null`（写作 `SignedUrl | null`），不返回 `url = null` 的对象。其他后台文档引用本结构，不再定义同名结构；带 `fileId` 的图片地址用 m08 的 `ImageRef`。

**后台文件分类的授权矩阵**（`authorizeUpload` 与 `authz.canReadFile` 的后台一侧；d4-identity.md 第 9.4 节按分类展开，并按 a03、a04、a06、a07、a08、a09 的请求补齐）。“登记”栏是 3.57 的判定，“签发”栏是 3.60、3.61 的判定，签发一律再套数据范围（文件的 `store_id`、`entity_id` 不在调用方范围内即 404；`platform` 级文件不套）。“—”表示后台不能登记或不能经 3.61 签发，返回 `FILE_CATEGORY_NOT_ALLOWED`。“留痕”为是的，每次签发写一条 `access` 审计（3.61）；`secure` 桶的分类一律留痕。

| 分类 | 后台登记（3.57） | 后台签发（3.61） | 留痕 |
| --- | --- | --- | --- |
| `kyc_license`、`kyc_permit` | `merchant.profile.proxy_edit`（证照代传，带 `storeId`） | `merchant.qualification.review` 或 `pii.license.view` | 是 |
| `pay_receipt` | `order.payment.create_offline`（代录对公转账回单）、`finance.refund.execute`（线下退款与返佣打款回单） | 模块 `finance` ≥ v | 是 |
| `invoice` | `finance.invoice.issue`（蓝字）、`finance.invoice.red`（红字） | 模块 `finance` ≥ v；或模块 `service` ≥ v（范围内的客服） | 是 |
| `legal_doc` | 模块 `ops` ≥ e（协议正文） | 授权书：模块 `finance` ≥ v，或 `service` ≥ v（范围内的客服）；协议正文：模块 `ops` ≥ v，且该文件被协议版本引用（`file_ref.ref_type = agreement_version`，a09） | 是 |
| `account_proof` | `merchant.account_change.request` | `merchant.account_change.request` 或 `merchant.account_change.approve` | 是 |
| `portrait_auth` | `merchant.asset.upload_on_behalf`（员工代交，A26） | `merchant.asset.review` 或 `merchant.asset.upload_on_behalf` | 是 |
| `evidence` | `publish.takedown.check`、`publish.patrol.do`、`publish.link.verify` | 模块 `publish` ≥ v | 是 |
| `drama_license_doc` | 模块 `drama` ≥ e；或 `drama.copyright.revise`（版权变更的依据文件，a04） | 模块 `drama` ≥ v | 是 |
| `consent_digest` | — （系统写入） | `docs.consent.evidence` | 是 |
| `pay_bill` | — （系统写入） | 模块 `finance` ≥ v | 是 |
| `seal_image` | — （系统写入） | — （只有任务进程可读） | — |
| `export` | — （系统写入） | — （走 `admin.exportJob.downloadUrls`，a02） | — |
| `profile_image`、`profile_video`、`profile_promo` | `merchant.profile.proxy_edit`（代改档案，带 `storeId`） | 模块 `merchant` ≥ v | 否 |
| `store_asset` | `merchant.asset.upload_on_behalf`（代传素材，A35） | 模块 `merchant` ≥ v 的交付经理（范围内）、有该门店未结束任务的剪辑师、`merchant.asset.review` | 否 |
| `channel_screenshot` | — （商家上传，后台没有上传场景） | 模块 `publish` ≥ v | 否 |
| `ticket_attachment` | `service.ticket.reply`（工单回复与内部备注的图片）；交付模块的本人任务（后台代录样片修改意见的截图，A59） | 模块 `service` ≥ v 或 `delivery` ≥ v | 否 |
| `sample_video` | 交付模块的本人任务（剪辑师只能给分派给自己的工单上传；`delivery.authorizeUpload` 由 delivery 登记，规则见 a05 1.3） | 模块 `delivery`、`publish` 或 `service` ≥ v | 是 |
| `sample_wm` | — （系统派生） | 同 `sample_video` | 是 |
| `final_episode` | 同 `sample_video`（批次内的成片走上传批次，a04） | `delivery.download`；或模块 `publish` ≥ v（a06） | 是 |
| `package_zip` | — （系统打包） | 同 `final_episode` | 是 |
| `publish_list` | — （系统生成） | 模块 `publish` 或 `delivery` ≥ v | 否 |
| `ad_video` | 交付模块的本人广告任务（`delivery` ≥ o，剪辑师；同 `sample_video`，规则见 a05 1.3） | 模块 `delivery`、`publish` 或 `service` ≥ v | 否 |
| `drama_master` | — （只经上传批次 `admin.uploadBatch.create`，a04） | — （取原片走 `admin.deliveryTicket.material.downloadUrls`，写 `master_checkout`，A19） | — |
| `trailer_src` | `drama.media.manage`（a04） | 全员（同预告片，a04） | 否 |
| `poster` | 模块 `drama` ≥ e | 全员 | 否 |
| `banner` | 模块 `ops` ≥ e | 全员 | 否 |
| `trailer_out`、`video_cover` | — （系统派生） | 全员（`video_cover` 按源文件的规则） | 否 |
| `wecom_qr` | `sys.staff.manage`（编辑员工时人工上传，3.15） | 全员 | 否 |

### 2.18 `PurgeRunView`、`MediaJobView`

`PurgeRunView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `purgeRunId` | string(uuid) | 是 | 运行 id | `file_purge_run.id` |
| `mode` | enum | 是 | `list_only` / `auto` | `file_purge_run.mode` |
| `state` | enum | 是 | `proposed` / `held` / `approved` / `running` / `done` / `aborted` / `rejected` | `file_purge_run.state` |
| `candidateCount` | integer | 是 | 候选文件数（≤5000） | `file_purge_run.candidate_count` |
| `candidateBytes` | string(bigint) | 是 | 候选总字节数 | `file_purge_run.candidate_bytes` |
| `byCategory` | object | 是 | 分类统计（06 分组 4.2） | `file_purge_run.by_category` |
| `heldReason` | string \| null | 是 | 熔断原因 | `file_purge_run.held_reason` |
| `decidedBy` | object（`StaffBrief`）\| null | 是 | 放行或驳回的员工 | `file_purge_run.decided_by_staff_id` |
| `decidedAt` | string(date-time) \| null | 是 | 放行或驳回时间 | `file_purge_run.decided_at` |
| `deletedCount`、`guardTrips` | integer \| null | 是 | 实际清除数、逐文件复核不通过次数 | `file_purge_run.deleted_count`、`guard_trips` |
| `startedAt`、`finishedAt` | string(date-time) \| null | 是 | 执行起止 | `file_purge_run.started_at`、`finished_at` |
| `createdAt` | string(date-time) | 是 | 建行时间 | `file_purge_run.created_at` |
| `actions` | array<enum> | 是 | `approve` / `reject`（`proposed`、`held` 且有 `files.purge.approve`） | 计算 |

候选文件明细用 `admin.file.list?purgeRunId=` 分页查看（3.62），不随本结构返回。

`MediaJobView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `mediaJobId` | string(uuid) | 是 | 任务 id | `media_job.id` |
| `kind` | enum | 是 | 16 个任务种类（06 分组 3.1） | `media_job.kind` |
| `provider`、`mode` | string、enum | 是 | 执行方；`local` / `remote` | `media_job.provider`、`mode` |
| `subject`、`parent` | object、object \| null | 是 | `{ type, id }` | `media_job.subject_type`、`subject_id`、`parent_type`、`parent_id` |
| `state` | enum | 是 | `queued` / `running` / `submitting` / `submitted` / `succeeded` / `failed` / `canceled` | `media_job.state` |
| `attemptNo`、`maxAttempts` | integer | 是 | 已尝试次数、上限 | `media_job.attempt_no`、`max_attempts` |
| `externalJobId` | string \| null | 是 | 外部任务号 | `media_job.external_job_id` |
| `error` | object \| null | 是 | `{ code, message, isRetryable }` | `media_job.error_code`、`error_message`、`is_retryable` |
| `nextRunAt`、`deadlineAt` | string(date-time) | 是 | 下次执行或回查时间；超时判定时间 | `media_job.next_run_at`、`deadline_at` |
| `billable` | object \| null | 是 | `{ qty: string, unit, estCostMicro: string(bigint) }`；`qty` 是三位小数的十进制字符串 | `media_job.billable_qty`、`billable_unit`、`est_cost_micro` |
| `startedAt`、`finishedAt` | string(date-time) \| null | 是 | | `media_job.started_at`、`finished_at` |
| `createdAt` | string(date-time) | 是 | | `media_job.created_at` |
| `actions` | array<enum> | 是 | `retry`（`failed` 且有 `media.job.retry`） | 计算 |

### 2.19 系统健康：`AlertView`、`InvariantRunView`、`InvariantViolationView`

`AlertView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `alertId` | string(uuid) | 是 | 告警 id | `alert_event.id` |
| `fingerprint`、`rule` | string | 是 | 指纹、规则键；规则的显示名与处置说明由前端按 `rule` 取契约登记 | `alert_event.fingerprint`、`rule` |
| `severity` | enum | 是 | `P1` / `P2` / `P3` | `alert_event.severity` |
| `kind` | enum | 是 | `probe` / `event` | `alert_event.kind` |
| `status` | enum | 是 | `open` / `acked` / `resolved` | `alert_event.status` |
| `firstSeenAt`、`lastSeenAt` | string(date-time) | 是 | 首次、最近发生 | `alert_event.first_seen_at`、`last_seen_at` |
| `resolvedAt` | string(date-time) \| null | 是 | 恢复时间 | `alert_event.resolved_at` |
| `occurrences` | integer | 是 | 未恢复期间累计次数 | `alert_event.occurrences` |
| `lastValue` | object \| null | 是 | 最近测量值或事件详情 | `alert_event.last_value` |
| `lastNotifiedAt`、`notifyCount` | string(date-time) \| null、integer | 是 | 最近通知、通知次数 | `alert_event.last_notified_at`、`notify_count` |
| `ackedBy` | object（`StaffBrief`）\| null | 是 | 认领人 | `alert_event.acked_by_staff_id` |
| `ackedAt` | string(date-time) \| null | 是 | 认领时间 | `alert_event.acked_at` |
| `note` | string \| null | 是 | 处理说明 | `alert_event.note` |
| `actions` | array<enum> | 是 | `acknowledge`（`open`）/ `resolve`（`open`、`acked`），需 `sys.health.manage` | 计算 |

`InvariantRunView`：`invariantRunId`（`invariant_run.id`）、`mode`（`quick` / `full`）、`trigger`（`schedule` / `deploy` / `drill` / `manual`）、`scope`（`{ since, entityIds, modules, codes }` 或 `null`）、`status`（`running` / `succeeded` / `failed`）、`startedAt`、`finishedAt`、`checksRun`、`violationsFound`、`error`，逐一取自 `invariant_run` 的同名蛇形列（`started_at`、`finished_at`、`checks_run`、`violations_found`）。

`InvariantViolationView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `invariantViolationId` | string(uuid) | 是 | 违规 id | `invariant_violation.id` |
| `invariantRunId` | string(uuid) \| null | 是 | 首次发现它的运行；经端口上报的为 `null` | `invariant_violation.invariant_run_id` |
| `code`、`module` | string、enum | 是 | 检查项编号（`billing.I3` 等）、登记模块（31 个，`x-open-enum`） | `invariant_violation.code`、`module` |
| `severity` | enum | 是 | `P1` 资金类 / `P2` 其他 | `invariant_violation.severity` |
| `subject` | object \| null | 是 | `{ type, id, key, label }`；全局性违规为 `null`，只用键表示的对象 `type` 为 `null`、`key` 非空 | `invariant_violation.subject_type`、`subject_id`、`subject_key`；`label` 由代码按类型取单号或名称 |
| `entityId` | string(uuid) \| null | 是 | 所属主体 | `invariant_violation.detail` 的 `entityId` |
| `detail` | object | 是 | 期望值、实际值、相关单据、自愈动作 | `invariant_violation.detail` |
| `firstSeenAt`、`lastSeenAt` | string(date-time) | 是 | | `invariant_violation.first_seen_at`、`last_seen_at` |
| `autoHealedAt` | string(date-time) \| null | 是 | 自愈时间（“是否已自愈”） | `invariant_violation.auto_healed_at` |
| `resolvedAt` | string(date-time) \| null | 是 | 处理时间；`null` 即未解决 | `invariant_violation.resolved_at` |
| `resolvedBy` | object（`StaffBrief`）\| null | 是 | 处理人；自动关闭为 `null` | `invariant_violation.resolved_by_staff_id` |
| `resolution` | string \| null | 是 | 处理结论；自动关闭为 `auto_healed` | `invariant_violation.resolution` |
| `actions` | array<enum> | 是 | `resolve`（未解决且观察者有对应权限点，见 3.76） | 计算 |

### 2.20 流程运维：`TimerView`、`OutboxDeliveryView`、`WebhookEventView`

`TimerView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `timerId` | string(uuid) | 是 | 定时器 id | `timer.id` |
| `kind` | string | 是 | 规则编码（如 `order.start`、`sla.breach`） | `timer.kind` |
| `subject` | object \| null | 是 | `{ type, id }`；周期任务行为 `null` | `timer.subject_type`、`subject_id` |
| `entityId`、`storeId` | string(uuid) \| null | 是 | | `timer.entity_id`、`store_id` |
| `fireAt`、`retryAt` | string(date-time)、string(date-time) \| null | 是 | 到期时间；失败后的下次重试 | `timer.fire_at`、`retry_at` |
| `dedupeKey` | string | 是 | 语义去重键 | `timer.dedupe_key` |
| `status` | enum | 是 | `scheduled` / `dispatched` / `fired` / `skipped` / `cancelled` / `failed` | `timer.status` |
| `attempts`、`dispatchNo` | integer | 是 | 失败次数、认领序号 | `timer.attempts`、`dispatch_no` |
| `leaseUntil`、`firedAt` | string(date-time) \| null | 是 | | `timer.lease_until`、`fired_at` |
| `lastError` | string \| null | 是 | 最近一次失败摘要 | `timer.last_error` |
| `payload`、`result` | object \| null | 是 | 参数快照、运行摘要 | `timer.payload`、`result` |
| `createdAt`、`updatedAt` | string(date-time) | 是 | | `timer.created_at`、`updated_at` |
| `actions` | array<enum> | 是 | `reschedule`、`cancel`（仅 `failed`，需 `flow.ops.manage`） | 计算 |

`OutboxDeliveryView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `outboxEventId` | string(uuid) | 是 | 事件 id | `outbox_delivery.outbox_event_id` |
| `subscriber` | string | 是 | 订阅者注册名 | `outbox_delivery.subscriber` |
| `status` | enum | 是 | `pending` / `leased` / `done` / `retry` / `dead` | `outbox_delivery.status` |
| `attempts`、`dispatchNo` | integer | 是 | | `outbox_delivery.attempts`、`dispatch_no` |
| `nextAttemptAt` | string(date-time) | 是 | | `outbox_delivery.next_attempt_at` |
| `leaseUntil`、`consumedAt` | string(date-time) \| null | 是 | | `outbox_delivery.lease_until`、`consumed_at` |
| `lastError` | string \| null | 是 | | `outbox_delivery.last_error` |
| `event` | object | 是 | `{ eventType, aggregateType, aggregateId, entityId, storeId, occurredAt, actorType, requestId }`；不返回负载 | `outbox_event.event_type`、`aggregate_type`、`aggregate_id`、`entity_id`、`store_id`、`occurred_at`、`actor_type`、`request_id` |
| `createdAt`、`updatedAt` | string(date-time) | 是 | | `outbox_delivery.created_at`、`updated_at` |
| `actions` | array<enum> | 是 | `retry`（`dead`，需 `flow.ops.manage`） | 计算 |

`WebhookEventView`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `webhookEventId` | string(uuid) | 是 | 收件 id | `webhook_event.id` |
| `provider` | enum | 是 | `wechatpay` / `wechat` / `wecom` / `ci` / `asr` / `sms` / `esign` | `webhook_event.provider` |
| `eventId`、`eventType` | string | 是 | 来源方事件标识与类型 | `webhook_event.event_id`、`event_type` |
| `mode` | enum | 是 | `inline` / `inbox` | `webhook_event.mode` |
| `processState` | enum | 是 | `received` / `processed` / `ignored` / `failed` / `dead` | `webhook_event.process_state` |
| `attempts` | integer | 是 | | `webhook_event.attempts` |
| `receivedAt` | string(date-time) | 是 | | `webhook_event.received_at` |
| `nextAttemptAt`、`processedAt` | string(date-time) \| null | 是 | | `webhook_event.next_attempt_at`、`processed_at` |
| `error` | string \| null | 是 | 最近一次失败摘要 | `webhook_event.error` |
| `summary` | object \| null | 是 | 载荷里长期保留的摘要（`payload.summary`），不含密文与 openid；其余载荷不返回 | `webhook_event.payload`（只取 `summary` 键） |
| `payloadPurgedAt` | string(date-time) \| null | 是 | 载荷清除时间 | `webhook_event.payload_purged_at` |
| `actions` | array<enum> | 是 | `retry`（`dead`，需 `flow.ops.manage`） | 计算 |

## 3. 接口

通用写法：后台全部非 GET 请求带 `X-LYX-Admin: 1` 并校验 `Origin`（C4），不符 403 `ORIGIN_REJECTED`；配置了访问面白名单时，白名单外的来源在鉴权之前就被 403 `IP_NOT_ALLOWED` 拒绝（C7）。下文“错误”一栏只列本接口有特殊含义的码。“回显”指 C54 的二次确认对象 `confirm`。

### 3.1 admin.auth.login　登录第一步

`POST /admin/auth/login`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public`；可带设备 Cookie `__Host-lyx_dev` 用于选桶 |
| 回显 | 无 |
| 幂等 | `none`：登录与换会话（A18） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（每 IP 10 次 / 分 + 账号分桶锁定，C68） |
| 对应画板 | 原型无：登录页（设计规范第 12 节） |
| 出处 | 路线图 `a01.auth.login`；d4-identity.md:999-1036、2287；d7-platform.md:1172-1183；C4 |

**请求**：路径参数、查询参数：无。请求体 `LoginBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `phone` | string | 是 | 11 位中国大陆手机号 | 登录手机号；服务端按盲索引取员工（`uq_staff_phone_bidx`） |
| `password` | string | 是 | 1–128 字符 | 不在日志与审计里出现 |

**响应**：`AuthNext`（2.4）。密码正确时：已绑定动态口令 → `next = mfa`，票据 5 分钟；尚未绑定（激活后没完成第 3 步）→ `next = enroll_totp`，票据 15 分钟，走 3.5。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_FAILED` | 401 | 账号不存在、未启用（`pending`、`disabled`）、待激活（没有密码）、该桶锁定中、密码错，一律同一个码、同一文案、相同耗时（d4-identity.md:1029-1030） |
| `IP_NOT_ALLOWED` | 403 | 后台访问面白名单拒绝；不触碰任何账号状态 |
| `RATE_LIMITED` | 429 | 按 IP 限流 |

**副作用**：密码错时在独立事务里给所选桶的失败数加 1（`staff.fail_trusted` 或 `staff.fail_untrusted`），满 5 次写 `staff.locked_until_*` = 现在 + 15 分钟；写 `auth_event`（`space = staff`，`event = login_fail` 或 `locked`，`method = password`，`detail.bucket`）。同一员工 `untrusted` 桶一天内被锁 3 次时经告警端口报出（03 分组 2.11）。密码正确时不写库（第二步成功才清零）。无状态迁移、无出站事件、无审计。

**说明**：选桶：带验签通过且员工 id 相符的设备 Cookie 走 `trusted` 桶，否则 `untrusted` 桶（d4-identity.md:1026-1028）。锁定中即使密码正确也返回 401。

### 3.2 admin.auth.verifyMfa　登录第二步

`POST /admin/auth/verify-mfa`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public`；持 `mfa` 票据 |
| 回显 | 无 |
| 幂等 | `none`：登录与换会话（A18） |
| 乐观锁 | 无 |
| 限流 | `admin.login` |
| 对应画板 | 原型无：登录页第二步 |
| 出处 | 路线图 `a01.auth.verify-mfa`（草案 `/admin/auth/mfa`）；d4-identity.md:1014-1018、1036；d7-platform.md:1178；C4 |

**请求**：请求体 `VerifyMfaBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `ticket` | string | 是 | 第 3.1 步给的 `mfa` 票据 | 5 分钟内有效 |
| `method` | enum | 是 | `totp` / `recovery` | 动态口令或恢复码 |
| `code` | string | 是 | `totp`：6 位数字；`recovery`：10 位字母数字（不区分大小写，可带连字符） | |

**响应**：`StaffMe`（2.3）；同时 `Set-Cookie: __Host-lyx_admin=…`（`HttpOnly; Secure; SameSite=Strict; Path=/`）与设备 Cookie `__Host-lyx_dev`（90 天）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_FAILED` | 401 | 票据无效或过期、动态口令错误或时间步不大于 `staff.totp_last_step`（重放）、恢复码不存在、桶锁定中、账号已不是启用状态；失败一律 401（C4） |
| `RATE_LIMITED` | 429 | 按 IP 限流 |

**副作用**（成功时同一事务）：插入 `staff_session`（`auth_method` = `password+totp` 或 `password+recovery`，`ip`、`user_agent`，`idle_expires_at` = 现在 + 60 分钟，`absolute_expires_at` = 现在 + 12 小时，`stepup_at` = 现在）；更新 `staff.totp_last_step`（动态口令）或从 `staff.recovery_codes` 移除用掉的那一个（恢复码）；两个失败桶清零（`fail_*` = 0，`locked_until_*` 置空）；写 `staff.last_login_at`、`staff.last_login_ip`；写 `auth_event`（`login_success`，`method` 同 `auth_method`，`detail.sessionId`）。失败时第二步的错误累加同一个桶（独立事务，规则同 3.1）。无状态迁移、无出站事件、无审计（登录记 `auth_event`，不进操作日志）。

**说明**：用恢复码登录后 `recoveryCodesLeft` 减少；少于 3 个时前端在用户菜单提示到“动态口令设置”重新绑定（3.86、3.87）。

### 3.3 admin.auth.activate　凭激活码换设置密码票据

`POST /admin/auth/activate`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public` |
| 回显 | 无 |
| 幂等 | `none`：登录前的激活，没有会话（C47） |
| 乐观锁 | 无 |
| 限流 | `admin.login` |
| 对应画板 | 原型无：激活页（d7-platform.md:1179） |
| 出处 | 路线图 `a01.auth.activate`；d4-identity.md:1046-1061、2287 |

**请求**：请求体 `ActivateBody`：`phone`（string，必填，11 位）、`activationCode`（string，必填，8 位数字字母，不区分大小写）。

**响应**：`AuthNext`，`next = set_password`，票据 15 分钟。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_FAILED` | 401 | 手机号不存在、员工不是 `active`、没有未用且未作废的激活码、码已过期、码错误、已错满 5 次；不区分原因 |
| `IP_NOT_ALLOWED` | 403 | 访问面白名单拒绝 |
| `RATE_LIMITED` | 429 | 按 IP 限流 |

**副作用**：码错误时 `staff_activation.attempts` 加 1，满 5 次写 `staff_activation.revoked_at`（作废）；成功时不改库（激活码在设置密码成功时才写 `used_at`）。无状态迁移、无出站事件、无审计。

**说明**：`pending` 与 `disabled` 的账号激活码无效（d4-identity.md:1056）。票据里带激活码行的 id，第 3.4 步据此标记已用。

### 3.4 admin.auth.setPassword　设置登录密码

`POST /admin/auth/set-password`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public`；持 `set_password` 票据 |
| 回显 | 无 |
| 幂等 | `none`：登录前的激活，没有会话（C47） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记） |
| 对应画板 | 原型无：激活页（首次改密） |
| 出处 | 路线图 `a01.auth.set-password`（草案 `POST /auth/password`）；d4-identity.md:997、1050-1059 |

**请求**：请求体 `SetPasswordBody`：`ticket`（string，必填）、`newPassword`（string，必填，1–128 字符；口令规则由服务端判，不合规回 `PASSWORD_POLICY_VIOLATED`）。

**响应**：`AuthNext`：`staff.totp_enrolled_at` 为空 → `next = enroll_totp`，新票据 15 分钟；已绑定过（重置密码、重新启用的情形）→ `next = login`，`ticket` 为 `null`，用新密码加原有动态口令走正常登录。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_TICKET_INVALID` | 401 | 票据无效、过期、用途不符，或票据对应的激活码已被用掉或作废、员工已不是 `active` |
| `PASSWORD_POLICY_VIOLATED` | 400 | 口令不合规：少于 10 位、不同时含字母与数字、包含手机号、在弱口令表里（d4-identity.md:997）；`details.rules` 列出未满足的规则 |

**副作用**（同一事务）：写 `staff.password_hash`（scrypt，哈希串自带参数）、`staff.password_changed_at`；`staff_activation.used_at` = 现在。写一条 `ops` 审计（类别 `account_security`，动作 `sys.staff.password_set`，操作人为该员工本人、`client = admin`、没有会话）。无状态迁移、无出站事件。

**说明**：这一步不建会话。已绑定动态口令的账号，激活码只能用来设置密码，要换验证器必须由超级管理员显式“重置第二因子”（d4-identity.md:1059）。

### 3.5 admin.auth.enrollTotp　生成动态口令密钥

`POST /admin/auth/enroll-totp`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public`；持 `enroll_totp` 票据 |
| 回显 | 无 |
| 幂等 | `none`：登录前的首次绑定，没有会话（C47） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记） |
| 对应画板 | 原型无：激活页“绑定动态口令” |
| 出处 | 路线图 `a01.auth.enroll-totp`（草案 `POST /auth/totp/enroll`）；d4-identity.md:1053-1054；design-spec.md:904 |

**请求**：请求体 `EnrollTotpBody`：`ticket`（string，必填）。

**响应**：`TotpEnrollment`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `otpauthUri` | string | 是 | `otpauth://totp/狸有戏:<手机号脱敏串>?secret=…&issuer=狸有戏&digits=6&period=30`，前端渲染为二维码 | 计算（密钥明文只在本响应出现） |
| `secret` | string | 是 | Base32 密钥，供无法扫码时手输 | 同上 |
| `ticket` | string | 是 | 同一张 `enroll_totp` 票据（续期到 15 分钟），确认时回传 | 计算 |
| `ticketExpiresAt` | string(date-time) | 是 | | 计算 |

`Cache-Control: no-store`（C18）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_TICKET_INVALID` | 401 | 票据无效、过期或用途不符 |
| `TOTP_ALREADY_ENROLLED` | 409 | `staff.totp_enrolled_at` 已非空（d4-identity.md:1053） |

**副作用**：写 `staff.totp_pending_secret_enc`（独立的 MFA 密钥加密）、`staff.totp_pending_at`；重复调用覆盖上一次的待确认密钥。超时未确认的由清理任务清空。无状态迁移、无出站事件、无审计。

### 3.6 admin.auth.confirmTotp　确认绑定并建会话

`POST /admin/auth/confirm-totp`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `public`；持 `enroll_totp` 票据 |
| 回显 | 无 |
| 幂等 | `none`：首次绑定并换会话（C47） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记） |
| 对应画板 | 原型无：激活页“绑定动态口令”（展示恢复码） |
| 出处 | 路线图 `a01.auth.confirm-totp`（草案 `POST /auth/totp/confirm`）；d4-identity.md:1055 |

**请求**：请求体 `ConfirmTotpBody`：`ticket`（string，必填）、`code`（string，必填，6 位数字，用第 3.5 步的密钥算出）。

**响应**：`TotpConfirmResult` = `{ me: StaffMe, recoveryCodes: array<string> }`：`recoveryCodes` 为 10 个一次性恢复码明文，只出现这一次（库里只存 sha256），前端要求员工下载或抄写后才能继续。同时 `Set-Cookie` 会话与设备 Cookie（同 3.2）；`Cache-Control: no-store`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `AUTH_TICKET_INVALID` | 401 | 票据无效、过期，或没有待确认的密钥（`staff.totp_pending_secret_enc` 为空） |
| `MFA_CODE_INVALID` | 400 | 动态口令与待确认密钥对不上；票据仍有效，可重输 |
| `TOTP_ALREADY_ENROLLED` | 409 | 已绑定（并发确认） |

**副作用**（同一事务）：`staff.totp_secret_enc` ← 待确认密钥，`staff.totp_enrolled_at` = 现在，清空 `totp_pending_*`，写 `staff.totp_last_step`；`staff.recovery_codes` = 10 个恢复码的 sha256；插入 `staff_session`（`auth_method = password+totp`，`stepup_at` = 现在）；写 `staff.last_login_at`、`last_login_ip`；写 `auth_event`（`login_success`，`method = password+totp`）；写一条 `ops` 审计（类别 `account_security`，动作 `sys.staff.totp_enrolled`）。无状态迁移、无出站事件。

**说明**：用户菜单的“动态口令设置”不复用本接口与 3.5：按 A60 另设凭会话、要求再验证的接口（3.86、3.87），本接口只服务首次绑定与重置第二因子后的重新绑定。

### 3.7 admin.auth.stepUp　再验证

`POST /admin/auth/step-up`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人） |
| 回显 | 无 |
| 幂等 | `none`：再验证，归入登录与换会话一类（C47） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记；会话内按会话计数，防止穷举动态口令） |
| 对应画板 | 原型无：全局再验证弹层；在 A:Refunds、A:Receipts、A:CreditAdjust、A:SysStaff、A:SysRoles、A:Reconcile 等敏感操作处出现 |
| 出处 | 路线图 `a01.auth.step-up`；d4-identity.md:1376、2288；d7-platform.md:1111、1180；C66 |

**请求**：请求体 `StepUpBody`：`method`（enum，必填，`totp` / `recovery`）、`code`（string，必填，格式同 3.2）。

**响应**：`StepUpResult` = `{ stepUpValidUntil: string(date-time) }`（= 现在 + 10 分钟）。前端拿到后用原幂等键重放被拦下的请求（C48）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `MFA_CODE_INVALID` | 400 | 动态口令错误、时间步重放、恢复码不存在；不吊销会话，不计入登录失败桶 |
| `RATE_LIMITED` | 429 | 同一会话短时间内反复失败 |

**副作用**：成功时写 `staff_session.stepup_at` = 现在、`staff.totp_last_step` 或移除用掉的恢复码；写 `auth_event`（`step_up`，`method = totp` 或 `recovery`）。无状态迁移、无出站事件、无审计。

**说明**：同一个 30 秒时间步内的码不能复用（`totp_last_step` 严格递增），所以登录本身算一次验证（`stepup_at` = 登录时刻，d4-identity.md:1036）。并发请求共用同一个再验证弹层（C20）。

### 3.8 admin.auth.me.get　当前员工

`GET /admin/auth/me`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；无权限点 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:Main（顶栏与菜单）；原型无：登录页、用户菜单、无权限页、404 页（设计规范第 12 节） |
| 出处 | 路线图 `a01.auth.me`；d7-platform.md:1083-1105；d4-identity.md:1081、2288；proto-admin-e.md:310 |

**请求**：无。

**响应**：`StaffMe`（2.3）。

**错误**：无（未登录、会话失效按通用码 401 `AUTH_REQUIRED` / `SESSION_INVALID`，前端记住当前地址回登录页）。

**副作用**：无（会话的 `last_seen_at`、`idle_expires_at` 由鉴权中间件按“距上次更新超过 60 秒才写”的规则续写，不属于本接口，C4）。

**说明**：全部后台页面进入时取一次；角色或权限被改后“员工刷新页面后生效”（proto-admin-e.md:308），服务端每请求从库里取角色与权限（进程内缓存 5 秒）。

### 3.9 admin.auth.changePassword　修改本人密码

`POST /admin/auth/change-password`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；无权限点 |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：用户菜单“修改密码”（设计规范第 12 节） |
| 出处 | 路线图 `a01.auth.change-password`；d4-identity.md:997、2288 |

**请求**：请求体 `ChangePasswordBody`：`currentPassword`（string，必填）、`newPassword`（string，必填，10–128 字符，规则同 3.4，且不得与当前密码相同）。

**响应**：`data = null`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `PASSWORD_INCORRECT` | 400 | 当前密码不对；连续错 5 次按 `untrusted` 桶锁定登录（与登录同一套计数） |
| `PASSWORD_POLICY_VIOLATED` | 400 | 新密码不合规，或与当前密码相同（`details.rules` 含 `same_as_current`） |

**副作用**（同一事务）：写 `staff.password_hash`、`staff.password_changed_at`；吊销本人的其他会话（`staff_session.revoked_at`，`revoke_reason = password_reset`，当前会话保留，与商家端换绑手机号同一口径，A81）；写一条 `ops` 审计（类别 `account_security`，动作 `sys.staff.password_change`）。无状态迁移、无出站事件。

### 3.10 admin.auth.bindWecom　本人绑定企业微信

`POST /admin/auth/bind-wecom`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；无权限点 |
| 回显 | 无 |
| 幂等 | `required`；扫码分支是三段式用例（C51，先调外部、再开事务）：占用 `in_progress` → 事务外用 `code` 向企业微信换 `userid` → 事务内写库并写幂等记录；换 `userid` 失败不落库，可用同一个键重试。手填分支不调外部 |
| 乐观锁 | 无（本人改本人的绑定，后写覆盖） |
| 限流 | `admin.global` |
| 开关 | `admin.wecom_web_login.enabled`（A103，服务端开关，默认关，`exposed_to = client`，前端据 `StaffMe.flags` 选分支）：关闭时只收手填的 `wecomUserid`（V1.0 默认做法）；打开时只收扫码得到的 `code` |
| 对应画板 | 原型无：用户菜单 / 个人设置“绑定企业微信”；A:SysStaff 的“邀请”（3.24）引导员工来这里 |
| 出处 | 路线图 `a01.auth.bind-wecom`；d4-identity.md:1065-1072、2288；03-staff-authz-audit.md:166；A103 |

**请求**：请求体 `BindWecomSelfBody`，二选一（按开关）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `wecomUserid` | string | 开关关闭时必填 | 1–64 字符，企业微信通讯录里的成员账号 | 员工本人手填的企业微信账号 → `staff.wecom_userid` |
| `code` | string | 开关打开时必填 | 1–128 字符 | 企业微信内嵌扫码面板回调带回的一次性 code |

**响应**：`StaffWecom` = `{ status, userid, boundAt, qrFileId, qrUrl }`（同 `StaffDetail.wecom`）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `FEATURE_DISABLED` | 403 | 开关关闭却带了 `code` |
| `VALIDATION_FAILED` | 400 | 开关打开却带了 `wecomUserid`，或两者都没带、都带了 |
| `WECOM_CODE_INVALID` | 400 | `code` 无效、过期或已用过 |
| `WECOM_USERID_TAKEN` | 409 | 该 `userid` 绑定在另一名**启用**员工上；`details` 带对方 `staffId`、姓名、状态。本人不能抢绑，由超级管理员在 3.25 处理 |
| `PROVIDER_UNAVAILABLE` | 503 | 企业微信接口不可用或超时（扫码分支） |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 扫码分支的三段式用例处理中 |

**副作用**（同一事务）：

- 该 `userid` 当前挂在一名**不是启用状态**的员工上（禁用或待启用；禁用与解绑都保留 `wecom_userid`，`uq_staff_wecom_userid` 仍生效）时，先清空旧员工的 `wecom_userid`，旧员工是 `bound` 的改为 `unbound`，其余状态不变（03-staff-authz-audit.md:166 的“先清空旧员工的值”）；审计 `meta.takeOverFromStaffId` 记旧员工。
- 写本人的 `staff.wecom_userid`、`staff.wecom_bind_status = bound`、`staff.wecom_bound_at`；本人原已绑定另一个账号时直接替换（审计 `before` / `after` 记新旧值）。
- 写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.wecom_bind`，`meta.method` 为 `manual` 或 `scan`）。无状态迁移、无出站事件。

**说明**：手填的账号系统无法核验，超级管理员可在 A:SysStaff 用 3.25 改正（是否要先核对再生效见待确认 4）。

### 3.11 admin.session.current.delete　退出登录

`DELETE /admin/sessions/current`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；无权限点 |
| 回显 | 无 |
| 幂等 | `none`：退出登录（A43；C47）；重复退出无副作用，端上把 401 当作已退出 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：用户菜单“退出登录” |
| 出处 | 路线图 `a01.auth.logout`（初稿 `POST /admin/auth/logout`）；d4-identity.md:2288；A41、A43、A82；C4、C12 |

**请求**：无。

**响应**：`data = null`；`Set-Cookie` 清除会话 Cookie（设备 Cookie 保留）。

**错误**：无。会话已失效时返回 401，前端同样跳登录页。

**副作用**：`staff_session.revoked_at` = 现在、`revoke_reason = logout`；写 `auth_event`（`logout`）。无状态迁移、无出站事件、无审计。

**说明**：`/admin/sessions/current` 是“当前会话”视图别名（A41），`DELETE` 合规（A7：退出当前会话）。初稿的 `POST /admin/auth/logout` 不再保留。

### 3.12 admin.staff.list　员工列表与选人下拉

`GET /admin/staff`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：调用方 `system ≥ v` 时返回完整列表。否则是选人模式：必须带 `pool` 或 `recommendPool`，且对所带的每个池都有读权，只返回这些池内启用的成员，`phoneMask` 为 `null`。池的读权：`delivery_manager` 要 `merchant.manager.assign` 或 `merchant.manager.transfer`，或（只读，供客服工单的分配与转派列出交付经理，a08）`service.ticket.assign` 或 `service.ticket.transfer`；`editor` 要 `delivery.ticket.assign_editor` 或 `delivery.ad.assign`；`publisher` 要 `delivery.ticket.assign_publisher`；`cs` 要 `service.ticket.assign` 或 `service.ticket.transfer`。都不满足 403 `PERMISSION_DENIED` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff（员工表）；选人下拉：A:Tickets、A:TicketDetail、A:AdTasks、A:MerchantDetail（转移交付经理）、A:Service、A:ServiceDetail |
| 出处 | 路线图 `a01.staff.list`；proto-admin-e.md:249-262；d4-identity.md:2289；proto-admin-a.md:125；proto-admin-b.md:94；proto-admin-c.md:371、418 |

**请求**：查询参数 `StaffListQuery`（C43–C45）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `q` | string | 否 | 1–20 字符 | 4 位数字时按手机号后 4 位精确匹配（`staff.phone_last4`），否则按姓名包含 |
| `roleKey` | enum | 否 | 可多值 | 角色 |
| `status` | enum | 否 | 可多值 | `pending` / `active` / `disabled` |
| `isLead` | boolean | 否 | | 主管 |
| `staffGroupId` | string(uuid) | 否 | | 分组 |
| `pool` | enum | 否 | 可多值（如客服工单转派传 `cs,delivery_manager`） | 只看这些分配池的成员 |
| `withLoad` | boolean | 否 | 默认 `false`；为真时 `pageSize` 上限 50 | 计算在办量 `openWorkCount`、`openWorkBySource` |
| `recommendPool` | enum | 否 | | 选人下拉：池名；带它时结果限于该池的启用、当班成员，并标出轮询的下一位（`isRecommended`） |
| `recommendCityCode` | string | 否 | `recommendPool = delivery_manager` 时必填 | 交付经理池按城市轮询（门店所在市的行政区划编码） |
| `page`、`pageSize` | integer | 否 | | 分页 |
| `sort` | enum | 否 | `staffNo`（默认）、`-lastLoginAt`、`openWorkCount`（需 `withLoad`） | 排序 |

**响应**：`AdminPage<StaffListItem>`（2.5）。

**错误**：`PERMISSION_DENIED`（403）：没有 `system ≥ v`，又没带 `pool` / `recommendPool`，或对所带的某个池没有读权。

**副作用**：无（推荐只读游标，不加锁、不推进）。

**说明**：路线图写的 `recommendFor`（工单或广告 id）改为 `recommendPool` + `recommendCityCode`：候选池与城市由调用页面的上下文决定，员工模块不读工单、广告（L1 不引用 L3）；a05 的指派弹层按此改传参数。真正分配时由业务接口在事务里调用 `pickNext`，推荐与实际结果可能不同（并发）。各选人弹层的负载取 `openWorkBySource` 里对应的一项（2.5），不用合计 `openWorkCount`。转移交付经理弹层（a03）按 `pool=delivery_manager&withLoad=true` 取候选与“进行中 N 单”。页头“共 N 个账号 · 启用 N · 待启用 N · 已禁用 N”由 `admin.staff.summary`（3.88）提供，本接口不返回计数（A23）。

### 3.13 admin.staff.get　员工详情

`GET /admin/staff/{staffId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v`；无权限点 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff（编辑弹层回显、行内信息） |
| 出处 | 路线图 `a01.staff.get`；d4-identity.md:2289 |

**请求**：路径参数 `staffId`（uuid）。

**响应**：`StaffDetail`（2.5）。

**错误**：`NOT_FOUND`（404）。

**副作用**：无。

### 3.14 admin.staff.create　新增员工

`POST /admin/staff`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage`（仅超级管理员） |
| 回显 | 无 |
| 幂等 | `required`；结果脱敏（A80）：`x-redact-on-replay: ['activation.activationCode']`，重放带 `replayed: true`（2.7） |
| 乐观锁 | 无（新建） |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff“新增员工”弹层（角色下拉含“渠道运营（V1.1）”；新建的渠道运营行显示“待启用 · V1.1 开放后启用”，SysStaff.dc.html:91、164） |
| 出处 | 路线图 `a01.staff.create`；03-staff-authz-audit.md:218-219；d4-identity.md:1042-1044；proto-admin-e.md:258；design-spec.md:857 |

**请求**：请求体 `StaffCreateBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 1–10 字 | 姓名 → `staff.name` |
| `phone` | string | 是 | 11 位中国大陆手机号 | 登录手机号 → `staff.phone_enc`、`phone_bidx`、`phone_mask`、`phone_last4` |
| `roleKey` | enum | 是 | 8 个角色之一；角色尚未开放（`staff_role.available_from = v1.1` 且对应开关关闭，渠道运营对应 `release.partner`）时只能 `activateNow = false` | 角色 → `staff.staff_role_key` |
| `isLead` | boolean | 否 | 默认 `false` | 主管 → `staff.is_lead` |
| `staffGroupId` | string(uuid) | 否 | 必须属于 `roleKey` 的分组 | 缺省进该角色的默认组 → `staff.staff_group_id` |
| `activateNow` | boolean | 是 | | `true` 立即启用并生成激活码；`false` 暂不启用（`pending`） |
| `activationDelivery` | enum | 否 | `sms`（默认）/ `manual` | 激活码下发方式；短信通道关闭（`notify.sms.enabled = false`）时服务端改为 `manual` |
| `inviteWecom` | boolean | 否 | 默认 `false`；`activateNow = false` 时忽略 | 创建后提醒员工绑定企业微信（同 3.24；开关 `admin.wecom_web_login.enabled` 关闭时引导员工在用户菜单手填账号，打开时引导扫码，3.10） |
| `displayName`、`servicePhone` | string | 否 | 称呼 ≤10 字；电话 ≤20 字符，数字与 `-` | 对商家展示的称呼与服务电话（交付经理用）→ `staff.display_name`、`staff.service_phone` |

**响应**：`StaffMutationResult`（2.7）；`activateNow = false` 时 `activation` 为 `null`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STAFF_PHONE_TAKEN` | 409 | 手机号已被其他员工使用（`uq_staff_phone_bidx`） |
| `VALIDATION_FAILED` | 400 | 分组不属于该角色等 |
| `STATE_NOT_ALLOWED` | 409 | 角色尚未开放却要求 `activateNow = true`；`details = { reason: 'role_not_available', roleKey, availableFrom }` |

**副作用**（同一事务）：

- 插入 `staff`（`staff_no` 取序列，`password_hash` 为空，`created_by_staff_id` = 操作人）；迁移经 `flow.transition()`，状态机 `staff`：`staff.status: (新建) → active（待激活）`（`activateNow = true`）或 `staff.status: (新建) → pending`（03-staff-authz-audit.md:218-219），写 `status_transition`。
- `activateNow = true` 时插入 `staff_activation`（`purpose = activate`，`delivery`，`expires_at` = 现在 + 24 小时，`code_hash`）。
- 写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.create`，`after` 为姓名、角色、主管、手机号脱敏串）。
- 出站事件：`staff.created`（迁移事件）。
- 激活码短信不经出站事件（事件行不清理，载荷不能放明文，库里只有哈希）：`delivery = sms` 时由用例在事务提交后调 `notify.sendDirect`（`purpose = staff_activation`，`direct_key = staff_act:{staffActivationId}`，与验证码同法，M94；x01 待确认 2）；发送失败由超级管理员重新生成激活码线下转交（3.22）。
- `inviteWecom = true` 且 `activateNow = true` 时同事务置 `wecom_bind_status = invited`，提交后提醒同 3.24（员工激活登录后在用户菜单完成绑定）。

**说明**：手机号只用于登录，短信只下发激活码，首次登录绑定动态口令；原型“初始密码通过短信发送”“用于登录与二次验证”按设计规范第 11 节改文案。

### 3.15 admin.staff.update　编辑员工

`PATCH /admin/staff/{staffId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage`（仅超级管理员） |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 带 `lockVersion`（`staff.lock_version`，A21） |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff“编辑员工”弹层 |
| 出处 | 路线图 `a01.staff.update`；d4-identity.md:1111-1119；proto-admin-e.md:259 |

**请求**：路径参数 `staffId`。请求体 `StaffUpdateBody`（不传 = 不改，C38）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | 否 | 1–10 字 | → `staff.name` |
| `roleKey` | enum | 否 | | → `staff.staff_role_key` |
| `isLead` | boolean | 否 | | → `staff.is_lead` |
| `staffGroupId` | string(uuid) | 否 | 必须属于（新）角色 | → `staff.staff_group_id`；改角色而不传时换到新角色的默认组（`staff.I3`） |
| `displayName` | string \| null | 否 | ≤10 字 | → `staff.display_name` |
| `servicePhone` | string \| null | 否 | ≤20 字符 | → `staff.service_phone` |
| `wecomQrFileId` | string(uuid) \| null | 否 | 已入库、分类 `wecom_qr` 的文件 | 企业微信“联系我”二维码（人工上传兜底）→ `staff.wecom_qr_file_id` |
| `ackNoLead` | boolean | 否 | | 取消主管或把主管调离本组、导致该组没有启用主管时必须为真 |
| `lockVersion` | integer | 是 | | |

手机号不可改（proto-admin-e.md:259）。

**响应**：`StaffDetail`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `OPEN_WORK_EXISTS` | 409 | 改角色时名下还有在办事项，须先移交（3.19）；`details.openWork` 为各来源的数量 |
| `SELF_OPERATION_FORBIDDEN` | 409 | 改自己的角色 |
| `LAST_SUPER_ADMIN` | 409 | 把最后一位启用的超级管理员改成别的角色 |
| `LEAD_REMOVAL_ACK_REQUIRED` | 409 | 改动后该组没有启用主管且没带 `ackNoLead`；界面提示“该组将没有主管：组内待审批的申请改由超级管理员处理，待分配的门店与任务只有超级管理员可见” |
| `VERSION_CONFLICT` | 409 | `lockVersion` 不符 |
| `FILE_NOT_USABLE` | 400 | `wecomQrFileId` 未入库或分类不符（m03 定义） |
| `VALIDATION_FAILED` | 400 | 分组与角色不符等 |

**副作用**（同一事务，先锁员工行 `FOR NO KEY UPDATE`）：更新 `staff` 的上述列，`lock_version + 1`；改角色时删除该员工在旧角色池里的 `assignment_pool_member` 行（`staff.I9`）；换二维码时 `files.link()` 登记新文件引用（`file_ref`，`ref_type = staff`，角色 `wecom_qr`）、释放旧引用；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.update`，`before` / `after` 为变化的字段；带 `ackNoLead` 时记入 `meta`）。无状态迁移、无出站事件。

**说明**：权限在员工下次刷新页面时生效，不吊销会话（proto-admin-e.md:259）。本人作为发起人的在途审批不随角色变化移交（d4-identity.md:1119）。

### 3.16 admin.staff.enable　启用员工

`POST /admin/staff/{staffId}/enable`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移，A17）；结果脱敏 `x-redact-on-replay: ['activation.activationCode']`（A80） |
| 乐观锁 | 无（守卫未列 `lock_version`，C53） |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff“启用”（待启用 → 启用时“登录信息已通过短信发送”） |
| 出处 | 路线图 `a01.staff.enable`；03-staff-authz-audit.md:220、222、224；d4-identity.md:1128-1133 |

**请求**：路径参数 `staffId`。请求体 `ActivationDeliveryBody`：`activationDelivery`（enum，选填，`sms` 默认 / `manual`）。

**响应**：`StaffMutationResult`。

**错误**：`STATE_NOT_ALLOWED`（409）：员工已是 `active`；或员工的角色尚未开放（`staff_role.available_from = v1.1` 且对应开关关闭，如渠道运营在 `release.partner` 打开前），`details = { reason: 'role_not_available', roleKey, availableFrom }`，页面行内显示“V1.1 开放后启用”。

**副作用**（同一事务）：

- `staff.status: pending → active（待激活）` 或 `staff.status: disabled → active（待激活）`（03-staff-authz-audit.md:220、222），经 `flow.transition()` 写 `status_transition`。
- 从 `disabled` 启用时：清空 `disabled_at`、`disabled_reason`、`disabled_by_staff_id`、`handover_to_staff_id`；`password_hash` 置空（重新启用一律重置密码），TOTP 保留；两个失败桶清零（d4-identity.md:1130）。分配池不恢复，需要时用 3.26 重新设置。
- 作废旧的未用激活码（`revoked_at`），插入新的 `staff_activation`（`purpose = activate`）。
- 写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.enable`）。
- 出站事件：`staff.enabled`；`delivery = sms` 时提交后经 `notify.sendDirect` 下发激活码（同 3.14）。

### 3.17 admin.staff.disable　禁用员工

`POST /admin/staff/{staffId}/disable`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.secure_ops`（A46，注册表标再验证，窗口外 403 `STEP_UP_REQUIRED`） |
| 回显 | `confirm: { staffNo, openWorkCount }`：工号与弹层上显示的在办事项数，与事务内的当前值比对（C54） |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无（守卫未列 `lock_version`） |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff“禁用”弹层（在办事项、移交给、禁用原因） |
| 出处 | 路线图 `a01.staff.disable`；03-staff-authz-audit.md:221、224；d4-identity.md:1096-1107；d3-flow.md:3537；proto-admin-e.md:262 |

**请求**：路径参数 `staffId`。请求体 `StaffDisableBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `handoverToStaffId` | string(uuid) | 有在办事项时必填 | 同角色、`active`、不是本人 | 接收人 → `staff.handover_to_staff_id` |
| `reason` | enum | 是 | `resigned` / `reassigned` / `long_leave` / `other` | → `staff.disabled_reason`；也是改派记录的 `assignment_history.reason_code` |
| `note` | string | 否 | ≤200 字；`reason = other` 时必填 | 交接说明 → `assignment_history.note`、审计 `reason_text` |
| `confirm` | object | 是 | `{ staffNo: integer, openWorkCount: integer }` | 二次确认回显 |

**响应**：`HandoverResult`（2.7）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `CANNOT_DISABLE_SELF` | 409 | 禁用当前登录账号 |
| `LAST_SUPER_ADMIN` | 409 | 最后一位启用的超级管理员 |
| `NO_HANDOVER_CANDIDATE` | 409 | 有在办事项，但没有同角色的启用员工可接（“请先新增一名 <角色>，再禁用”） |
| `ASSIGNEE_INVALID` | 409 | 接收人不是启用状态（`not_active`）、不是同角色（`role_mismatch`），或是被禁用的员工本人（`same_as_current`）；`details = { staffId, reason }`，`reason` 取 a05 的 `AssigneeInvalidReason`（`x-open-enum`；`out_of_scope` 在这里不会出现：`sys.staff.manage` 仅超级管理员，数据范围为全部）（a05 定义，A77；取代初稿的同义码 48011） |
| `CONFIRM_MISMATCH` | 409 | 回显的工号或在办事项数与当前值不一致 |
| `STATE_NOT_ALLOWED` | 409 | 员工不是 `active` |

**副作用**（单事务，按 id 升序对本人与接收人 `FOR NO KEY UPDATE`，d4-identity.md:1099）：

- 依次调用各在办来源注册的 `reassign`（d3-flow.md 第 24.1 节），每个被改的对象写一行 `assignment_history`（同一个 `batch_id`，`reason_code` = 请求的 `reason`，`note`，`actor_type = staff`，`actor_id` = 操作人，`client = admin`）：
  - 门店交付经理（`source = store_manager`）：该员工负责的每家门店改 `store.delivery_manager_id`（`subject_type = store`）；同一事务把这些门店里交付经理是该员工的未结订购单（`drama_order.status` 不在 `ended`、`cancelled`、`refunded`）的 `drama_order.delivery_manager_id` 改为接收人（`subject_type = drama_order`，09-order-ad.md:218-219）；把交付经理是该员工的未归档、未终止的交付工单（`delivery_ticket.step` 不是 `archived`、`terminated`）的 `delivery_ticket.delivery_manager_id` 改为接收人（`subject_type = delivery_ticket`，10-delivery.md:1261）。已归档的工单、已结束的订购单保留原交付经理。联系时限只放在门店那一行：带 `contact_due_at` 与 `sla_snapshot`（`sla.manager.first_contact`），登记定时器（`kind = sla.breach`，`subject_type = assignment_history`，去重键 `sla.breach:assignment_history:{assignmentHistoryId}`，x01 4.1）；同一门店此前未联系、未作废的行写 `contact_voided_at` 并取消其定时器（先作废再写新行，03 分组 2.8）。订购单、工单的行不带联系时限。这样“未结订购单的交付经理与门店一致”（09 分组不变量）在同一事务内成立，接收人按这两列过滤的数据范围也立即生效。
  - 工单剪辑师、发布专员（`ticket_editor`、`ticket_publisher`）：未归档、未终止的工单，或已终止但名下还有未核查下架任务的工单，改 `delivery_ticket.editor_id` / `publisher_id`。链接核验单、巡检与下架任务不存处理人，随工单一并移交（读取时取工单的发布专员，2.10 的 `handler`）。
  - 广告剪辑师（`ad_editor`）：`ad.status` 在 `producing`、`revising`、`pending_confirm`、`returned` 的广告改 `ad.editor_id`。
  - 客服工单负责人（`service_ticket_owner`）：未结工单改 `service_ticket.owner_staff_id`；客服模块注册的改派实现同时经 `flow.transition()` 写一行 `service_ticket.status` 不变的 `transfer` 迁移（from = to，12-support.md:160、168）：`reason_code` 取本批 `assignment_history.reason_code`（12-support.md:419），`payload` 带原负责人、新负责人及其岗位与 `assignmentBatchId`，并追加时间线条目 `system_event` / `transfer`（有 `note` 时另加 `internal_note` / `transfer`）。
  - 跟进提醒（`follow_up_owner`）：在办的行（`next_follow_at` 非空且 `done_at` 为空）改 `follow_up.owner_staff_id`，`lock_version + 1`。
- `staff.status: active → disabled`（03-staff-authz-audit.md:221），经 `flow.transition()` 写 `status_transition`；写 `disabled_at`、`disabled_reason`、`disabled_by_staff_id`、`handover_to_staff_id`；`wecom_bind_status = unbound`（保留 `wecom_userid`）。
- 吊销全部会话：`staff_session.revoked_at` = 现在、`revoke_reason = disabled`。
- 删除该员工的全部 `assignment_pool_member` 行；作废未用的激活码（`staff_activation.revoked_at`）。
- 写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.disable`，`meta.impact` 为按来源的改派数量，`meta.batchId`）。
- 出站事件（事件名与载荷按 x01）：`staff.disabled`（载荷 `handoverBatchId`）；有改派时 `assignment.transferred`（每批一条，`aggregate_id` 取该批 `seq` 最小的一行，`dedupe_key = assignment.transferred:{batchId}`，载荷带 `batchId`、`countsBySource`、`toStaffId`、`reasonCode`），通知中心据此通知接收人与换了服务经理的商家；每张被改派的客服工单另有 `service_ticket.transferred`（上面 `transfer` 迁移的事件，x01 的 E1 与第 3.12 节）。接收人因同一批移交收到两类通知的合并，已请 x01 与通知中心按 `assignmentBatchId` 处理。

**说明**：不移交的：已归档的工单与历史记录；该员工作为发起人的在途审批（发起人保留原值，可由有决定权的人代为撤回，A15）；按权限点进入角色队列的审批（d3-flow.md:3124）。在办事项的统计与列举见 3.18。

### 3.18 admin.staff.openWork.get　名下在办事项

`GET /admin/staff/{staffId}/open-work`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage`（d4-identity.md:2289 把它归入该权限点） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff 禁用弹层与移交弹层的“在办事项” |
| 出处 | 路线图 `a01.staff.open-work`（d3 写作 `handover-preview`，取 d4 的名字）；d4-identity.md:1089-1093 |

**请求**：路径参数 `staffId`。

**响应**：`OpenWorkSummary`（2.6）。

**错误**：`NOT_FOUND`（404）。

**副作用**：无。

### 3.19 admin.staff.handover　只移交不禁用

`POST /admin/staff/{staffId}/handover`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff 行的“更多 › 移交在办事项”（原型无单独入口，建议放在这里） |
| 出处 | 路线图 `a01.staff.handover`；d4-identity.md:1109；03-staff-authz-audit.md:420 |

**请求**：路径参数 `staffId`。请求体 `HandoverBody`：`handoverToStaffId`（uuid，必填，同角色、`active`、不是本人）、`reason`（enum，必填，`reassigned` / `long_leave` / `other`）、`note`（string，选填，≤200 字；`other` 时必填）。

**响应**：`HandoverResult`；没有在办事项时 `batchId` 为 `null`、`moved` 为 `[]`（不报错）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `ASSIGNEE_INVALID` | 409 | 接收人不合规；`details = { staffId, reason }`，`reason` 同 3.17（`AssigneeInvalidReason`，a05 定义） |
| `NO_HANDOVER_CANDIDATE` | 409 | 没有可接的同角色启用员工 |
| `STATE_NOT_ALLOWED` | 409 | 员工不是 `active` |

**副作用**（单事务，锁序同 3.17）：同 3.17 的改派部分，逐来源照做（门店、未结订购单、未归档未终止工单的交付经理三处同时改；联系时限只放门店那一行；客服工单写 `transfer` 迁移），并写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.handover`，`meta.impact`、`meta.batchId`）；出站事件 `assignment.transferred`（每批一条）与每张客服工单的 `service_ticket.transferred`。不改员工状态、不吊销会话、不动分配池。

**说明**：用于改角色前的清场与长期休假（d4-identity.md:1109）；要让该员工不再接新任务，另用 3.26 把他移出分配池。

### 3.20 admin.staff.resetPassword　重置登录密码

`POST /admin/staff/{staffId}/reset-password`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.secure_ops`（A46，要再验证） |
| 回显 | `confirm: { staffNo }` |
| 幂等 | `required`；结果脱敏 `x-redact-on-replay: ['activation.activationCode']`，重放带 `replayed: true`（A80） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff“重置密码”确认弹层（“原密码立即失效，重置码通过短信发送”） |
| 出处 | 路线图 `a01.staff.reset-password`；d4-identity.md:1063；proto-admin-e.md:261 |

**请求**：路径参数 `staffId`。请求体 `StaffSecureOpBody`：`confirm`（object，必填，`{ staffNo }`）、`activationDelivery`（enum，选填）、`note`（string，选填，≤200 字）。

**响应**：`StaffMutationResult`（`activation.purpose = reset_password`）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `SELF_OPERATION_FORBIDDEN` | 409 | 重置自己（自己改密码走 3.9） |
| `CONFIRM_MISMATCH` | 409 | 工号不符 |
| `STATE_NOT_ALLOWED` | 409 | 员工不是 `active` |

**副作用**（同一事务）：`staff.password_hash` 置空；吊销全部会话（`revoke_reason = password_reset`）；作废旧码、插入 `staff_activation`（`purpose = reset_password`）；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.reset_password`）；`delivery = sms` 时提交后经 `notify.sendDirect` 下发重置码（同 3.14）。无状态迁移（“待激活”不是状态值）、无出站事件。

### 3.21 admin.staff.resetMfa　重置第二因子

`POST /admin/staff/{staffId}/reset-mfa`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.secure_ops`（A46 把“重置动态口令”列入，A88、A129） |
| 回显 | `confirm: { staffNo }` |
| 幂等 | `required`；结果脱敏 `x-redact-on-replay: ['activation.activationCode']`，重放带 `replayed: true`（A80） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无（A:SysStaff 行的“更多”） |
| 出处 | 路线图 `a01.staff.reset-mfa`；d4-identity.md:987、2290 |

**请求**：同 3.20（`StaffSecureOpBody`）。

**响应**：`StaffMutationResult`（`activation.purpose = activate`）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `SELF_OPERATION_FORBIDDEN` | 409 | 重置自己的第二因子（本人更换验证器走 3.86、3.87） |
| `CONFIRM_MISMATCH` | 409 | 工号不符 |
| `STATE_NOT_ALLOWED` | 409 | 员工不是 `active` |

**副作用**（同一事务）：清空 `staff.totp_secret_enc`、`totp_enrolled_at`、`totp_pending_secret_enc`、`totp_pending_at`、`totp_last_step`，`recovery_codes = []`，`password_hash` 置空；吊销全部会话（`revoke_reason = mfa_reset`）；作废旧码、插入 `staff_activation`（`purpose = activate`）；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.reset_mfa`）；`delivery = sms` 时提交后经 `notify.sendDirect` 下发激活码（同 3.14）；无出站事件。员工用激活码重新设置密码并绑定验证器，等同重新激活（d4-identity.md:987）。

**说明**：最后一位超级管理员自己丢失验证器时，用命令行 `staff:reset-mfa`（需要服务器权限，审计操作人记 `system`）。

### 3.22 admin.staff.reissueActivationCode　重新生成激活码

`POST /admin/staff/{staffId}/reissue-activation-code`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage` |
| 回显 | 无 |
| 幂等 | `required`（发短信，复核意见 47）；结果脱敏 `x-redact-on-replay: ['activationCode']`，重放返回 `activationCode = null`、`replayed: true`（A80） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无（A:SysStaff 行的“更多 › 重新生成激活码”） |
| 出处 | 路线图 `a01.staff.reissue-activation-code`（草案 `POST /sys/staff/{id}/activation-code`）；d4-identity.md:1044 |

**请求**：路径参数 `staffId`。请求体 `ActivationDeliveryBody`：`activationDelivery`（enum，选填；短信未配置或发送失败时用 `manual`）。

**响应**：`ActivationIssue`（2.7）；`purpose` 沿用被作废的那个码，没有则为 `activate`。

**错误**：`STATE_NOT_ALLOWED`（409）：员工不是 `active`，或已设置密码（不在待激活状态；要重来先重置密码）。

**副作用**：作废旧码（`staff_activation.revoked_at`）、插入新码；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.reissue_activation_code`，`meta.delivery`）；`delivery = sms` 时提交后经 `notify.sendDirect` 下发（同 3.14）；无出站事件。

**说明**：库里只有哈希，没有“查看激活码”一说；`manual` 时新码只在本次响应返回一次，由超级管理员线下转交（d4-identity.md:1044）。

### 3.23 admin.staff.unlock　解除登录锁定

`POST /admin/staff/{staffId}/unlock`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无（A:SysStaff 行的“更多 › 解除锁定”，行上有锁定标记时出现） |
| 出处 | 路线图 `a01.staff.unlock`；d4-identity.md:1032 |

**请求**：路径参数 `staffId`。请求体 `UnlockBody`：`bucket`（enum，选填，`trusted` / `untrusted` / `all`，默认 `all`）、`note`（string，选填，≤200 字）。

**响应**：`StaffDetail`。

**错误**：无（没有锁定时照常返回，不报错）。

**副作用**：所选桶的 `staff.fail_*` 清零、`locked_until_*` 置空；写一条 `ops` 审计（类别 `account_security`，动作 `sys.staff.unlock`）。`auth_event.event` 没有“解锁”这个取值，留痕只写审计（初稿待确认 7 的默认，第十节导语接受）。

### 3.24 admin.staff.inviteWecom　邀请绑定企业微信

`POST /admin/staff/{staffId}/invite-wecom`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.wecom_bind` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 开关 | 不受开关拦截（A103）：`admin.wecom_web_login.enabled` 只决定员工收到提醒后走哪条绑定路径（3.10：关闭时手填账号，打开时扫码） |
| 对应画板 | A:SysStaff 行内“邀请”按钮（未绑定且已启用时可点） |
| 出处 | 路线图 `a01.staff.invite-wecom`；proto-admin-e.md:260；d4-identity.md:1072 |

**请求**：路径参数 `staffId`；无请求体。

**响应**：`StaffWecom`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STATE_NOT_ALLOWED` | 409 | 员工不是 `active`（待启用或已禁用），或已绑定 |

**副作用**：`staff.wecom_bind_status = invited`；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.wecom_invite`）；提交后经通知中心给该员工发一条后台站内消息（直发，引导到用户菜单的“绑定企业微信”，即 3.10；x01 未登记事件，不发出站事件）。员工完成 3.10 后状态变为 `bound`；迟迟不绑的，超级管理员可用 3.25 代录。只置状态并提醒，不按手机号自动匹配企业微信成员（d4-identity.md:1072）。

### 3.25 admin.staff.bindWecom　手工录入企业微信 userid

`POST /admin/staff/{staffId}/bind-wecom`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.wecom_bind` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff 行的“更多 › 录入企业微信账号”（超级管理员代录或改正员工手填的账号；V1.0 员工本人在 3.10 手填，A103） |
| 出处 | 路线图 `a01.staff.bind-wecom`（草案 `PUT /sys/staff/{id}/wecom`）；d4-identity.md:1070；03-staff-authz-audit.md:166 |

**请求**：路径参数 `staffId`。请求体 `StaffWecomBindBody`：`wecomUserid`（string，必填，1–64 字符，企业微信通讯录里的成员 `userid`）、`takeOver`（boolean，选填，默认 `false`：该 `userid` 已在另一名员工名下时，为真则把它转到本员工）。

**响应**：`StaffWecom`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `WECOM_USERID_TAKEN` | 409 | 该 `userid` 已绑定在另一名员工上且没带 `takeOver`；`details` 带对方 `staffId`、姓名、状态 |
| `STATE_NOT_ALLOWED` | 409 | 员工已禁用 |

**副作用**（同一事务）：带 `takeOver` 时先清空旧员工的 `wecom_userid` 并置其 `wecom_bind_status = unbound`（`uq_staff_wecom_userid`，03-staff-authz-audit.md:166）；写本员工的 `wecom_userid`、`wecom_bind_status = bound`、`wecom_bound_at`；写 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.wecom_bind`，`meta.takeOverFromStaffId`）。无状态迁移、无出站事件。

### 3.26 admin.staff.poolMembership.replace　设置员工所在的分配池

`PUT /admin/staff/{staffId}/pool-memberships`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.staff.manage` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 带员工的 `lockVersion`（`staff.lock_version`）：池成员表没有锁版本列（A47），以员工行作并发控制，保存时加 1 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff（编辑弹层的“所在分配池”；原型没画，建议加在这里） |
| 出处 | 路线图 `a01.staff.pool-memberships.replace`；03-staff-authz-audit.md:345-383；d3-flow.md:636 |

**请求**：路径参数 `staffId`。请求体 `PoolMembershipReplaceBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `memberships` | array<object> | 是 | 0–20 项；`{ pool, cityCode }` 不重复 | 整体替换；`[]` 即移出全部池 |
| `memberships[].pool` | enum | 是 | 必须等于员工的角色键 | → `assignment_pool_member.pool` |
| `memberships[].cityCode` | string \| null | 否 | 只有 `delivery_manager` 可填，且是已开通的市级行政区划编码；其余池必须为 `null` | → `assignment_pool_member.city_code`（`null` 存空串） |
| `lockVersion` | integer | 是 | | 员工行的锁版本 |

**响应**：`StaffDetail`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `POOL_ROLE_MISMATCH` | 409 | 池与员工角色不符，或员工不是 `active`（`staff.I9`） |
| `VERSION_CONFLICT` | 409 | `lockVersion` 不符 |
| `VALIDATION_FAILED` | 400 | 城市编码不合规、非交付经理池带了城市 |

**副作用**（同一事务，持员工行锁）：删除不在新集合里的 `assignment_pool_member` 行、插入新增的行（客服池新行 `on_duty = true`，保留行的 `on_duty` 不变）；按需插入 `assignment_cursor` 行（`pool`、`scope_key` 为城市编码或 `all`）；`staff.lock_version + 1`；写 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.pool_memberships`，`before` / `after` 为池集合）。

### 3.27 admin.staff.duty.update　切换客服当班

`PATCH /admin/staff/{staffId}/duty`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：本人可切换自己的当班；切换他人需持有 `service.ticket.assign` 且是主管（客服主管）；否则 403 `PERMISSION_DENIED` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无：`assignment_pool_member` 没有锁版本列，当班是开关，后写覆盖。该表已登记进 C52 的“无锁表”清单（`admin.staff.duty.update`，A139）；不借用员工行的 `lockVersion`，避免本人切换当班与超级管理员编辑员工互相冲突 |
| 限流 | `admin.global` |
| 对应画板 | A:Service（客服主管看当班名单）；原型无当班入口（proto-admin-c.md:387），建议放在客服工单页顶部 |
| 出处 | 路线图 `a01.staff.duty`；d3-flow.md:2536；03-staff-authz-audit.md:347 |

**请求**：路径参数 `staffId`。请求体 `DutyUpdateBody`：`onDuty`（boolean，必填）。

**响应**：`PoolMember`（2.8）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `POOL_ROLE_MISMATCH` | 409 | 员工不在客服池（只有客服池可以不当班） |
| `PERMISSION_DENIED` | 403 | 切换他人但不是客服主管 |

**副作用**：更新 `assignment_pool_member.on_duty`、`updated_at`（`pool = cs` 的那一行）；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.staff.duty`，`before` / `after` 为当班开关；员工没有门店，`activity` 流查不到，03 分组 2.10）。没人当班时新工单留在客服主管待办（d3-flow.md:2536）。无出站事件。

### 3.28 admin.assignmentPoolMember.list　分配池成员与游标

`GET /admin/assignment-pool-members`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v` 看全部池；否则只能带 `pool` 查看自己有读权的池（池的读权同 3.12），客服主管（`service.ticket.assign` + 主管）可看客服池；都不满足 403 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff（分配池视图）；A:Service（当班名单） |
| 出处 | 路线图 `a01.assignment-pools.list`（按 A5 改名）；03-staff-authz-audit.md:345-416；05-risks-and-open-issues.md:197 |

**请求**：查询参数：`pool`（enum，选填，可多值）、`cityCode`（string，选填）、`staffId`（uuid，选填）、`onDuty`（boolean，选填）。不分页。

**响应**：`PoolMemberList`（2.8）。

**错误**：`PERMISSION_DENIED`（403）。

**副作用**：无。

### 3.29 admin.staffGroup.list　员工分组

`GET /admin/staff-groups`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff（编辑员工时选分组） |
| 出处 | 路线图 `a01.staff-groups.list`；03-staff-authz-audit.md:103-137 |

**请求**：查询参数：`roleKey`（enum，选填）。不分页。

**响应**：`StaffGroupList` = `{ items: array<{ staffGroupId, name, roleKey, isDefault, memberCount, activeLeadCount }> }`：来自 `staff_group.id`、`name`、`staff_role_key`、`is_default`；`memberCount`、`activeLeadCount` 按 `staff.staff_group_id` 计算（`activeLeadCount = 0` 时页面提示该组没有主管，对应 `staff.I6`）。

**错误**：无。

**副作用**：无。

**说明**：V1.0 不提供分组维护页；分组在迁移时按角色各建一个默认组（d4-identity.md:943）。

### 3.30 admin.staffSession.list　在线会话

`GET /admin/staff-sessions`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.session.revoke`（d4-identity.md:2291：查看与吊销同一权限点） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：建议放在 A:SysStaff 员工行的“更多 › 在线会话”抽屉 |
| 出处 | 路线图 `a01.sessions.list`；d4-identity.md:2291 |

**请求**：查询参数：`staffId`（uuid，选填）、`activeOnly`（boolean，选填，默认 `true`：未吊销且未过期）、`page`、`pageSize`；排序固定 `-createdAt`。

**响应**：`AdminPage<StaffSessionView>`；`StaffSessionView`：`staffSessionId`（`staff_session.id`）、`staff`（`StaffBrief`）、`authMethod`（`staff_session.auth_method`）、`ipMask`（`staff_session.ip` 脱敏）、`userAgent`（`staff_session.user_agent`）、`createdAt`、`lastSeenAt`、`idleExpiresAt`、`absoluteExpiresAt`（`staff_session` 同名蛇形列）、`revokedAt`、`revokeReason`（`staff_session.revoked_at`、`revoke_reason`）、`isCurrent`（是否调用方本人的当前会话）、`actions`（`revoke`）。

**错误**：无。

**副作用**：无。

### 3.31 admin.staffSession.revoke　强制下线

`POST /admin/staff-sessions/{staffSessionId}/revoke`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.session.revoke` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 同 3.30 |
| 出处 | 路线图 `a01.sessions.revoke`（草案 `DELETE /sys/sessions/{id}`，A7 改为动作）；d4-identity.md:2291 |

**请求**：路径参数 `staffSessionId`。请求体 `ReasonOptionalBody`：`reason`（string，选填，≤200 字）。

**响应**：`StaffSessionView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `SELF_OPERATION_FORBIDDEN` | 409 | 吊销自己的当前会话（用退出登录） |
| `STATE_NOT_ALLOWED` | 409 | 会话已吊销或已过期 |

**副作用**：`staff_session.revoked_at` = 现在、`revoke_reason = admin`；写一条 `ops` 审计（类别 `account_security`，动作 `sys.session.revoke`，目标 `staff`）。被吊销的员工下一个请求得到 401 `SESSION_INVALID`。

### 3.32 admin.role.list　角色列表

`GET /admin/roles`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysRoles 左栏（角色、职责、成员名单、锁定、V1.1 标记） |
| 出处 | 路线图 `a01.roles.list`；proto-admin-e.md:300-307；d4-identity.md:2292 |

**请求**：无。8 行，不分页。

**响应**：`RoleSummaryList`（2.9）。左栏的“未保存”圆点由前端维护。

**错误**：无。

**副作用**：无。

### 3.33 admin.role.get　角色详情

`GET /admin/roles/{roleKey}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysRoles 右栏（13 个模块等级、敏感操作清单、数据范围） |
| 出处 | 路线图 `a01.roles.get`；proto-admin-e.md:307；d4-identity.md:1145-1160 |

**请求**：路径参数 `roleKey`（自然键，8 个角色键之一，A3）。

**响应**：`RoleDetail`（2.9）。

**错误**：`NOT_FOUND`（404）：角色键不存在。

**副作用**：无。

### 3.34 admin.role.defaults.get　角色的代码默认配置

`GET /admin/roles/{roleKey}/defaults`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysRoles“恢复默认”（先回填，保存后生效） |
| 出处 | 路线图 `a01.roles.defaults`；proto-admin-e.md:309 |

**请求**：路径参数 `roleKey`。

**响应**：`RoleConfig`（2.9），取自代码注册表的默认值，不读库。

**错误**：`NOT_FOUND`（404）。

**副作用**：无。

### 3.35 admin.role.replace　保存角色权限

`PUT /admin/roles/{roleKey}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.role.edit`（仅超级管理员；注册表标再验证） |
| 回显 | 无（整体替换由 `lockVersion` 保证改的是看到的那一版） |
| 幂等 | `required` |
| 乐观锁 | 带 `lockVersion`（`staff_role.lock_version`；路线图的 `version` 改名，C52） |
| 限流 | `admin.global` |
| 对应画板 | A:SysRoles“保存”（toast“员工刷新页面后生效；变更已记入操作日志”） |
| 出处 | 路线图 `a01.roles.replace`；proto-admin-e.md:308；d4-identity.md:1156-1158 |

**请求**：路径参数 `roleKey`。请求体 `RoleReplaceBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `moduleLevels` | object | 是 | 13 个模块键齐全；值 `n` / `v` / `o` / `e`；`o` 只允许 `delivery`、`publish` | → `staff_role.module_levels` |
| `actions` | object | 是 | 键必须是注册表里、对该角色适用的权限点；值 `{ on: boolean, leadOnly: boolean }`；`leadOnly` 只能出现在注册表允许“仅主管”的键上 | → `staff_role.actions` |
| `dataScope` | enum | 是 | `own` / `group` / `all` | → `staff_role.data_scope` |
| `lockVersion` | integer | 是 | | |

**响应**：`RoleDetail`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `ROLE_LOCKED` | 409 | 超级管理员角色（`staff_role.is_locked`）只读 |
| `VERSION_CONFLICT` | 409 | `lockVersion` 不符 |
| `VALIDATION_FAILED` | 400 | 模块键缺失或多余、`o` 用在其他模块、权限点不在注册表或不适用于该角色（`staff.I7`） |

**副作用**（同一事务）：整体替换 `staff_role.module_levels`、`actions`、`data_scope`，`lock_version + 1`，写 `updated_by_staff_id`、`updated_at`；写一条 `ops` 审计（类别 `staff_authz`，动作 `sys.role.edit`，`target_type = staff_role`、`target_key` = 角色键，`before` / `after` 为变化的部分）。无状态迁移、无出站事件。各进程的角色缓存 5 秒内失效，员工刷新页面后生效。

### 3.36 admin.approval.list　审批单列表（含我的待审批）

`GET /admin/approvals`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：可读的 `kind` 集合 = 调用方满足 2.10 表“查看所需模块等级”的类型；再按每个 `kind` 套数据范围（本人负责、本组、全部；发起人总能看到自己发起的）；`channel_account` 对持有 `publish.account.verify` 的调用方不套数据范围（角色队列，2.10）。显式传入不可读的 `kind` 返回 403 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:Review、A:Accounts、A:Verify、A:Refunds、A:CreditAdjust、A:Receipts（队列页带固定 `kind`）；A:Main（我的待办）；A:MerchantDetail（审核记录）；原型无：我的待审批（A16）、受控财务配置 |
| 出处 | 路线图 `a01.approvals.list`；d3-flow.md:2384-2405；d4-identity.md:2298；03-staff-authz-audit.md:768；A14、A16 |

**请求**：查询参数 `ApprovalListQuery`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tab` | enum | 否 | `todo`（默认）/ `submitted` / `done_today` / `all` | `todo`：`pending` 且调用方此刻能决定（2.10 的 `approve` 判定）；`submitted`：本人发起的（`requester_staff_id` = 本人）；`done_today`：今天（北京时间）进入终态的；`all`：可读范围内全部 |
| `kind` | enum | 否 | 可多值 | 不传 = 全部可读类型；“我的待审批”页即 `tab=todo` 且不传 `kind` |
| `status` | enum | 否 | 可多值；仅 `tab=all`、`submitted` 时有效 | A:CreditAdjust 的“待审批 / 已通过 / 已驳回 / 全部”即 `tab=all` 加 `status=pending` / `approved` / `rejected` / 不传 |
| `storeId`、`entityId` | string(uuid) | 否 | | 商家详情的审核记录 |
| `q` | string | 否 | 1–30 字符 | 单号前缀或摘要标题包含 |
| `overdue` | boolean | 否 | | 只看超期的待审（口径同 2.10 的 `overdue` 角标） |
| `submittedFrom`、`submittedTo` | string(date) | 否 | 两端都含 | 提交日期 |
| `page`、`pageSize` | integer | 否 | | |
| `sort` | enum | 否 | `due`（`todo` 默认：时限升序，无时限在后）、`-submittedAt`（其余默认）、`-decidedAt` | |

**响应**：`AdminPage<ApprovalItem>`（2.10）。

**错误**：`PERMISSION_DENIED`（403）：传入了不可读的 `kind`。

**副作用**：无。

**说明**：

- 列表项只有审批单一种形状（复核意见 65）；退款管理页的“待执行”等领域状态由 `admin.refundRequest.list`、`admin.cancelRequest.list` 承担，不在这里。队列页每 30 秒静默刷新计数（d7-platform.md:1052），计数用 3.37。
- “我的待审批”页（A16）列出本人此刻能决定的全部类型（`tab=todo`、不传 `kind`），按类型分组的数字取 3.37 的 `items[].todo`；菜单角标 `approval.mine`（a02）直接取 3.37 的 `total.todo`，与该页同一个计数函数（`approvals.countTodo`），a02 不另行求和。补偿延长、账号变更两类没有专门页面，在这里处理，详情与“通过 / 驳回”调用 2.10 表里的领域接口（设计规范第 12 节）。
- 账号核验、链接核验的队列（a06）：“待核验 / 今日已处理”即 `tab=todo` / `tab=done_today` 加固定 `kind`；卡片上的门店名、平台与账号名、轮次类型取 `summary.lines`（a06 定义），回填或提交时间取 `submittedAt`，截止取 `dueAt`，处理人取 `handler`（`launch_link`）或决定后的 `decidedBy`（`channel_account`）。
- 积分调整（a07）：行字段（发起人角色、可用积分 a → b、关联订单或广告单号）取 `summary.lines`；详情与决定走 a07 的 `admin.pointAdjustmentRequest.*`。

### 3.37 admin.approval.summary　审批计数

`GET /admin/approvals/summary`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：只返回调用方可读的 `kind`，请求里其余的类型静默略去（d3-flow.md:2400）；可读范围与数据范围同 3.36（含 `channel_account` 角色队列的例外） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:Review、A:Accounts、A:Verify、A:Refunds、A:CreditAdjust 的页签计数与指标卡；A:Main 菜单角标“我的待审批”；原型无：我的待审批 |
| 出处 | 路线图 `a01.approvals.summary`（d3 写作 `/approvals/counts`）；proto-admin-d.md:123、155；CreditAdjust.dc.html:62-64、215-225；A23；C83 |

**请求**：查询参数与 3.36 相同，去掉 `tab`、`status`、分页与排序（C83）：`kind`（可多值）、`storeId`、`entityId`、`q`、`overdue`、`submittedFrom`、`submittedTo`，都选填。

**响应**：`ApprovalCounts`（初稿名 `ApprovalSummary`，与数据模型给 `summary_snapshot` 定的契约名重名，改名）：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `items` | array<object> | 是 | 每个可读 `kind` 一项：`{ kind, todo, submitted, doneToday, all, byStatus, overdue, approvedThisMonth, rejectedThisMonth }`。`todo`、`submitted`、`doneToday`、`all` 依次与列表 `tab=todo`、`submitted`、`done_today`、`all` 同口径（键名即 `tab` 取值的驼峰写法，C83、C15）；`byStatus` = `{ pending, approved, rejected, withdrawn }`，是 `tab=all` 下按 `status` 的计数（A:CreditAdjust 的“待审批 / 已通过 / 已驳回”，“全部”取 `all`）；`overdue` 是待审里超期的条数（口径同 2.10 的 `overdue` 角标）；`approvedThisMonth`、`rejectedThisMonth` 是本月（北京时间自然月）`decided_at` 落在本月的通过、驳回数（指标卡“本月通过 / 本月驳回”） | 计算：`approval_request`（`kind`、`status`、`due_at`、`submitted_at`、`decided_at`、`requester_staff_id`） |
| `total` | object | 是 | `{ todo, overdue }`：各类型之和；“我的待审批”页与菜单角标 `approval.mine`（a02）共用 | 计算 |
| `pointsAdjustMonth` | object \| null | 是 | 可读 `points_adjust` 时给出本月通过的调整合计 `{ increasePoints: integer(积分), decreasePoints: integer(积分) }`（A:CreditAdjust 指标卡“本月通过 · 增加 X、扣减 Y”）；否则 `null` | 计算：`point_adjustment_request.direction`、`adjust_points`，关联本月通过的审批单 |

**错误**：无。

**副作用**：无。

**说明**：本月按北京时间自然月。初稿的 `submittedPending` 删去，“我发起的”页签计数取 `submitted`（与 `tab=submitted` 同口径）。退款管理页的金额与笔数指标由 `admin.refundRequest.summary`（a07）给，不在这里。a02 工作台的审批类待办与本接口同一计数函数（a02 2.3）。

### 3.38 admin.approval.get　审批单详情

`GET /admin/approvals/{approvalId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：先按 id 取出 `kind`，再校验该 `kind` 的查看等级与数据范围（`channel_account` 角色队列的例外见 2.10）；不满足一律 404（不暴露存在与否） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:Review、A:Accounts、A:Verify、A:Refunds、A:CreditAdjust、A:Receipts 的详情区（审批单部分）；原型无：我的待审批的详情抽屉 |
| 出处 | 路线图 `a01.approvals.get`；d3-flow.md:2389、2403；d9-profile.md:686；A14、A19 |

**请求**：路径参数 `approvalId`（uuid）。

**响应**：`ApprovalDetail`（2.10）。领域内容（证照比对、退款核算、延长前后的周期、新手机号脱敏值与证明材料等）用 `operations.get` 指向的领域接口取。

**错误**：`NOT_FOUND`（404）。

**副作用**：无。GET 不写库、只回脱敏值（A19）；证照明文走 3.41，证照原图走 3.61。

### 3.39 admin.auditLog.list　操作日志列表

`GET /admin/audit-logs`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`stream=ops`（默认）要求 `system ≥ v`；`stream=access`（明文查看与敏感文件签发的留痕）只给超级管理员 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysLogs（列表、“共 N 条”） |
| 出处 | 路线图 `a01.audit-logs.list`；proto-admin-e.md:440-449；d4-identity.md:1650、2293；A22 |

**请求**：查询参数 `AuditLogListQuery`（具名导出，a02 的导出键 `audit_logs.list` 复用它，除游标分页参数外同构）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `stream` | enum | 否 | `ops`（默认）/ `access` | 门店活动流（`activity`）由商家详情的门店活动流接口读（a03），不在这里 |
| `category` | string | 否 | 可多值 | 类型筛选（退款、积分调整、套餐有效期调整、积分价调整、积分清零、档案修改、员工与权限、参数修改等，取 `audit_log.category` 的编码，登记值与所属菜单模块见第 4 节 `auditCategory`） |
| `actorType` | enum | 否 | `staff` / `merchant` / `system` | 操作人类型；“系统”即 `system` |
| `actorId` | string(uuid) | 否 | | 操作人 |
| `targetType` | string | 否 | 最终表名 | 对象类型 |
| `targetId` / `targetKey` | string | 否 | 二选一 | 对象 |
| `entityId`、`storeId` | string(uuid) | 否 | | |
| `q` | string | 否 | | 日志编号精确匹配（`RZ` 开头），否则按标题包含 |
| `createdFrom`、`createdTo` | string(date) | 否 | 两端都含 | 原型的“近 7 天 / 近 30 天 / 全部”由前端换算成日期 |
| `cursor`、`limit` | string、integer | 否 | | 游标分页（A22） |

**响应**：`AdminCursorPage<AuditLogItem>`（2.11）；排序固定 `(created_at DESC, seq DESC)`；`totalApprox` 满足“共 N 条”。

**错误**：`PERMISSION_DENIED`（403）：非超级管理员查 `access` 流。

**副作用**：无。

**说明**：导出走 `admin.exportJob.create`（a02），导出键 `audit_logs.list`，`params` 即 `AuditLogListQuery` 去掉 `cursor`、`limit`（C46），需 `audit.export`；导出行为本身记一条 `export` 类审计。

### 3.40 admin.auditLog.get　操作日志详情

`GET /admin/audit-logs/{auditLogId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；同 3.39（按该行的 `stream` 判定） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysLogs 右侧详情（键值、变更前后、登录方式、来源 IP、关联页面） |
| 出处 | 路线图 `a01.audit-logs.get`（草案按 `{no}` 取，按 A3 改为 uuid）；proto-admin-e.md:445 |

**请求**：路径参数 `auditLogId`（uuid）。按日志编号查用 3.39 的 `q=RZ…`。

**响应**：`AuditLogDetail`（2.11）。

**错误**：`NOT_FOUND`（404），含无权查看该流。

**副作用**：无。

### 3.41 admin.piiReveal.create　查看字段明文

`POST /admin/pii-reveals`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：按下表的字段要求对应权限点，且对象在调用方的数据范围内（不在范围 404）；取到的权限点若在注册表里标了再验证（如 `docs.consent.evidence`，a09），处理器同样校验会话的 `stepup_at`，窗口外 403 `STEP_UP_REQUIRED`（C66） |
| 回显 | 无 |
| 幂等 | `none`：结果含明文，不进幂等记录（A51） |
| 乐观锁 | 无 |
| 限流 | `admin.pii_reveal`（C68：每名员工 60 次 / 小时、300 次 / 天，d4-identity.md:1722），超限 429 并告警给超级管理员；同时受 `admin.global` 约束 |
| 对应画板 | A:MerchantDetail、A:Merchants、A:Review、A:Invoices、A:ServiceDetail、A:TicketDetail 上的“查看”眼睛图标 |
| 出处 | 路线图 `a01.pii.reveal`（草案 `POST /pii/reveal`）；d4-identity.md:1713-1722、2299；C40 |

**请求**：请求体 `PiiRevealBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `subjectType` | enum | 是 | 下表的表名 | 对象类型（最终表名） |
| `subjectId` | string(uuid) | 是 | | 对象 id |
| `field` | enum | 是 | 下表的字段名 | 要看的字段 |
| `purpose` | enum | 是 | `contact_merchant` 联系商家 / `verify_identity` 核对身份 / `finance_ops` 财务处理 / `other` | 用途，写进审计 |
| `note` | string | `purpose = other` 时必填 | ≤100 字 | |

| `subjectType` | `field` | 密文列 | 权限点 |
| --- | --- | --- | --- |
| `merchant_user` | `phone` | `merchant_user.phone_enc` | `pii.phone.reveal` |
| `store_profile` | `contactPhone` | `store_profile.contact_phone_enc` | `pii.phone.reveal` |
| `service_ticket` | `contactPhone` | `service_ticket.contact_phone_enc` | `pii.phone.reveal` |
| `account_change_request` | `newPhone` | `account_change_request.new_phone_enc`（申请结束后置空，只在待审时有值） | `pii.phone.reveal` |
| `staff` | `phone` | `staff.phone_enc` | `pii.phone.reveal`，且 `system ≥ v` |
| `entity` | `uscc`、`legalRepName` | `entity.uscc_enc`、`entity.legal_rep_name_enc` | `pii.license.view` |
| `qualification_doc` | `certNo`、`principalName` | `qualification_doc.cert_no_enc`、`qualification_doc.principal_name_enc` | `pii.license.view` 或 `merchant.qualification.review` |
| `qualification_doc` | `submittedFields`、`reviewedFields` | `qualification_doc.submitted_fields_enc`（商家核对后的提交值）、`qualification_doc.reviewed_fields_enc`（审核员修正值）；明文是对象，结构见 04-profile.md 第 4.6 节（a03 的请求） | `pii.license.view` 或 `merchant.qualification.review` |
| `invoice_request` | `taxNo`、`addrTel`、`bankAccount`、`recvEmail`、`mailTo` | `invoice_request.tax_no_enc`、`addr_tel_enc`、`bank_account_enc`、`recv_email_enc`、`mail_to_enc` | `pii.bank.reveal` |
| `refund_txn` | `payeeAccount` | `refund_txn.payee_account_enc` | `pii.bank.reveal` |
| `finance_config_revision` | `accountNo` | `finance_config_revision.account_no_enc` | `pii.bank.reveal` |
| `agreement_consent` | `phone`、`uscc` | `agreement_consent.phone_enc`、`agreement_consent.uscc_enc` | `docs.consent.evidence`（增补，a09） |

**响应**：`PiiRevealResult` = `{ value: string | object | null, field, auditLogId: string(uuid) }`；字段为空时 `value` 为 `null`；`submittedFields`、`reviewedFields` 的 `value` 是解密后的对象（`QualificationFields`，04 分组 4.6），其余是字符串。`Cache-Control: no-store`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `PERMISSION_DENIED` | 403 | 没有该字段要求的权限点 |
| `STEP_UP_REQUIRED` | 403 | 该字段的权限点在注册表里要求再验证，且会话已超出 10 分钟窗口（C66）；再验证后用同一请求重试 |
| `NOT_FOUND` | 404 | 对象不存在或不在数据范围内 |
| `RATE_LIMITED` | 429 | 超过每小时或每天的次数（档位 `admin.pii_reveal`）；`details` 带 `{ window, limit }` |
| `VALIDATION_FAILED` | 400 | `subjectType` 与 `field` 的组合不在上表 |

**副作用**：先写一条 `access` 审计（类别 `pii_reveal`，动作 `pii.<field>.reveal`，目标为该对象，`meta.purpose`、`meta.note`；不记明文），再解密返回（d4-identity.md:1722）。超限时经告警端口报出（规则 `pii.reveal_limit`，维度为员工 id，P2）。无状态迁移、无出站事件。

### 3.42 admin.dictType.list　字典类型

`GET /admin/dict-types`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysDict 左栏（“N 项 · 启用 N 项”“N 个一级 · N 个二级”） |
| 出处 | 路线图 `a01.dict-types.list`；proto-admin-e.md:350；14-config-data.md:55-171 |

**请求**：无。不分页。

**响应**：`DictTypeList`（2.12）。

**错误**：无。

**副作用**：无。

### 3.43 admin.dictItem.list　字典项

`GET /admin/dict-items`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：已登录即可读启用项；`withRefCount=true` 或 `includeDisabled=true` 需 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysDict 右栏树形表格；后台各处下拉与原因单选：A:Merchants、A:Review、A:Verify、A:Accounts、A:Patrol、A:Offline、A:Service、A:Refunds、A:CreditAdjust、A:Invoices、A:Dramas、A:DramaEdit、A:OpsMall、A:OpsHome |
| 出处 | 路线图 `a01.dict-items.list`；d6-notify-docs-data.md:1505-1514；proto-admin-e.md:351；d7-platform.md:1119 |

**请求**：查询参数：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `typeKey` | string | 是 | 可多值（逗号分隔，C45），1–10 个类型键 | 要取的类型（初稿名 `typeKeys`；按 C45 用 DTO 字段名，与商家端 `m.dictItem.list` 统一，已请 m08 同改） |
| `parentCode` | string | 否 | | 按上级懒加载（行政区划 `?parentCode=510100`） |
| `includeDisabled` | boolean | 否 | 默认 `false` | 字典页传 `true` |
| `withRefCount` | boolean | 否 | 默认 `false` | 带引用计数（按类型一条聚合查询，缓存 5 分钟） |
| `scene` | string | 否 | | 只取 `reject_reason` 某个场景（`ext.scene`）的项 |

**响应**：`DictItemList` = `{ items: array<DictItemView>, types: array<{ typeKey, versionNo }> }`（A78 的有界小集合形态）：`items` 是平铺数组（含 `parentCode` 与 `position`），前端组树；`types[].versionNo` 供前端缓存比对（缓存 10 分钟，保存后主动失效）。不分页。

**错误**：`PERMISSION_DENIED`（403）：没有 `system ≥ v` 却要求停用项或引用计数。

**副作用**：无。

### 3.44 admin.dictItem.create　新增字典项

`POST /admin/dict-items`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.dict.edit`（仅超级管理员） |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无（新建；类型行加锁取号，d6-notify-docs-data.md:1495） |
| 限流 | `admin.global` |
| 对应画板 | A:SysDict“新增”弹层（上级、名称、说明；“编码由系统按顺序生成，保存后不可修改”） |
| 出处 | 路线图 `a01.dict-items.create`；d6-notify-docs-data.md:1490-1503；proto-admin-e.md:352 |

**请求**：请求体 `DictItemCreateBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `typeKey` | string | 是 | `can_create = true` 的类型 | → `dict_item.dict_type_key` |
| `parentCode` | string \| null | 否 | 同类型已有的项；层级不超过 `max_depth` | → `dict_item.parent_code` |
| `name` | string | 是 | 1–20 字；同级不重名 | → `dict_item.name` |
| `description` | string \| null | 否 | ≤40 字 | → `dict_item.description` |
| `tags` | array<string> | 否 | | → `dict_item.tags` |
| `ext` | object | 否 | 按类型的 schema（14 分组 4.1） | → `dict_item.ext` |

编码不由请求给出：一级项为 `code_prefix` + 顺序号（`next_code_no`，补零到 `code_width`），下级为上级编码 + 两位子序号。

**响应**：`DictItemView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `DICT_TYPE_NOT_EDITABLE` | 409 | 类型不可新增（行政区划、套餐版本、积分类型等，`can_create = false`） |
| `DICT_NAME_DUPLICATED` | 409 | 同级重名（`uq_dict_item_sibling_name`） |
| `DICT_ITEM_DISABLED` | 409 | `parentCode` 指向已停用的项（新项不挂到停用项下，与“新选择须是启用项”同一规则）；`details = { dictTypeKey, code }`（m08 定义，A77） |
| `VALIDATION_FAILED` | 400 | 层级超限、`ext` 不合 schema、`parentCode` 不存在 |

**副作用**（同一事务，`dict_type` 行 `FOR UPDATE`）：插入 `dict_item`（`is_enabled = true`，`position` 排在同级末尾，`created_by_staff_id`）；一级项时 `dict_type.next_code_no + 1`；`dict_type.version_no + 1`；写一条 `ops` 审计（类别 `dict`，动作 `sys.dict.item_create`，目标 `dict_item`）；提交后配置缓存版本号加 1。无出站事件。

### 3.45 admin.dictItem.update　修改字典项

`PATCH /admin/dict-items/{dictItemId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.dict.edit` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 带 `lockVersion`（`dict_item.lock_version`） |
| 限流 | `admin.global` |
| 对应画板 | A:SysDict“编辑”（只改名称与说明）与行内启停开关 |
| 出处 | 路线图 `a01.dict-items.update`；proto-admin-e.md:353-354；d6-notify-docs-data.md:1505-1508 |

**请求**：路径参数 `dictItemId`。请求体 `DictItemUpdateBody`（不传 = 不改）：`name`（1–20 字）、`description`（≤40 字，可 `null`）、`isEnabled`（boolean）、`tags`、`ext`（整体替换，按类型 schema）、`position`（integer ≥ 0）、`lockVersion`（必填）。编码、类型、上级不可改。

**响应**：`DictItemView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `DICT_NAME_DUPLICATED` | 409 | 改名后同级重名 |
| `DICT_ITEM_IN_USE` | 409 | 停用 `block_if_referenced` 类型的项，而引用计数 > 0（行业、区划有门店或未归档的剧在用）；`details.refCount` |
| `DICT_ITEM_LOCKED` | 409 | 规则不允许：`never` 类型不可停用；系统枚举只可改名称与说明；特殊行业（`ext.special = true`）不可开放（`ext.open = true`）；`details.rule` |
| `VERSION_CONFLICT` | 409 | `lockVersion` 不符 |
| `VALIDATION_FAILED` | 400 | `ext` 不合 schema |

**副作用**（同一事务）：更新 `dict_item`，`lock_version + 1`，写 `updated_by_staff_id`；`dict_type.version_no + 1`；停用 `block_if_referenced` 的项时在事务里调引用计数端口（14 分组 5.3）；写一条 `ops` 审计（类别 `dict`，动作 `sys.dict.item_update`，`before` / `after`）；提交后配置缓存版本号加 1。停用后不再出现在新的选择中，已使用的历史数据不受影响。

### 3.46 admin.paramValue.list　系统参数

`GET /admin/param-values`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysParams（服务时效、工作时间、提醒节点、通用参数；“最近保存：…”）；A:Params 上的“下架提醒（使用期结束前）”（系统参数 `remind.offline.days`，a07 第 6 节第 9 项：不移页时该页按 `keys=remind.offline.days` 单独读写） |
| 出处 | 路线图 `a01.params.get`（按 A5 改名）；proto-admin-e.md:399-412；d6-notify-docs-data.md:1520-1590；14-config-data.md:242-333 |

**请求**：查询参数：`group`（string，选填，可多值）、`keys`（string，选填，可多值）。不分页。

**响应**：`ParamList`（2.13，`{ items, groups, lastSaved }`）。只含 `param_value` 管的参数；计费规则参数在 `billing_param`，走“积分价模板与参数”页（a04、a07）。

**错误**：无。

**副作用**：无。

### 3.47 admin.paramValue.replace　整批保存参数

`PUT /admin/param-values`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.param.edit`（仅超级管理员） |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 逐项 `expectedRev`（列 `param_value.seq`，A21 例外，C52）；任一项不符整批拒绝 |
| 限流 | `admin.global` |
| 对应画板 | A:SysParams“保存”（toast“之后产生的工单与提醒按新参数执行；变更已记入操作日志”）；“恢复默认值”由前端回填 `defaultValue` 后走本接口；A:Params 的“下架提醒”（同 3.46） |
| 出处 | 路线图 `a01.params.save`；d6-notify-docs-data.md:1587；14-config-data.md:288；proto-admin-e.md:408-409 |

**请求**：请求体 `ParamReplaceBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | array<object> | 是 | 1–100 项，键不重复 | 只带改动的键 |
| `items[].key` | string | 是 | 代码里已定义的参数键 | → `param_value.key` |
| `items[].value` | any | 是 | 按定义的类型与范围（14 分组 4.2） | → `param_value.value` |
| `items[].expectedRev` | string(bigint) \| null | 是 | 页面读到的 `latestRev`（不是 `rev`）；库里还没有该键未撤销的行时为 `null` | 比对该键最新一行未撤销值的 `seq`（14 分组 2.3“并发保存”） |
| `items[].effectiveAt` | string(date-time) | 否 | 不早于现在；不传 = 立即生效 | → `param_value.effective_at` |
| `reason` | string | 否 | ≤100 字 | → `param_value.reason` |

**响应**：`ParamList`（只含本次保存涉及的键）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 键未定义、值类型或范围不对（如“应为 1～5 的整数”“格式如 09:00”）、工作时间起不早于止；`fieldErrors.path` 为 `items.N.value` |
| `VERSION_CONFLICT` | 409 | 任一项的 `expectedRev` 不等于该键最新一行未撤销值的 `seq`（“已被他人修改”）；`details.conflicts = [{ key, latestRev }]` |

**副作用**（单事务）：本批键按字典序逐键取咨询锁（`pg_advisory_xact_lock`）后比对 `expectedRev`，逐项插入 `param_value`（`created_by_staff_id` = 操作人）；每个键写一条 `ops` 审计（类别 `param`，动作 `sys.param.save`，`target_type = param_value`、`target_key` = 参数键，`before` / `after` 为新旧值，`meta.effectiveAt`）；提交后参数缓存失效（缓存硬过期受“下一个待生效时刻”约束）。无状态迁移、无出站事件。

**说明**：时效类参数在单据创建时快照（`snapshotOn = create`），改参数不影响已产生的单据；提醒时刻类每次发送时取当前值（d6-notify-docs-data.md:1592-1598）。某个键已有未生效的预约值时，再保存一个“立即生效”的值不影响那条预约：预约到点后仍以预约值为准（生效时刻更晚的行胜出，14 分组 2.3）；要放弃预约先用 3.48 撤销。页面在这类参数行上显示“待生效”标记与预约值（`ParamItem.pending`）。

### 3.48 admin.paramValue.withdraw　撤销预约参数值

`POST /admin/param-values/{paramValueId}/withdraw`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.param.edit` |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无（条件更新本身就是守卫） |
| 限流 | `admin.global` |
| 对应画板 | A:SysParams 参数行的“待生效”标记上的“撤销”（原型无，预约生效时出现） |
| 出处 | 路线图 `a01.params.cancel`（A9 改为 `withdraw`）；d6-notify-docs-data.md:1589；14-config-data.md:286 |

**请求**：路径参数 `paramValueId`（uuid）。请求体 `ReasonOptionalBody`：`reason`（string，选填，≤100 字）。

**响应**：`ParamItem`（该键撤销后的视图）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `PARAM_WITHDRAW_TOO_LATE` | 409 | 已生效或距生效不足 10 分钟（要改就再保存一个新值） |
| `STATE_NOT_ALLOWED` | 409 | 已撤销 |

**副作用**：先取该键的咨询锁，`UPDATE param_value SET cancelled_at = 现在 WHERE id = ? AND cancelled_at IS NULL AND effective_at > 现在 + 10 分钟`，影响 0 行即拒绝；写一条 `ops` 审计（类别 `param`，动作 `sys.param.withdraw`）。

### 3.49 admin.calendarDay.list　工作日历

`GET /admin/calendar-days`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysParams“工作时间与节假日”的节假日表 |
| 出处 | 路线图 `a01.calendar.list`；d3-flow.md:3540；01-kernel-flow.md:509-552；proto-admin-e.md:410 |

**请求**：查询参数：`year`（integer，必填，2024–2100）、`includeAllDays`（boolean，选填，默认 `false`）。

**响应**：`CalendarYear`（2.14，`{ items, year, … }`）。该年还没有任何行时 `items`、`holidays` 为 `[]`，`importedAt` 为 `null`（页面提示“尚未导入放假安排”）。

**错误**：无（年份越界按 `VALIDATION_FAILED`）。

**副作用**：无。

### 3.50 admin.calendarDay.batchImport　导入年度放假安排

`POST /admin/calendar-days/import`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.param.edit`（仅超级管理员，03:242） |
| 回显 | 无 |
| 幂等 | `required`（A17：路线图的“按年覆盖、天然幂等”取消）；内容相同的重复导入不升批次、不发事件 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysParams“导入年度放假安排”（toast“已导入 2026 年放假安排……共 7 个节日、6 个调休上班日”） |
| 出处 | 路线图 `a01.calendar.import`；01-kernel-flow.md:542、521；d3-flow.md:3054；proto-admin-e.md:410 |

**请求**：请求体 `CalendarImportBody`：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `year` | integer | 是 | 2024–2100 | 导入的年份 |
| `days` | array<object> | 否 | 0–80 项，日期不重复，都在 `year` 内 | 不传 = 用随版本发布的内置年度放假安排（`packages/shared/src/calendar/<年份>.ts`，含依据文号）；传了 = 用请求给的例外日（内置数据来不及发版或要更正时用，前端不必提供录入表单）。没有列出的日期按“周一至周五工作、周末休息”兜底 |
| `days[].date` | string(date) | 是 | | → `work_calendar_day.day` |
| `days[].kind` | enum | 是 | `holiday`（任何一天）/ `adjusted_workday`（只能是周六或周日） | → `work_calendar_day.kind` |
| `days[].note` | string | 是 | 1–20 字 | 节日或调休名称（“国庆节”“国庆调休”）→ `work_calendar_day.note` |
| `source` | string | 否 | ≤100 字；传 `days` 时必填 | 依据（如国务院办公厅通知文号），写进审计；不传 `days` 时取内置数据的文号 |

**响应**：`CalendarImportResult`（2.14）。

**错误**：`VALIDATION_FAILED`（400）：日期不在该年、重复、调休上班日落在工作日；没传 `days` 而该年没有内置数据（`fieldErrors.path = days`，“该年份的放假安排尚未内置，请升级版本或提供 days”）。

**副作用**（一个事务）：先把该年没有行的日期按兜底规则铺底，再逐日比对，只改 `kind` 或 `note` 实际不同的行（`is_workday` 随 `kind`，`updated_at`）；至少一天的 `kind` 有变化时取新批次号写进这些行（`calendar_version`），并在同一事务写出站事件 `calendar.imported`（无聚合，`dedupe_key = calendar.imported:{calendarVersion}`，负载 `{ v: 1, calendarVersion, year, changedDays }`，x01）；写一条 `ops` 审计（类别 `param`，动作 `sys.calendar.import`，`target_type = work_calendar_day`、`target_key` = 年份，`meta.changedDays`、`meta.source`）。订阅者按快照里的策略与新日历重算“未完成、按工作日计、窗口覆盖变化日期”的时限并重设定时器（01 分组 2.7）。

**说明**：原型只有一个“导入年度放假安排”按钮与 toast（proto-admin-e.md:394、410），所以页面只调不带 `days` 的形式；内置数据每年国务院发布安排后随版本补一份。不做抓取与文件解析。12 月 1 日起未导入下一年会告警（d7-platform.md:2031 第 21 条）。

### 3.51 admin.featureFlag.list　特性开关

`GET /admin/feature-flags`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.super_admin`（A45：仅超级管理员） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：开关管理 `/sys/flags`（一个列表页，d6-notify-docs-data.md:1760） |
| 出处 | 路线图 `a01.flags.list`；14-config-data.md:558-611；d6-notify-docs-data.md:1727-1760 |

**请求**：无。不分页（十余行）。

**响应**：`FeatureFlagList`（2.15）。

**错误**：无。

**副作用**：无。

### 3.52 admin.featureFlag.update　修改开关

`PATCH /admin/feature-flags/{flagKey}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.super_admin`（A45；路线图未给权限点） |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 带 `lockVersion`（`feature_flag.lock_version`，原名 `rev`） |
| 限流 | `admin.global` |
| 对应画板 | 原型无：开关管理“修改” |
| 出处 | 路线图 `a01.flags.update`；d6-notify-docs-data.md:1760；d7-platform.md:523、2033（第 24 条告警） |

**请求**：路径参数 `flagKey`（自然键，A3）。请求体 `FeatureFlagUpdateBody`：`defaultValue`（按 `valueType`：`bool` 为布尔、`enum` 为登记的可选值之一、`json` 按登记的 schema，如 `client.min_version` 为 semver 字符串）、`rules`（数组，≤20 条；条件只有 `platform`、`clientVersion`（semver 范围）、`envVersion`、`entityIds`（≤50 个）四种）、`description`（≤100 字）、`lockVersion`（必填）。键、类型、下发范围不可改（由代码登记表决定）。

**响应**：`FeatureFlagView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 值与类型不符、规则条件不合规 |
| `VERSION_CONFLICT` | 409 | `lockVersion` 不符 |

**副作用**（同一事务）：更新 `feature_flag`，`lock_version + 1`，写 `updated_by_staff_id`；写一条 `ops` 审计（类别 `param`，动作 `sys.flag.update`，`target_type = feature_flag`、`target_key` = 开关键，`before` / `after`）；提交后配置缓存版本号加 1，并经告警端口发一条即时播报（规则 `config.flag_changed`，维度为开关键，P3，d7-platform.md:2033 第 24 条）。无出站事件。

**说明**：开关是提示不是防线，受控路由服务端同样拦截（C70）；不设“审核态”维度，不得用于让送审版本与线上表现不同（d6-notify-docs-data.md:1758）。改 `client.min_version` 前须确认在役版本（C71、C77）。本页可改代码登记表里的全部键，包括本轮新登记的 `admin.wecom_web_login.enabled`（bool，默认关，A103）与 m08 的 `ops.maintenance_notice`（json：`{ title, body, expectedEndAt }`，C72）。再验证按 `sys.super_admin` 在注册表里的标记统一判定，不单独给“修改”加（A13）。

### 3.53 admin.checklistTemplate.list　清单模板

`GET /admin/checklist-templates`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：已登录即可读 `active` 版本；`status` 含 `draft`、`retired` 或 `allVersions=true` 需 `flow.checklist.manage` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 各队列页的核对清单：A:TicketDetail、A:Delivery、A:Verify、A:Accounts、A:Patrol、A:Offline（原型把清单写死在页面里，改为从这里取）；原型无：清单模板管理 |
| 出处 | 路线图 `a01.checklists.list`；14-config-data.md:613-680；d3-flow.md:1498-1507、3538 |

**请求**：查询参数：`code`（enum，选填，可多值）、`status`（enum，选填，可多值，默认 `active`）、`allVersions`（boolean，选填，默认 `false`）。不分页。

**响应**：`ChecklistTemplateList`（2.16，`{ items }`），按 `code`、`versionNo` 降序。

**说明**：9 个编码的 v1 都由迁移脚本以 `active` 写入（14-config-data.md:664；`config.N20`：每个编码恰有一个启用版本），含发布模块要用的 `patrol.check`、`takedown.check`、`takedown.absence_check`、`account.verify`（a06 的请求），条目内容由各使用方文档给出（a05、a06）。

**错误**：`PERMISSION_DENIED`（403）。

**副作用**：无。

### 3.54 admin.checklistTemplate.create　新建清单模板版本

`POST /admin/checklist-templates`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.checklist.manage`（内容运营或超级管理员） |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无（新建） |
| 限流 | `admin.global` |
| 对应画板 | 原型无：清单模板管理“新建版本” |
| 出处 | 路线图 `a01.checklists.create`；14-config-data.md:659 |

**请求**：请求体 `ChecklistTemplateCreateBody`：`code`（enum，必填，9 个编码之一）、`items`（array，必填，1–50 项，`{ key（1–40 字符，模板内唯一）, label（1–60 字）, required, allowNa, merchantVisible, hint?（≤100 字） }`）。

**响应**：`ChecklistTemplateView`（`status = draft`）。

**错误**：`VALIDATION_FAILED`（400）：条目为空、`key` 重复。

**副作用**：插入 `checklist_template`（`version_no` = 同编码最大值 + 1，`status = draft`，`created_by_staff_id`）——迁移 `checklist_template.status: (新建) → draft`（14-config-data.md:659；配置生命周期，不写 `status_transition`）；写一条 `ops` 审计（类别 `param`，动作 `flow.checklist.create`）。

**说明**：草稿不提供修改接口：要改就放弃（3.56）后新建一个版本（见待确认 2）。

### 3.55 admin.checklistTemplate.activate　启用清单模板版本

`POST /admin/checklist-templates/{checklistTemplateId}/activate`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.checklist.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无（守卫未列 `lock_version`） |
| 限流 | `admin.global` |
| 对应画板 | 原型无：清单模板管理“启用” |
| 出处 | 路线图 `a01.checklists.activate`；14-config-data.md:660、662 |

**请求**：路径参数 `checklistTemplateId`（uuid）。无请求体。

**响应**：`ChecklistTemplateView`（新启用的版本）。

**错误**：`STATE_NOT_ALLOWED`（409）：不是草稿。

**副作用**（同一事务，锁同编码的行）：同编码当前 `active` 版本 `checklist_template.status: active → retired`（写 `retired_at`），本版本 `checklist_template.status: draft → active`（写 `activated_at`）（14-config-data.md:660、662）；写一条 `ops` 审计（类别 `param`，动作 `flow.checklist.activate`）。之后提交的检查结果按新版本校验：带旧版本号的提交返回 409 `CHECKLIST_VERSION_STALE`；必填条目缺结论、有不通过项或在不允许“不适用”的条目上填了不适用，返回 400 `CHECKLIST_NOT_PASSED`。两个码都由本文定义（A77 的清单类 `CHECKLIST_*`，第 5 节），a03、a05、a06 提交检查结果的接口按符号引用。

### 3.56 admin.checklistTemplate.discard　放弃清单模板草稿

`POST /admin/checklist-templates/{checklistTemplateId}/discard`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.checklist.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：清单模板管理“放弃草稿” |
| 出处 | 路线图 `a01.checklists.discard`；14-config-data.md:661 |

**请求**：路径参数 `checklistTemplateId`。无请求体。

**响应**：`ChecklistTemplateView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是草稿。

**副作用**：`checklist_template.status: draft → retired`，写 `retired_at`，`activated_at` 保持为空（14-config-data.md:661）；写一条 `ops` 审计（类别 `param`，动作 `flow.checklist.discard`）。

### 3.57 admin.file.create　上传登记

`POST /admin/files`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：按文件分类调用该分类登记的 `authorizeUpload`（d5-media.md:1016），在处理器里校验权限点与数据范围；逐分类的规则见 2.17 的授权矩阵“后台登记”栏（如证照代传 `merchant.profile.proxy_edit`、发票 `finance.invoice.issue` / `finance.invoice.red`、核查巡检与链接核验截图 `publish.takedown.check` / `publish.patrol.do` / `publish.link.verify`、工单附件 `service.ticket.reply`、预告片源 `drama.media.manage`、许可与权属文件 `drama` ≥ e 或 `drama.copyright.revise`、样片成片广告为分派给本人的任务，由 delivery 登记的 `delivery.authorizeUpload` 判定，a05 1.3） |
| 回显 | 无 |
| 幂等 | `natural`：`idempotentBy = [uq_file_object_client_token_store, uq_file_object_client_token_noscope]`（按 `clientToken` 复用未完成的登记以便续传，C47、C59、A49；批次内的文件走上传批次与 `uq_file_object_client_token_batch`，a04） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:DramaEdit（预告片源、海报、许可文件）、A:AdTasks（广告版本）、A:TicketDetail（样片、成片）、A:Offline、A:Patrol（截图）、A:Invoices（发票文件）、A:Receipts（回单）、A:OpsHome（Banner）、A:OpsAgreements（协议正文）、A:ServiceDetail（工单附件）、A:MerchantDetail（证照代传、代传素材）；原型无：线下退款登记、红字发票 |
| 出处 | 路线图 `a01.uploads.create`（A5 合为 `files`）；d5-media.md:1012-1027、2106；C59；A35 |

**请求**：请求体 `AdminFileCreateBody`（后台一次登记一个文件；与 m08 按批登记的 `FileCreateBody` 不同构，所以另起名字）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `category` | enum | 是 | 后台可登记的分类（见说明） | → `file_object.category` |
| `fileName` | string | 是 | 1–200 字符；扩展名在该分类的登记表内 | → `file_object.original_name`、`ext` |
| `sizeBytes` | string(bigint) | 是 | 不超过“分类 × 后台”的上限 | → `file_object.declared_size` |
| `mime` | string | 否 | | 只作参考，规范类型由扩展名推出（→ `file_object.declared_mime`） |
| `clientToken` | string | 是 | 1–64 字符，`[A-Za-z0-9_-]`（与 m08 同一规则） | 端上生成的续传标识（算法同 d5-media.md:1137）→ `file_object.client_token` |
| `storeId` | string(uuid) | 门店级分类必填 | | 归属门店（如代传门店素材、证照、样片所属订购项的门店） |
| `entityId` | string(uuid) | 主体级分类必填 | 有 `storeId` 时由门店推出，不必传 | 归属主体 |
| `onBehalfStore` | boolean | 否 | 默认 `false` | 员工代商家上传（A35：超过小程序上限的大文件由服务经理在后台代传）；为真时写 `file_object.on_behalf_store_id = storeId` |
| `production` | object | 分类为 `sample_video`、`final_episode`、`ad_video` 时必填 | | 制作上下文（d5-media.md:1022-1025）：`{ kind: 'sample' \| 'final' \| 'ad', orderItemId?, adId?, episodeNo?, dramaEpisodeMasterId?, aiUsage: { used: boolean, tools: [{ name, version, usedFor }] } }` |

**响应**：`FileRegistration`（2.17）。同一 `clientToken`、同一分类、同一归属、声明大小相同的未确认登记直接复用（同一个写入区 key，分块续传才成立）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `FILE_CATEGORY_NOT_ALLOWED` | 400 | 该分类不能由后台登记（2.17 矩阵“后台登记”为“—”的分类，含只经上传批次的 `drama_master`），或分类与给出的归属范围不符 |
| `FILE_TOO_LARGE` | 400 | 声明大小超过上限；`details.maxBytes`（字符串），后台 `canDelegate` 恒为 `false`（m08 定义） |
| `FILE_TYPE_NOT_ALLOWED` | 400 | 扩展名不在该分类的登记表内；`details.allowedExts`（m08 定义） |
| `PRODUCTION_CONTEXT_REQUIRED` | 400 | 样片、成片、广告缺制作上下文或 AI 使用声明，或订购项、广告、原片版本对不上 |
| `PERMISSION_DENIED` | 403 | 分类登记的鉴权不通过（无权限点、不是本人任务） |
| `NOT_FOUND` | 404 | `storeId`、订购项、广告不存在或不在数据范围内 |

**副作用**（同一事务）：

- 插入 `file_object`：`file_object.status: (新建) → pending`（06-media.md:188），`upload_actor_type = staff`、`upload_actor_id`、`upload_client = admin`，`object_key`、`incoming_bucket`、`incoming_key`，`upload_mode`，`upload_expires_at` = 现在 + 24 小时，`multipart` 时 `sts_issued = 1`；`onBehalfStore = true` 时 `on_behalf_store_id = storeId`。
- 制作类（`sample_video`、`final_episode`、`ad_video`）同时插入 `production_record`：`production_record.pipeline_state: (新建) → uploading`；`kind`、`order_item_id` / `ad_id`、`episode_no` 取 `production`；`source = manual_upload`；`variant = common`（V1.0 只写它，M38）；`ai_usage` 由服务端补 `declaredBy`、`declaredAt`，剧目是 AI 制作时强制 `used = true` 并记 `forcedByDrama`；`aigc_state` = `ai_usage.used` 为真时 `pending`、否则 `not_required`（就绪时只能是 `not_required` 或 `verified`，`ck_production_record_ready_aigc`）；`uploaded_by_staff_id` = 操作人；`production_tier`（`standard` / `advanced` / `top`，A98）与片头片尾广告版本（`head_ad_version_id`、`tail_ad_version_id`）由交付模块的 `authorizeUpload` 返回，广告为空；原片版本按“取料记录 → 表单指定 → 当前原片”认定 `drama_episode_master_id` 与 `master_source`（`checkout` / `declared` / `current_fallback`）。
- 无出站事件（`file.uploaded` 在确认时发，见 3.59）、无审计（上传本身不进操作日志）。

**说明**：后台不能登记的分类见 2.17 矩阵：系统写入的 `seal_image`、`consent_digest`、`export`、`video_cover`、`sample_wm`、`package_zip`、`publish_list`、`trailer_out`、`pay_bill`；只经上传批次的 `drama_master`（a04，原片须走批次与 `master_source` 规则）；没有后台上传场景的 `channel_screenshot`。单文件上限是服务端参数，真机验证前视频按 100MB（05-risks-and-open-issues.md:184）；大视频走分块续传。电脑端商家上传是 V1.1。

### 3.58 admin.file.refreshCredentials　续签直传凭证

`POST /admin/files/{fileId}/refresh-credentials`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：上传人本人（`file_object.upload_actor_id` = 调用方）；否则 404 |
| 回显 | 无 |
| 幂等 | `none`：签发上传凭证（C47、C59） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:DramaEdit、A:TicketDetail、A:AdTasks（大文件分块上传中途过期） |
| 出处 | 路线图 `a01.uploads.renew-credential`（C12 改为 `refresh-credentials`）；d5-media.md:1028 |

**请求**：路径参数 `fileId`。无请求体。

**响应**：`FileRegistration`（新的 `sts`，`multipart` 时 30 分钟）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `UPLOAD_EXPIRED` | 409 | 登记已过 `upload_expires_at` 或已作废（`expired`）（m08 定义） |
| `UPLOAD_CREDENTIAL_LIMIT` | 409 | 已签发 30 次（`sts_issued`），请重新登记（m08 定义） |
| `STATE_NOT_ALLOWED` | 409 | 不是 `pending`（已确认、已入库或被拒收） |

**副作用**：`file_object.sts_issued + 1`。凭证本身不入库，结果不进幂等记录（A18、A51）。

### 3.59 admin.file.complete　上传确认

`POST /admin/files/{fileId}/complete`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：上传人本人；否则 404 |
| 回显 | 无 |
| 幂等 | `required`（状态迁移，C59）；三段式用例（C51 的“多事务”形态，与 `m.file.complete` 同法，已登记进 C51，A139）：事务一用 `file_object.confirming_until` 占位，事务外 `HEAD` 写入区对象并读文件头，事务二写结果并写幂等记录；拒收时事务二已提交的 `rejected` 不随业务失败回滚 |
| 乐观锁 | 无（条件更新） |
| 限流 | `admin.global` |
| 对应画板 | 同 3.57 |
| 出处 | 路线图 `a01.uploads.complete`；d5-media.md:1030-1040；C59 |

**请求**：路径参数 `fileId`。无请求体。

**响应**：`AdminFileView`（2.17）：`status` 为 `promoting` 或（≤32MB 的小文件最多等 3 秒）`stored`；之后用 3.60 每秒轮询直到 `stored` / `rejected`。已是 `promoting`、`stored` 时直接返回当前状态。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `CONFIRM_IN_PROGRESS` | 409 | 另一个确认正在进行（`confirming_until` 未过期）；可重试，1 秒后用同一幂等键重试（m08 定义） |
| `UPLOAD_NOT_FOUND` | 409 | 写入区对象不存在（直传尚未完成）；端上确认直传完成后再调（m08 定义） |
| `UPLOAD_REJECTED` | 400 | 大小与声明不符、超过上限或文件头与扩展名不符，文件已置 `rejected`；`details.rejectReason`（m08 定义） |
| `UPLOAD_EXPIRED` | 409 | 登记已过期或已取消（m08 定义） |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 三段式用例处理中 |

**副作用**：

- 相符：`file_object.status: pending → promoting`，记 `incoming_etag`、`incoming_crc64`；同事务插入 `media_job`（`kind = promote`，`dedupe_key = promote:{fileId}`）与出站事件 `file.uploaded`。发在确认这一步（`pending → promoting`）、与 `promote` 任务同事务，与 m08 的 `m.file.complete`、a04 的批次条目确认一致（A141 已回写 06 分组，`06-media.md:191`）。入库、体检由任务进程完成（`promoting → stored`、`production_record.pipeline_state: uploading → checking → ready / rejected`，非 HTTP 迁移，x01）。
- 不符：`file_object.status: pending → rejected`，记 `reject_reason`，同事务发出站事件 `file.rejected`；写入区对象由清扫任务删除（d5-media.md:1037）。
- 无审计。

**说明**：a04 的 `admin.uploadBatchItem.complete`（批次内单个文件的确认）与本接口共用同一实现：三段式、状态迁移、错误码（`CONFIRM_IN_PROGRESS`、`UPLOAD_NOT_FOUND`、`UPLOAD_REJECTED`、`UPLOAD_EXPIRED`）与出站事件（`file.uploaded`、`file.rejected`）都相同，只是鉴权与批次收尾由 a04 另写。

### 3.60 admin.file.get　文件状态

`GET /admin/files/{fileId}`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：上传人本人，或按 3.61 的规则对该分类有读权的员工；否则 404 |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:DramaEdit、A:AdTasks、A:TicketDetail（上传后轮询入库与体检） |
| 出处 | 路线图 `a01.uploads.get`；d5-media.md:2106；C59 |

**请求**：路径参数 `fileId`。

**响应**：`AdminFileView`（含 `production`、`check`）。不返回读地址（要地址走 3.61）。

**错误**：`NOT_FOUND`（404）。

**副作用**：无。

### 3.61 admin.file.downloadUrls　签发文件读地址

`POST /admin/files/{fileId}/download-urls`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：按文件分类套授权矩阵（`authz.canReadFile`，d4-identity.md 第 9.4 节按分类展开后的 2.17“后台签发”栏）再加数据范围；不满足 404。例：证照 `merchant.qualification.review` 或 `pii.license.view`；协议正文 `ops` ≥ v 且被协议版本引用（a09）；发布截图、成片、成片包对 `publish` ≥ v 放行（a06）；回单、发票、对账单原文件对 `finance` ≥ v 放行（a07）；账号变更证明、肖像授权材料按 a03 的权限点 |
| 回显 | 无 |
| 幂等 | `none`：签发短时地址，结果不进幂等记录（A18） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:Review、A:Accounts、A:Verify、A:MerchantDetail、A:TicketDetail、A:AdTasks、A:Delivery、A:Receipts、A:Invoices、A:Reconcile、A:Offline、A:Patrol、A:DramaEdit、A:OpsAgreements（“下载当前版本”）、A:ServiceDetail、A:OrderDetail（证照原图、凭证、截图、样片等的“查看”“下载”） |
| 出处 | 路线图 `a01.files.get-url`（A19 由 GET 改 POST）；d5-media.md:2112；d4-identity.md:1727-1745；01-architecture.md:452；A57 |

**请求**：路径参数 `fileId`。请求体 `FileDownloadUrlsBody`：`disposition`（enum，选填，`inline` 页面内预览 / `attachment` 下载，默认 `inline`；`inline` 只对该分类允许的图片、MP4、PDF、音频生效）、`purpose`（string，选填，≤50 字，写进留痕）。

**响应**：`SignedUrl` = `{ url, expiresAt }`。有效期按分类（C61）：证照、回单、发票、授权书 5 分钟；素材与档案图片 30 分钟；素材音视频、样片、广告播放 60 分钟；员工下载原片、成片 30 分钟；协议正文 PDF（`legal_doc`，被协议版本引用，a09 的“下载当前版本”）30 分钟（A125、C61）；发布清单文件 15 分钟（A125）。`Cache-Control: no-store`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `FILE_NOT_AVAILABLE` | 409 | 文件不是 `stored`（未入库、已清除、被拒收），或被内容审核拦截（`block`，只有审核相关权限可看） |
| `FILE_CATEGORY_NOT_ALLOWED` | 400 | 该分类不经本接口签发（2.17 矩阵“后台签发”为“—”）：原片取料（`drama_master`，写 `master_checkout`）走 `admin.deliveryTicket.material.downloadUrls`，导出文件（`export`）只能走 `admin.exportJob.downloadUrls`（a02），印章图片只有任务进程可读 |
| `NOT_FOUND` | 404 | 文件不存在或无权读 |

**副作用**：2.17 矩阵“留痕”为是的分类（`secure` 桶的全部分类，以及样片、成片、成片包）每次签发写一条 `access` 审计（类别 `file_access`，动作 `files.url.sign`，目标 `file_object`，`meta.fileCategory`、`meta.urlTtlSec`、`meta.purpose`）；预告片、海报、Banner 等不留痕。无状态迁移、无出站事件。

**说明**：A57 裁定保留这个按文件的通用签发，权限在处理器里按文件归属与分类判定。

### 3.62 admin.file.list　文件查询

`GET /admin/files`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v`（“文件清除放行”归系统模块，A45） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行（已清除文件列表、清除运行的候选明细） |
| 出处 | 路线图 `a01.files.list`（草案 `GET /files/deleted`，C45 改为字段筛选）；d5-media.md:2117 |

**请求**：查询参数：`status`（enum，选填，可多值，如 `deleted`）、`category`（可多值）、`scopeType`、`entityId`、`storeId`、`uploadActorType`、`uploadActorId`、`purgeRunId`（uuid：只看该清除运行的候选文件，取 `file_purge_run.candidate_ids`）、`fileIds`（可多值，≤100）、`q`（原始文件名包含）、`deletedFrom` / `deletedTo`（date）、`page`、`pageSize`、`sort`（`-deletedAt` 默认、`-createdAt`、`-sizeBytes`）。

**响应**：`AdminPage<AdminFileView>`（列表里 `check` 为 `null`，节省查询）。

**错误**：无。

**副作用**：无。

### 3.63 admin.file.restore　恢复已清除文件

`POST /admin/files/{fileId}/restore`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`files.restore`（增补） |
| 回显 | 无 |
| 幂等 | `required`（状态迁移）；三段式用例（C51 的“先调外部、再开事务”，已登记进 C51，A139）：占用 `in_progress` → 事务外移除对象存储的删除标记（重复移除是空操作）→ 事务内复核守卫并落库、写幂等记录 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行“恢复” |
| 出处 | 路线图 `a01.files.restore`；06-media.md:202；d5-media.md:401 |

**请求**：路径参数 `fileId`。请求体 `ReasonRequiredBody`：`reason`（string，必填，5–200 字）。

**响应**：`AdminFileView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `FILE_RESTORE_WINDOW_PASSED` | 409 | 已超过历史版本保留期（`secure` 90 天、其余 30 天），对象已不可恢复 |
| `STATE_NOT_ALLOWED` | 409 | 不是 `deleted`；或已被彻底删除（`file_object.erased_at` 非空，2.17 的 `erasedAt`）；或同一文件的彻底删除（3.64）正在进行（按 `fileId` 互斥，稍后重试） |
| `PROVIDER_UNAVAILABLE` | 503 | 对象存储不可用；没有落库，可用同一个键重试 |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 三段式用例处理中 |

**副作用**：先取按 `fileId` 的互斥（见说明），开短事务锁文件行，检查 `status = deleted` 且 `erased_at` 为空；再在事务外移除对象存储的删除标记；再开事务锁文件行、复核守卫（`status = deleted`、`erased_at` 为空、在保留期内），`file_object.status: deleted → stored`，`deleted_at`、`purge_after` 置空（06-media.md:202）；写一条 `ops` 审计（类别 `system_ops`，动作 `files.restore`，`reason_text`）。无出站事件。补偿：事务里复核不通过（其间被彻底删除等）时，把删除标记加回去再返回错误；占用过期后同一个键可以接手续做（再移除一次标记是空操作）。

**说明**：恢复与彻底删除（3.64）对同一文件必须串行，否则恢复可能在彻底删除的两段事务之间提交（已是 `deleted` 的文件，彻底删除的事务一不改状态），得到一个 `stored` 却已没有对象版本的文件。做法：两条接口在整个用例期间（事务一之前到事务二提交或失败返回）持有同一把按 `fileId` 的互斥锁（PostgreSQL 会话级 advisory lock，`pg_try_advisory_lock`，键取 `fileId` 的哈希；连接断开自动释放），拿不到返回 `STATE_NOT_ALLOWED`；拿到后在事务一里锁文件行并检查 `status`、`erased_at`。同一幂等键的重放仍由幂等占用（C49）处理。

### 3.64 admin.file.erase　彻底删除文件

`POST /admin/files/{fileId}/erase`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`files.erase`（默认仅超级管理员；要再验证，A36） |
| 回显 | `confirm: { fileId, category }` |
| 幂等 | `required`；三段式用例（C51 的“多事务”形态，已登记进 C51，A139）：事务一占位 → 事务外删除对象的全部历史版本 → 事务二落结果并写幂等记录（见副作用） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行“彻底删除” |
| 出处 | 路线图 `a01.files.erase`；d5-media.md:402；06-media.md:1877（待确认 4）；A36 |

**请求**：路径参数 `fileId`。请求体 `FileEraseBody`：`reason`（string，必填，10–500 字，如个人信息删除请求的受理编号与说明）、`confirm`（object，必填，`{ fileId, category }`）。

**响应**：`AdminFileView`（`status = deleted`，`erasedAt` 非空，`originalName = null`，`restorableUntil = null`）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `FILE_IN_USE` | 409 | 文件仍有在用引用（`file_ref.state = live`），须先在业务侧移除；`details.refs = [{ refType, refId }]`（至多 20 条） |
| `CONFIRM_MISMATCH` | 409 | 回显的文件或分类不符 |
| `STATE_NOT_ALLOWED` | 409 | 不是 `stored` 或 `deleted`（未入库的用 3.89 取消即可）；或已彻底删除（`erased_at` 非空）；或同一文件的恢复（3.63）正在进行（按 `fileId` 互斥，稍后重试） |
| `PROVIDER_UNAVAILABLE` | 503 | 对象存储不可用；文件停在 `deleting`，可用同一个键重试 |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 三段式用例处理中 |

**副作用**：

- 事务一之前取按 `fileId` 的互斥（与 3.63 共用，见 3.63 说明），用例结束释放。
- 事务一（锁文件行）：复核守卫（状态、`erased_at` 为空、在用引用、回显）；`stored` 的置 `file_object.status: stored → deleting`（此后 `files.link()` 与签发都不再接受它，避免删对象期间又被引用）；`deleted` 的不改状态。
- 事务外：删除该对象在正式区的全部历史版本（含删除标记），失败则停在 `deleting`，同一个键重试或占用过期后接手续做；不回退。
- 事务二：`deleting` 的条件更新（`WHERE status = 'deleting'`）置 `file_object.status: deleting → deleted`，同一时刻写 `deleted_at` 与 `erased_at`；`original_name` 置空（行保留，`06-media.md:1877` 待确认 4）；写一条 `ops` 审计（类别 `system_ops`，动作 `files.erase`，`reason_text`）（`06-media.md:200`）。原已是 `deleted` 的文件条件更新 `WHERE status = 'deleted' AND erased_at IS NULL`，只写 `erased_at`、`original_name` 置空与审计，`deleted_at` 不变（`06-media.md:201`）；因为有了 `erased_at`，`restorableUntil` 为 `null`、不再出现 `restore`。
- 事务二提交后另起事务执行该分类的清除后钩子（同清除任务：`package_zip`、`publish_list` 改 `zip_bundle`，任意文件释放以它为源的 `derivative` 引用，如派生封面；先锁钩子要改的行，不在持有文件行锁时去锁 `zip_bundle`）；没执行成的由 `media.I8` 每小时修复（`06-media.md:198`、`200`）。
- 对外答复“已删除”以执行时刻为准（d5-media.md:402）。

**说明**：A36：V1.0 不走审批单，仅超级管理员、要求再验证、填写原因、写审计，列为待法务确认（待确认 3）。状态迁移以 06 分组 2.1 的“员工彻底删除”三行为准（`06-media.md:199-201`，A141）；恢复的守卫按 `erased_at` 判断（`06-media.md:202`）。

### 3.65 admin.purgeRun.list　清除运行

`GET /admin/purge-runs`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行“待确认清单”与历史 |
| 出处 | 路线图 `a01.purge-runs.list`；d5-media.md:2116；06-media.md:306-373 |

**请求**：查询参数：`state`（enum，选填，可多值，默认 `proposed,held`）、`page`、`pageSize`；排序 `-createdAt`。

**响应**：`AdminPage<PurgeRunView>`（2.18）。候选明细用 3.62 的 `purgeRunId` 筛选。

**错误**：无。

**副作用**：无。

### 3.66 admin.purgeRun.approve　放行清除运行

`POST /admin/purge-runs/{purgeRunId}/approve`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`files.purge.approve`（增补） |
| 回显 | `confirm: { candidateCount, candidateBytes }`：与运行行比对（C54） |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无（守卫未列锁版本） |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行“放行” |
| 出处 | 路线图 `a01.purge-runs.approve`；06-media.md:358 |

**请求**：路径参数 `purgeRunId`。请求体 `PurgeApproveBody`：`confirm`（object，必填，`{ candidateCount: integer, candidateBytes: string(bigint) }`）、`note`（string，选填，≤200 字）。

**响应**：`PurgeRunView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STATE_NOT_ALLOWED` | 409 | 不是 `proposed` 或 `held` |
| `CONFIRM_MISMATCH` | 409 | 候选数或字节数与运行行不符 |

**副作用**：`file_purge_run.state: proposed → approved` 或 `held → approved`（06-media.md:358），写 `decided_by_staff_id`、`decided_at`；写一条 `ops` 审计（类别 `system_ops`，动作 `files.purge.approve`）。执行（`approved → running → done / aborted`）由任务进程在没有其他运行在执行时开始，逐文件复核后删除（非 HTTP 迁移，x01）。

### 3.67 admin.purgeRun.reject　驳回清除运行

`POST /admin/purge-runs/{purgeRunId}/reject`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`files.purge.approve` |
| 回显 | 无；`x-step-up: skip`（C86 登记，A149：驳回不要求再验证，错误表不列 `STEP_UP_REQUIRED`） |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：文件清除放行“驳回” |
| 出处 | 路线图 `a01.purge-runs.reject`；06-media.md:359 |

**请求**：路径参数 `purgeRunId`。请求体 `ReasonRequiredBody`：`reason`（string，必填，5–200 字）。

**响应**：`PurgeRunView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是 `proposed` 或 `held`。

**副作用**：`file_purge_run.state: proposed → rejected` 或 `held → rejected`，写 `decided_by_staff_id`、`decided_at`；写一条 `ops` 审计（类别 `system_ops`，动作 `files.purge.reject`，`reason_text`；运行行没有说明列）。被驳回的候选在下一次每日扫描时重新评估。

### 3.68 admin.mediaJob.list　媒体任务

`GET /admin/media-jobs`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v`（流程运维归系统模块，A45） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“媒体任务” |
| 出处 | 路线图 `a01.media-jobs.list`；d5-media.md:2114；06-media.md:618-718 |

**请求**：查询参数：`state`（enum，可多值，默认 `failed`）、`kind`（可多值）、`subjectType` + `subjectId`、`parentType` + `parentId`、`createdFrom` / `createdTo`（date）、`page`、`pageSize`；排序 `-finishedAt`（失败列表）或 `-createdAt`。

**响应**：`AdminPage<MediaJobView>`（2.18）。`input`、`output` 不返回（可能含对象键）。

**错误**：无。

**副作用**：无。

### 3.69 admin.mediaJob.retry　媒体任务人工重试

`POST /admin/media-jobs/{mediaJobId}/retry`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`media.job.retry`（增补） |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维；A:DramaEdit（预告片转码 `transcode_mp4` 失败时的“重试”，a04） |
| 出处 | 路线图 `a01.media-jobs.retry`；06-media.md:694、902；d5-media.md:2114 |

**请求**：路径参数 `mediaJobId`。请求体 `NoteOptionalBody`：`note`（string，选填，≤200 字）。

**响应**：`MediaJobView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STATE_NOT_ALLOWED` | 409 | 不是 `failed` |
| `MEDIA_JOB_NOT_RETRYABLE` | 409 | 业务对象已不需要它（文件已清除或被拒收、可播放资产已停用、ZIP 代次已过时） |

**副作用**：`media_job.state: failed → queued`（06-media.md:694），同一行里：`attempt_no = 0`，清空 `finished_at`，`next_run_at` = 现在，`deadline_at` = 现在 + 该 `kind` 登记的超时时长（d5-media.md:1349-1358；不重设的话旧的 `deadline_at` 早已过去，执行循环或 `media.I10` 会立刻把它判回 `failed`），清空 `error_code`、`error_message`，`is_retryable = false`；写一条 `ops` 审计（类别 `system_ops`，动作 `media.job.retry`，`meta.note`）。字段改动与 06 分组“人工重试”一行（`06-media.md:694`，A141 已回写）逐项一致。重试成功后父对象由任务进程推进（如 `playable_asset.state: failed → ready`，06-media.md:902，非 HTTP 迁移，x01 第 5.7 节）。

### 3.70 admin.alert.list　告警

`GET /admin/alerts`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v`，或财务模块 `≥ v` 且是主管（财务主管只读，d7-platform.md:2003） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康 `/sys/health`“未恢复的告警”页签 |
| 出处 | 路线图 `a01.alerts.list`；d7-platform.md:2003；15-integration-ops.md:194-286 |

**请求**：查询参数：`status`（enum，可多值，默认 `open,acked`）、`severity`（可多值）、`kind`、`rule`、`page`、`pageSize`；排序固定为级别升序（P1 在前）、`last_seen_at` 降序。

**响应**：`AdminPage<AlertView>`（2.19）。已恢复的保留 180 天，可用 `status=resolved` 查历史。

**错误**：无。

**副作用**：无。

### 3.71 admin.alert.acknowledge　认领告警

`POST /admin/alerts/{alertId}/acknowledge`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.health.manage`（增补） |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康“认领” |
| 出处 | 路线图 `a01.alerts.ack`（A9 改为 `acknowledge`）；15-integration-ops.md:254 |

**请求**：路径参数 `alertId`。请求体 `NoteOptionalBody`：`note`（string，选填，≤200 字）。

**响应**：`AlertView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是 `open`。

**副作用**：`alert_event.status: open → acked`，写 `acked_by_staff_id`、`acked_at`、`note`（15-integration-ops.md:254）；写一条 `ops` 审计（类别 `system_ops`，动作 `ops.alert.acknowledge`）。之后重复通知的间隔放大 4 倍。

### 3.72 admin.alert.resolve　人工关闭告警

`POST /admin/alerts/{alertId}/resolve`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.health.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康“关闭” |
| 出处 | 路线图 `a01.alerts.resolve`；15-integration-ops.md:257 |

**请求**：路径参数 `alertId`。请求体 `NoteRequiredBody`：`note`（string，必填，5–200 字）。

**响应**：`AlertView`。

**错误**：`STATE_NOT_ALLOWED`（409）：已是 `resolved`。

**副作用**：`alert_event.status: open → resolved` 或 `acked → resolved`，写 `resolved_at`、`note`（15-integration-ops.md:257）；写一条 `ops` 审计（类别 `system_ops`，动作 `ops.alert.resolve`）；不发通知。探针型告警若仍越限，下一分钟会新建一行 `open`。

### 3.73 admin.invariantRun.list　不变量校验运行记录

`GET /admin/invariant-runs`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康 |
| 出处 | 路线图 `a01.invariant-runs.list`；15-integration-ops.md:288-368 |

**请求**：查询参数：`mode`、`trigger`、`status`（选填）、`page`、`pageSize`；排序 `-startedAt`。

**响应**：`AdminPage<InvariantRunView>`（2.19）。

**错误**：无。

**副作用**：无。

### 3.74 admin.invariantRun.create　手动触发不变量校验

`POST /admin/invariant-runs`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.ops.manage`；范围涉及资金类检查项（`modules` 含 `billing`，或 `codes` 里有以 `billing.`、`payment.` 开头的编号或通配）时另需 `billing.invariant.resolve`（处理器内判定）。`payment` 不是模块名（`ck_invariant_violation_module` 的 31 个取值里没有它），只是检查项编号的命名空间 |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康“立即校验” |
| 出处 | 路线图 `a01.invariant-runs.create`（d1 写作 `POST /billing/invariants/run`）；15-integration-ops.md:331、354；d1-ledger.md:1714 |

**请求**：请求体 `InvariantRunCreateBody`：`modules`（array<enum>，选填，只收登记的 31 个模块名，15 分组第 3 节）、`codes`（array<string>，选填，≤50 项；精确编号如 `billing.I3`，或命名空间通配如 `payment.*`——只跑付款类检查项就传它）、`entityIds`（array<uuid>，选填，≤20 个）。都不传 = 全量。

**响应**：`InvariantRunView`（`status = running`）。前端每 5 秒查 3.73 直到结束（C63）。相同范围的手工运行仍在进行时直接返回那一条。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `PERMISSION_DENIED` | 403 | 限定计费范围却没有 `billing.invariant.resolve` |
| `VALIDATION_FAILED` | 400 | 模块名不在 31 个取值内（如传了 `payment`），或检查项编号、通配的命名空间未登记 |

**副作用**：插入 `invariant_run`（`mode = full`，`trigger = manual`，`scope`，`status = running`，`started_at`）——迁移 `invariant_run.status: (新建) → running`（15-integration-ops.md:331，技术状态）；提交后投递到任务进程执行（`running → succeeded / failed`，非 HTTP 迁移）；写一条 `ops` 审计（类别 `system_ops`，动作 `ops.invariant.run`）。

### 3.75 admin.invariantViolation.list　不变量违规

`GET /admin/invariant-violations`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v`，或持有 `flow.ops.view`（流程运维只读，与 a02 工作台 `flow_ops` 待办同一判定），或财务模块 `≥ v` 且是主管（只读） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康“未解决的不变量违规”、流程运维“不变量违反” |
| 出处 | 路线图 `a01.invariant-violations.list`（合并 d3 `/flow/ops/violations` 与 d1 `/billing/invariants`）；15-integration-ops.md:370-456 |

**请求**：查询参数：`resolved`（boolean，默认 `false`）、`module`（可多值）、`severity`、`code`、`subjectType` + `subjectId`、`entityId`、`autoHealed`（boolean）、`page`、`pageSize`；排序默认级别升序、`first_seen_at` 升序。

**响应**：`AdminPage<InvariantViolationView>`（2.19）。

**错误**：无。

**副作用**：无。

### 3.76 admin.invariantViolation.resolve　填写违规处理结论

`POST /admin/invariant-violations/{invariantViolationId}/resolve`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：资金类（`severity = P1`，或检查项编号 `code` 以 `billing.`、`payment.` 开头）要求 `billing.invariant.resolve`；其余要求 `flow.ops.manage` 或 `sys.health.manage`（15-integration-ops.md:431）。不按 `module` 判定付款类：`module` 没有 `payment` 这个取值 |
| 回显 | 无 |
| 幂等 | `required` |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：系统健康、流程运维“标记已处理（必填说明）” |
| 出处 | 路线图 `a01.invariant-violations.resolve`；15-integration-ops.md:423-436；d3-flow.md:3283 |

**请求**：路径参数 `invariantViolationId`。请求体 `ResolutionBody`：`resolution`（string，必填，5–500 字，去掉首尾空白后非空）。

**响应**：`InvariantViolationView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STATE_NOT_ALLOWED` | 409 | 已解决 |
| `PERMISSION_DENIED` | 403 | 没有该违规（按级别与编号）要求的权限点 |

**副作用**：写 `invariant_violation.resolved_at`、`resolution`、`resolved_by_staff_id`（处理过程“人工处理”一行，本表没有状态列）；写一条 `ops` 审计（类别 `system_ops`，动作 `ops.invariant.resolve`，`entity_id` 取 `detail.entityId`）。同一违规之后再次被发现会新建一行。

### 3.77 admin.timer.list　定时器

`GET /admin/timers`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v`，或持有 `flow.ops.view` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“失败的定时器” |
| 出处 | 路线图 `a01.timers.list`（合并 d3 `/flow/ops/failed-timers`）；01-kernel-flow.md:302-405；d3-flow.md:3279 |

**请求**：查询参数：`status`（enum，可多值，默认 `failed`）、`kind`（可多值；取 x01 第 4.1、4.2 节登记的定时器 `kind`）、`subjectType` + `subjectId`、`entityId`、`fireFrom` / `fireTo`（date）、`page`、`pageSize`；排序 `fireAt`。

**响应**：`AdminPage<TimerView>`（2.20）。`kind` 与 `dedupeKey` 的取法以 x01 第 4.1、4.2 节为准。

**错误**：无。

**副作用**：无。

**说明**：a02 工作台 `flow_ops` 待办的三项计数（失败的定时器、死信投递、未解决且未自愈的违规）由本接口、3.80、3.75 所在模块各自导出的计数函数给出（`timers.countFailed`、`outbox.countDead`、`invariants.countOpen`），与这三个列表的默认筛选同一查询。流程运维页另调 a05 的 `admin.deliveryTicket.reevaluate`、`admin.deliveryTicket.forceTransition` 处理卡住的工单（列表 `admin.deliveryTicket.list?isStuck=true`），不在本文。

### 3.78 admin.timer.reschedule　定时器重新排期

`POST /admin/timers/{timerId}/reschedule`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.ops.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“重新排期” |
| 出处 | 路线图 `a01.timers.reschedule`；01-kernel-flow.md:366；d3-flow.md:3279 |

**请求**：路径参数 `timerId`。请求体 `NoteOptionalBody`：`note`（string，选填，≤200 字）。不接受新的到期时间：`fire_at` 是业务真相，只由业务事务改；到期已过的定时器复活后在下一轮扫描即执行。

**响应**：`TimerView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是 `failed`。

**副作用**：`timer.status: failed → scheduled`，`attempts = 0`、`retry_at` 置空（01-kernel-flow.md:366）；写一条 `ops` 审计（类别 `system_ops`，动作 `flow.timer.reschedule`，目标 `timer`）。

### 3.79 admin.timer.cancel　定时器标记为不再需要

`POST /admin/timers/{timerId}/cancel`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.ops.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无（守卫只有权限点与原因，未列锁版本，A21） |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“标记为不再需要” |
| 出处 | 路线图 `a01.timers.cancel`（A26 补）；01-kernel-flow.md:374 |

**请求**：路径参数 `timerId`。请求体 `ReasonRequiredBody`：`reason`（string，必填，5–200 字）。

**响应**：`TimerView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是 `failed`。

**副作用**：`timer.status: failed → cancelled`（01-kernel-flow.md:374），已取消的行不再占用去重键；写一条 `ops` 审计（类别 `system_ops`，动作 `flow.timer.cancel`，`reason_text`）。

### 3.80 admin.outboxDelivery.list　出站投递

`GET /admin/outbox-deliveries`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v`，或持有 `flow.ops.view` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“死信” |
| 出处 | 路线图 `a01.outbox-deliveries.list`；01-kernel-flow.md:231-300；d3-flow.md:3280 |

**请求**：查询参数：`status`（enum，可多值，默认 `dead`）、`subscriber`（取 x01 第 2.5 节登记的订阅者名）、`eventType`（取 x01 事件目录的事件名）、`aggregateType` + `aggregateId`、`entityId`、`page`、`pageSize`；排序 `-updatedAt`。

**响应**：`AdminPage<OutboxDeliveryView>`（2.20）。`outbox_delivery` 不在 A22 的只增大表之列，用页码分页；死信列表走 `ix_outbox_delivery_dead`。

**错误**：无。

**副作用**：无。

### 3.81 admin.outboxEvent.retry　死信重投

`POST /admin/outbox-events/{outboxEventId}/retry`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.ops.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“重投” |
| 出处 | 路线图 `a01.outbox-events.redeliver`（A9 改为 `retry`）；01-kernel-flow.md:283；d3-flow.md:3280 |

**请求**：路径参数 `outboxEventId`。请求体 `OutboxRetryBody`：`subscriber`（string，必填，订阅者注册名，取 x01 第 2.5 节；投递表主键是“事件 id + 订阅者”，订阅者放请求体，避免三层路径）、`note`（string，选填，≤200 字）。

**响应**：`OutboxDeliveryView`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `NOT_FOUND` | 404 | 该事件没有这个订阅者的投递行 |
| `STATE_NOT_ALLOWED` | 409 | 投递不是 `dead` |

**副作用**：`outbox_delivery.status: dead → retry`，`attempts = 0`，`next_attempt_at` = 现在（01-kernel-flow.md:283）；写一条 `ops` 审计（类别 `system_ops`，动作 `flow.outbox.retry`，`target_type = outbox_delivery`、`target_key = {outboxEventId}:{subscriber}`）。派发循环下一秒取走。

### 3.82 admin.webhookEvent.list　回调收件箱

`GET /admin/webhook-events`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：`system ≥ v`，或持有 `flow.ops.view` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“回调收件箱” |
| 出处 | 路线图 `a01.webhook-events.list`；15-integration-ops.md:48-148 |

**请求**：查询参数：`provider`（可多值）、`processState`（可多值，默认 `failed,dead`）、`eventType`、`receivedFrom` / `receivedTo`（date）、`cursor`、`limit`；排序固定 `-receivedAt`。

**响应**：`AdminCursorPage<WebhookEventView>`（2.20；只增大表，A22）。

**错误**：无。

**副作用**：无。

### 3.83 admin.webhookEvent.retry　死信回调重置

`POST /admin/webhook-events/{webhookEventId}/retry`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`flow.ops.manage` |
| 回显 | 无 |
| 幂等 | `required`（状态迁移） |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | 原型无：流程运维“重置死信回调” |
| 出处 | 路线图 `a01.webhook-events.reset`（A9 改为 `retry`）；15-integration-ops.md:120 |

**请求**：路径参数 `webhookEventId`。请求体 `NoteOptionalBody`：`note`（string，选填，≤200 字）。

**响应**：`WebhookEventView`。

**错误**：`STATE_NOT_ALLOWED`（409）：不是 `dead`。

**副作用**：`webhook_event.process_state: dead → received`，`attempts = 0`，`next_attempt_at` = 现在（15-integration-ops.md:120 的“人工重置”一行）；写一条 `ops` 审计（类别 `system_ops`，动作 `ops.webhook.retry`，目标 `webhook_event`）。**不发出站事件**：数据模型这一行没有事件；`webhook.received` 的去重键 `webhook.received:{webhookEventId}` 在首次收件时已用过（x01 第 2.3 节），`outbox_event.dedupe_key` 全表唯一、行不删除，再写会撞 `uq_outbox_event_dedupe_key`。重置后的行由收件箱的进程内循环（每分钟内）按 `next_attempt_at` 领走（15 分组 2.1 的说明）。微信支付的重处理用 `resourceCipher` 与 `key_version` 重新解密；载荷已清除的行重置后由处理函数按协议主动查询兜底。

### 3.84 admin.clientError.create　前端错误上报

`POST /admin/client-errors`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `optional`（C2：错误上报；与 `m.clientError.create`、`portal.clientError.create` 一致）：有会话则带员工 id，没有会话（登录页、激活页）也能报 |
| 回显 | 无 |
| 幂等 | `none`：错误上报（A18） |
| 乐观锁 | 无 |
| 限流 | `telemetry`（C68：登录用户 30 条 / 分；匿名每 IP 10 条 / 分） |
| 对应画板 | 全部后台页面（A:Main 起） |
| 出处 | 路线图 `a01.telemetry.report`（`/admin/telemetry/envelope` 统一为 `client-errors`，C10）；d7-platform.md:876-895、1914 |

**请求**：请求体 `SentryEnvelope`，即 Sentry envelope 原文（`Content-Type: application/x-sentry-envelope`），≤200KB；项目须在白名单内。前端 `beforeSend` 已清洗请求体、令牌、形如手机号与信用代码的字符串。与 p01、m08 的同类接口同形（p01 的请求）。

**响应**：HTTP 202，`data = null`（C24）；不等上游。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `RATE_LIMITED` | 429 | 超过上报限额 |
| `VALIDATION_FAILED` | 400 | 不是合法的 envelope、项目不在白名单；超过 200KB 由网关直接 413 |

**副作用**：放进进程内有界队列（200 条，满了丢最新的），后台循环转发上游，失败即丢弃、10 秒内失败 5 次熔断 60 秒（d7-platform.md:885-893）。不写库。

### 3.85 admin.debug.clientIp.get　回显客户端 IP

`GET /admin/debug/client-ip`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`sys.super_admin`（A45） |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 开关 | 部署配置开启时才挂载（M0 验证用，上线后关闭）；关闭时 404 |
| 对应画板 | 原型无：系统健康页底部的部署核对 |
| 出处 | 路线图 `a01.debug.client-ip`；d4-identity.md:2300；d7-platform.md:1375 |

**请求**：无。

**响应**：`ClientIpEcho` = `{ clientIp, remoteAddr, xForwardedFor, xRealIp, trustedProxyHops }`：`clientIp` 为按可信代理跳数解析出的客户端 IP，其余为原始头与连接地址，用于核对 nginx 的 `set_real_ip_from` 与 `TRUSTED_PROXY_CIDRS`。

**错误**：`NOT_FOUND`（404）：已关闭。

**副作用**：无。

### 3.86 admin.auth.me.enrollTotp　本人重新绑定动态口令：生成新密钥

`POST /admin/auth/me/enroll-totp`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；`x-permission: self.mfa.reset`（自助类再验证标记，A60、A88、C66）：对全体员工生效，注册表标再验证，窗口外 403 `STEP_UP_REQUIRED`，前端再验证后用原请求重放 |
| 回显 | 无 |
| 幂等 | `none`：结果只有一次性的新密钥，重放没有意义（C50 与 `none` 的分工）；重复调用只是覆盖上一个待确认密钥，没有别的写入。已登记进 C47 的 `none` 清单（A139） |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记，会话内按会话计数） |
| 对应画板 | 原型无：用户菜单“动态口令设置”（design-spec.md:906） |
| 出处 | 初稿 3.86 建议条目；A60；C66、C68；d4-identity.md:1053-1055 |

**请求**：无请求体。

**响应**：`TotpReEnrollment` = `{ otpauthUri, secret, pendingExpiresAt }`：`otpauthUri`、`secret` 同 3.5 的 `TotpEnrollment`（不带票据）；`pendingExpiresAt` 是待确认密钥的失效时刻（生成 + 15 分钟，与 3.5 的票据同长）。`Cache-Control: no-store`。

**错误**：`STEP_UP_REQUIRED`（403）：会话的 `stepup_at` 超过 10 分钟（C66）。

**副作用**：写 `staff.totp_pending_secret_enc`（独立的 MFA 密钥加密）、`staff.totp_pending_at`，覆盖上一次的待确认密钥；当前已绑定的 `totp_secret_enc` 不动，确认（3.87）之前旧验证器照常可用。超时未确认的由清理任务清空。无状态迁移、无出站事件、无审计（确认时才记）。

### 3.87 admin.auth.me.confirmTotp　本人重新绑定动态口令：确认并换发恢复码

`POST /admin/auth/me/confirm-totp`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`（本人）；`x-permission: self.mfa.reset`（同 3.86） |
| 回显 | 无 |
| 幂等 | `required`：有业务写入（替换密钥、重发恢复码、吊销其他会话），必须防重放；结果脱敏（A80、C50）：`x-redact-on-replay: ['recoveryCodes']`，重放时 `recoveryCodes` 为 `null` 并带 `replayed: true`，要新的恢复码只能再走一次 3.86、3.87 |
| 乐观锁 | 无 |
| 限流 | `admin.login`（C68 已登记，会话内按会话计数） |
| 对应画板 | 原型无：用户菜单“动态口令设置”（展示新的恢复码） |
| 出处 | 初稿 3.86 建议条目；A60、A80；C50、C66、C68；d4-identity.md:1055 |

**请求**：请求体 `ConfirmTotpSelfBody`：`code`（string，必填，6 位数字，用 3.86 给的新密钥算出）。

**响应**：`TotpReEnrollResult` = `{ recoveryCodes: array<string> | null, recoveryCodesLeft: integer, replayed: boolean }`：`recoveryCodes` 为 10 个新的一次性恢复码明文，只在首次执行时返回（库里只存 sha256），前端要求员工下载或抄写；`recoveryCodesLeft` 恒为 10。`Cache-Control: no-store`。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STEP_UP_REQUIRED` | 403 | 会话的 `stepup_at` 超过 10 分钟 |
| `STATE_NOT_ALLOWED` | 409 | 没有待确认的新密钥（`staff.totp_pending_secret_enc` 为空或已超时），`details = { reason: 'no_pending_secret' }`，请先调 3.86。不用 401 的 `AUTH_TICKET_INVALID`：会话内返回 401 会被端上当作登录失效 |
| `MFA_CODE_INVALID` | 400 | 动态口令与新密钥对不上；可重输 |

**副作用**（同一事务）：`staff.totp_secret_enc` ← 待确认密钥，`staff.totp_enrolled_at` = 现在，清空 `totp_pending_*`，写 `staff.totp_last_step`；`staff.recovery_codes` = 10 个新恢复码的 sha256（旧恢复码全部作废）；吊销本人的其他会话（`staff_session.revoked_at`，`revoke_reason = mfa_reset`），当前会话保留，`stepup_at` = 现在；写一条 `ops` 审计（类别 `account_security`，动作 `sys.staff.totp_rebound`，不记密钥与恢复码）。无状态迁移、无出站事件。

**说明**：超级管理员替别人重置用 3.21，本人不能用 3.21 重置自己（`SELF_OPERATION_FORBIDDEN`）。

### 3.88 admin.staff.summary　员工计数

`GET /admin/staff/summary`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；模块 `system ≥ v` |
| 回显 | 无 |
| 幂等 | `none`：纯查询 |
| 乐观锁 | 无 |
| 限流 | `admin.global` |
| 对应画板 | A:SysStaff 页头“共 N 个账号 · 启用 N · 待启用 N · 已禁用 N”（proto-admin-e.md:251） |
| 出处 | 初稿 3.86 建议条目；A23；C83 |

**请求**：查询参数与 3.12 相同，去掉 `status`、`withLoad`、`recommendPool`、`recommendCityCode`、分页与排序（C83）：`q`、`roleKey`、`isLead`、`staffGroupId`、`pool`，都选填。路由先于 `/admin/staff/{staffId}` 注册（A8）。

**响应**：`StaffCounts`：

| 字段 | 类型 | 必有 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `total` | integer | 是 | 账号总数（“共 N 个账号”） | 计算：`staff` |
| `byStatus` | object | 是 | `{ active, pending, disabled }`（“启用 · 待启用 · 已禁用”），与列表 `status=` 同口径 | 计算：`staff.status` |
| `pendingActivation` | integer | 是 | 启用但还没设置密码的人数（行内“待激活”） | 计算：`staff.status = active` 且 `staff.password_hash` 为空 |
| `locked` | integer | 是 | 任一失败桶在锁定期内的人数 | 计算：`staff.locked_until_trusted`、`staff.locked_until_untrusted` |

**错误**：无。

**副作用**：无。

### 3.89 admin.file.cancel　取消未确认的上传登记

`POST /admin/files/{fileId}/cancel`

| 项 | 内容 |
| --- | --- |
| 鉴权 | `staff`；`permission: assert-in-handler`：上传人本人（`file_object.upload_actor_type = staff` 且 `upload_actor_id` = 调用方）；否则 404 |
| 回显 | 无 |
| 幂等 | `required`（状态迁移，A17） |
| 乐观锁 | 无（条件更新 `status = pending`） |
| 限流 | `admin.global` |
| 对应画板 | 各上传处移除未传完的文件（A:DramaEdit、A:TicketDetail、A:AdTasks、A:MerchantDetail 等） |
| 出处 | 初稿 3.86 建议条目；A57；C12、C59；06-media.md:193；与 m08 的 `m.file.cancel` 同法 |

**请求**：路径参数 `fileId`；无请求体。

**响应**：`AdminFileView`（`status = expired`）。

**错误**：

| 错误码 | HTTP | 何时 |
| --- | --- | --- |
| `STATE_NOT_ALLOWED` | 409 | 文件已确认（`promoting`、`stored` 或 `rejected`）；已入库但没被引用的文件由清扫处理，不需要取消 |
| `CONFIRM_IN_PROGRESS` | 409 | 确认正在进行（`confirming_until` 未过期），1 秒后重试（m08 定义） |
| `NOT_FOUND` | 404 | 文件不存在或不是本人上传 |

**副作用**：`file_object.status: pending → expired`（客户端取消，06-media.md:193），清空 `incoming_key`；提交后尽力中止该写入区前缀下的分块上传并删除对象（失败由清扫与桶生命周期兜底，d5-media.md:1067）。已是 `expired` 时不改库，直接返回当前状态。制作类文件的 `production_record` 留在 `uploading`，由媒体的收敛扫描按文件状态收尾（`ix_production_record_pipeline`，06 分组 2.9）。无出站事件、无审计。

## 4. 枚举

| 名称 | 取值 | 含义 |
| --- | --- | --- |
| `roleKey` | `super_admin` / `cs` / `delivery_manager` / `editor` / `publisher` / `content_ops` / `channel_ops` / `finance` | 同数据模型 `staff_role.key`（`channel_ops` V1.1） |
| `ModuleKey` | `workbench` / `drama` / `billing` / `merchant` / `order` / `delivery` / `publish` / `service` / `finance` / `report` / `ops` / `system` / `channel` | 13 个菜单模块（d7-platform.md:950-1000 的模块键）；`staff_role.module_levels` 的键，以权限注册表为准 |
| `ModuleLevel` | `n` / `v` / `o` / `e` | 同数据模型 `staff_role.module_levels` 的值：无 / 查看 / 本人任务 / 编辑 |
| `dataScope` | `own` / `group` / `all` | 同数据模型 `staff_role.data_scope` |
| `staffStatus` | `pending` / `active` / `disabled` | 同数据模型 `staff.status`；“待激活”不是状态值，是 `active` 且未设置密码 |
| `wecomBindStatus` | `none` / `invited` / `bound` / `unbound` | 同数据模型 `staff.wecom_bind_status` |
| `disabledReason` | `resigned` / `reassigned` / `long_leave` / `other` | 同数据模型 `staff.disabled_reason` |
| `handoverReason`（3.19） | `reassigned` / `long_leave` / `other` | `assignment_history.reason_code` 的子集 |
| `activationPurpose` | `activate` / `reset_password` | 同数据模型 `staff_activation.purpose` |
| `activationDelivery` | `sms` / `manual` | 同数据模型 `staff_activation.delivery` |
| `authMethod` | `password+totp` / `password+recovery` | 同数据模型 `staff_session.auth_method` |
| `revokeReason` | `logout` / `disabled` / `password_reset` / `mfa_reset` / `phone_changed` / `admin` | 同数据模型 `staff_session.revoke_reason`（`x-open-enum`） |
| `AuthNext.next` | `mfa` / `set_password` / `enroll_totp` / `login` | 本文定义：登录前的下一步 |
| `mfaMethod` | `totp` / `recovery` | 本文定义：第二因子的方式 |
| `pool` | `delivery_manager` / `editor` / `publisher` / `cs` | 同数据模型 `assignment_pool_member.pool` |
| `WorkSource` | `store_manager` / `ticket_editor` / `ticket_publisher` / `ad_editor` / `service_ticket_owner` / `follow_up_owner` | 同数据模型 `assignment_history.source`（`x-open-enum`）；与对象类型的配对见 `ck_assignment_history_source_subject`（`store_manager` 对应 `store`、`drama_order`、`delivery_ticket`、`service_ticket`） |
| `StaffAction` | `update` / `enable` / `disable` / `handover` / `reset-password` / `reset-mfa` / `reissue-activation-code` / `unlock` / `invite-wecom` / `bind-wecom` | 本文定义（C16），动作名取 C12 的账号类原名；角色尚未开放的待启用员工不给 `enable` |
| `approvalKind` | `qualification` / `channel_account` / `launch_link` / `order_cancel` / `ad_cancel` / `qualification_cancel` / `plan_refund` / `points_adjust` / `subscription_extend` / `finance_config_change` / `account_change` / `transfer_confirm` | 同数据模型 `approval_request.kind` |
| `approvalCategory` | `review` / `approval` | 同数据模型 `approval_request.category` |
| `approvalStatus` | `pending` / `approved` / `rejected` / `withdrawn` | 同数据模型 `approval_request.status` |
| `ApprovalTab`（3.36） | `todo` / `submitted` / `done_today` / `all` | 本文定义：待我处理 / 我发起的 / 今日已处理 / 全部；3.37 的计数键为其驼峰写法 `todo`、`submitted`、`doneToday`、`all` |
| `ApprovalAction` | `approve` / `reject` / `withdraw` / `approve-review` / `reject-review` | 本文定义（C16），执行在领域资源上 |
| `ApprovalBadge` | `check_mismatch` / `final_rejected` / `overdue` | 本文定义（`x-open-enum`）：从领域表派生的角标 |
| `auditStream` | `ops` / `activity` / `access` | 同数据模型 `audit_log.stream` |
| `auditCategory` | 数据模型 03 分组第 3 节的 17 个登记值，加 A107 补登的 8 个（`system_ops`、`report`、`merchant_quota`、`merchant_lifecycle`、`referral_code`、`ops_config`、`agreement`、`notify_config`），再加 A155 补登的 10 个（`payment`、`invoice`、`recon`、`finance_config`、`docs`、`delivery`、`service_ticket`、`approval`、`review`、`flow`），共 35 个，逐个见下表；与 a02 第 2.7 节对照表一致 | `audit_log.category`（代码登记，`x-open-enum`） |
| `actorType` | `merchant` / `staff` / `system` / `partner` | 同数据模型 `audit_log.actor_type`（`partner` V1.0 只声明） |
| `PiiPurpose`（3.41） | `contact_merchant` / `verify_identity` / `finance_ops` / `other` | 本文定义：查看明文的用途 |
| `dictStructure` | `flat` / `tree` | 同数据模型 `dict_type.structure` |
| `disablePolicy` | `free` / `block_if_referenced` / `never` | 同数据模型 `dict_type.disable_policy` |
| `DictLockRule`（`DICT_ITEM_LOCKED.details.rule`） | `never_disable` / `system_enum` / `special_not_open` | 本文定义 |
| `paramType` | `int` / `bp` / `int_list` / `time_hm` / `bool` / `enum` / `text` / `json` / `sla_policy` | 同数据模型 14 分组 4.2 的定义类型 |
| `snapshotOn` | `create` / `read` | 本文定义：参数在单据创建时快照或每次读取 |
| `calendarKind` | `weekday` / `weekend` / `holiday` / `adjusted_workday` | 同数据模型 `work_calendar_day.kind`；导入只接受后两个 |
| `flagValueType` | `bool` / `enum` / `json` | 同数据模型 `feature_flag.value_type` |
| `flagExposedTo` | `client` / `server` | 同数据模型 `feature_flag.exposed_to` |
| `checklistCode` | `qc.sample` / `qc.episode` / `qc.package` / `delivery.precheck` / `launch.verify` / `patrol.check` / `takedown.check` / `takedown.absence_check` / `account.verify` | 同数据模型 `checklist_template.code` |
| `checklistStatus` | `draft` / `active` / `retired` | 同数据模型 `checklist_template.status` |
| `fileCategory` | 32 个分类码（06 分组 3.1） | 同数据模型 `file_object.category`（`x-open-enum`） |
| `fileStatus` | `pending` / `promoting` / `stored` / `rejected` / `expired` / `deleting` / `deleted` | 同数据模型 `file_object.status` |
| `rejectReason`（文件） | `size_mismatch` / `bad_magic` / `changed_after_confirm` / `copy_verify_failed` / `stamp_failed` | 同数据模型 `file_object.reject_reason` |
| `uploadMode` | `post` / `multipart`（后台登记不会出现 `server`） | 同数据模型 `file_object.upload_mode` |
| `moderationState` | `none` / `pending` / `pass` / `review` / `block` | 同数据模型 `file_object.moderation_state` |
| `productionKind` | `sample` / `final` / `ad` | 同数据模型 `production_record.kind` |
| `pipelineState` | `uploading` / `checking` / `ready` / `rejected` | 同数据模型 `production_record.pipeline_state` |
| `purgeRunMode`、`purgeRunState` | `list_only` / `auto`；`proposed` / `held` / `approved` / `running` / `done` / `aborted` / `rejected` | 同数据模型 `file_purge_run.mode`、`file_purge_run.state` |
| `mediaJobKind`、`mediaJobState` | 16 个种类；`queued` / `running` / `submitting` / `submitted` / `succeeded` / `failed` / `canceled` | 同数据模型 `media_job.kind`、`media_job.state` |
| `alertSeverity`、`alertKind`、`alertStatus` | `P1` / `P2` / `P3`；`probe` / `event`；`open` / `acked` / `resolved` | 同数据模型 `alert_event.severity`、`kind`、`status` |
| `invariantRunMode`、`invariantRunTrigger`、`invariantRunStatus` | `quick` / `full`；`schedule` / `deploy` / `drill` / `manual`；`running` / `succeeded` / `failed` | 同数据模型 `invariant_run.mode`、`trigger`、`status` |
| `invariantSeverity`、`invariantModule` | `P1` / `P2`；31 个模块名 | 同数据模型 `invariant_violation.severity`、`module`（后者 `x-open-enum`） |
| `timerStatus` | `scheduled` / `dispatched` / `fired` / `skipped` / `cancelled` / `failed` | 同数据模型 `timer.status` |
| `outboxDeliveryStatus` | `pending` / `leased` / `done` / `retry` / `dead` | 同数据模型 `outbox_delivery.status` |
| `webhookProvider`、`webhookMode`、`webhookProcessState` | `wechatpay` / `wechat` / `wecom` / `ci` / `asr` / `sms` / `esign`；`inline` / `inbox`；`received` / `processed` / `ignored` / `failed` / `dead` | 同数据模型 `webhook_event.provider`、`mode`、`process_state` |

审计类别的登记（a02 的请求）：类别由登记它的文档定义含义；所属菜单模块以 a02 第 2.7 节的对照表为准（a02 维护，工作台实时动态按它裁剪），本文不重复。A:SysLogs 的类型筛选是前端常量，原型列出的是 03 分组第 3 节的前八项；`pii_reveal`、`file_access` 属 `access` 流，只在 `stream=access` 下出现（3.39）。其他文档新增类别时，在本表与 a02 的对照表各补一行。

| 类别 | 含义 |
| --- | --- |
| `refund` | 退款 |
| `points_adjust` | 积分调整 |
| `term_adjust` | 套餐有效期调整 |
| `price_adjust` | 积分价调整 |
| `points_expire` | 积分清零 |
| `points_grant` | 积分发放 |
| `profile_edit` | 档案修改 |
| `staff_authz` | 员工与权限 |
| `param` | 参数修改（参数、日历、开关、清单模板） |
| `dict` | 字典修改 |
| `plan_config` | 套餐与积分包调整 |
| `export` | 导出 |
| `member` | 成员 |
| `account_security` | 账号安全 |
| `manager_assign` | 交付经理分配与转移 |
| `pii_reveal` | 查看字段明文（`access` 流） |
| `file_access` | 敏感文件读地址签发（`access` 流） |
| `system_ops` | 系统运维：告警、违规、定时器、死信、回调、文件恢复与彻底删除、清除放行、媒体重试（A107） |
| `report` | 报表（月度快照重出等，a02） |
| `merchant_quota` | 主体额度覆盖（a03） |
| `merchant_lifecycle` | 后台关闭主体（a03；商家账号的禁用、强制下线记 `account_security`） |
| `referral_code` | 渠道码登记（a03） |
| `ops_config` | 运营配置（a09） |
| `agreement` | 协议版本（a09） |
| `notify_config` | 消息模板与场景（a09） |
| `payment` | 付款单与转账凭证（a07；A155） |
| `invoice` | 开票与发票邮件重发（a07、a09；A155） |
| `recon` | 对账差异（a07；A155） |
| `finance_config` | 受控财务配置与收款账户（a07；A155） |
| `docs` | 授权书更正、作废并重出（a05；A155） |
| `delivery` | 交付活动流，如改约定上线日（a05；A155） |
| `service_ticket` | 工单内容编辑与分配（a08；A155） |
| `approval` | 审批决定（按 `approval_request.kind` 的查看模块；A155） |
| `review` | 审核决定（按 `approval_request.kind` 的查看模块；A155） |
| `flow` | 流程人工纠偏（a08 3.10；A155） |

内部取值（不出接口，写库时用）：`auth_event.event` 本文写 `login_success`、`login_fail`、`locked`、`step_up`、`logout`，`auth_event.method` 写 `password`、`password+totp`、`password+recovery`、`totp`；`audit_log.auth_method` 写 `password+totp`、`password+recovery`。本文写的审计动作（`audit_log.action`）：`sys.staff.*`（`create`、`update`、`enable`、`disable`、`handover`、`reset_password`、`reset_mfa`、`reissue_activation_code`、`unlock`、`wecom_invite`、`wecom_bind`、`pool_memberships`、`duty`、`password_set`、`password_change`、`totp_enrolled`、`totp_rebound`）、`sys.session.revoke`、`sys.role.edit`、`sys.dict.*`、`sys.param.*`、`sys.calendar.import`、`sys.flag.update`、`flow.checklist.*`、`files.*`、`media.job.retry`、`ops.alert.*`、`ops.invariant.*`、`flow.timer.*`、`flow.outbox.retry`、`ops.webhook.retry`、`pii.<field>.reveal`。

## 5. 错误码

本文新定义的领域错误码。员工与权限段取 48000–48199，文件与媒体任务段取 46400–46499，配置段取 47300–47399（A70）。清单类 `CHECKLIST_*` 两个码归本文（A77、C28），a03、a05、a06 只引用符号。引用其他文档的（A77 的共用领域码归属表）：`ASSIGNEE_INVALID`（45308，a05-order-delivery；取代本文初稿的 `HANDOVER_TARGET_INVALID`，48011 释放）；`FILE_NOT_USABLE`（46001，m03-profile-asset）；`DICT_ITEM_DISABLED`（47001，m08-support-misc）；上传类 `FILE_TYPE_NOT_ALLOWED`、`FILE_TOO_LARGE`、`UPLOAD_EXPIRED`、`UPLOAD_CREDENTIAL_LIMIT`、`CONFIRM_IN_PROGRESS`、`UPLOAD_NOT_FOUND`、`UPLOAD_REJECTED`（47051–47057，m08-support-misc；商家端与后台上传共用一组符号）。

| 符号 | 数值 | HTTP | 可重试 | `details` | 含义（默认文案的意思） |
| --- | --- | --- | --- | --- | --- |
| `AUTH_TICKET_INVALID` | 48001 | 401 | 否 | 无 | 操作已超时，请重新登录或重新激活（设置密码、绑定动态口令的票据无效或过期） |
| `TOTP_ALREADY_ENROLLED` | 48002 | 409 | 否 | 无 | 已绑定动态口令，不能用激活码重新绑定；如需更换请联系超级管理员重置（d4-identity.md:1054、2333） |
| `PASSWORD_POLICY_VIOLATED` | 48003 | 400 | 否 | `{ rules: string[] }`，取值 `min_length`、`letters_and_digits`、`contains_phone`、`weak_password`、`same_as_current` | 密码至少 10 位，须同时包含字母与数字，不能包含手机号或使用常见密码（本文补） |
| `PASSWORD_INCORRECT` | 48004 | 400 | 否 | 无 | 当前密码不正确（本文补） |
| `MFA_CODE_INVALID` | 48005 | 400 | 否 | 无 | 动态口令不正确，请等待下一个口令后重试（本文补） |
| `CANNOT_DISABLE_SELF` | 48006 | 409 | 否 | 无 | 不能禁用当前登录的账号（d4-identity.md:1100、2337） |
| `SELF_OPERATION_FORBIDDEN` | 48007 | 409 | 否 | 无 | 不能对自己执行这个操作（改自己的角色、重置自己的密码或动态口令、强制自己下线）（本文补） |
| `LAST_SUPER_ADMIN` | 48008 | 409 | 否 | 无 | 至少要保留一名启用的超级管理员（d4-identity.md:1100、2337） |
| `OPEN_WORK_EXISTS` | 48009 | 409 | 否 | `{ openWork: array<{ source, count }> }` | 该员工名下还有在办事项，请先移交再修改角色（d4-identity.md:1115、2337） |
| `NO_HANDOVER_CANDIDATE` | 48010 | 409 | 否 | `{ roleKey }` | 没有可接收在办事项的同岗位员工，请先新增一名再操作（d4-identity.md:1102、2337） |
| `LEAD_REMOVAL_ACK_REQUIRED` | 48012 | 409 | 否 | `{ staffGroupId }` | 修改后该组将没有主管，请确认（d4-identity.md:1116） |
| `STAFF_PHONE_TAKEN` | 48013 | 409 | 否 | 无 | 该手机号已被其他员工使用（本文补；商家端的 `PHONE_TAKEN` 文案不适用） |
| `WECOM_USERID_TAKEN` | 48014 | 409 | 否 | `{ staffId, staffName, staffStatus }` | 该企业微信账号已绑定其他员工（本文补） |
| `WECOM_CODE_INVALID` | 48015 | 400 | 否 | 无 | 扫码已失效，请重新扫码（本文补） |
| `ROLE_LOCKED` | 48016 | 409 | 否 | 无 | 超级管理员角色不可修改（本文补） |
| `POOL_ROLE_MISMATCH` | 48017 | 409 | 否 | `{ pool, roleKey }` | 员工的岗位与分配池不符，或员工未启用（本文补；`staff.I9`） |
| `FILE_CATEGORY_NOT_ALLOWED` | 46401 | 400 | 否 | `{ category }` | 该类文件不能在这里上传或下载（本文补） |
| `PRODUCTION_CONTEXT_REQUIRED` | 46402 | 400 | 否 | `{ missing: string[] }` | 请填写制作信息与 AI 使用声明（本文补；d5-media.md:1022） |
| `FILE_NOT_AVAILABLE` | 46403 | 409 | 否 | `{ status }` | 文件暂不可用（未入库、已清除或已拦截）（本文补） |
| `FILE_RESTORE_WINDOW_PASSED` | 46404 | 409 | 否 | `{ deletedAt }` | 已超过可恢复期限（本文补） |
| `FILE_IN_USE` | 46405 | 409 | 否 | `{ refs: array<{ refType, refId }> }` | 文件仍在使用中，请先在业务中移除（本文补） |
| `MEDIA_JOB_NOT_RETRYABLE` | 46406 | 409 | 否 | `{ reason }` | 该任务对应的业务已不需要重试（本文补） |
| `DICT_TYPE_NOT_EDITABLE` | 47301 | 409 | 否 | 无 | 该字典类型不支持新增（本文补；proto-admin-e.md:338、344） |
| `DICT_NAME_DUPLICATED` | 47302 | 409 | 否 | 无 | 同一层级下已有同名选项（本文补） |
| `DICT_ITEM_IN_USE` | 47303 | 409 | 否 | `{ refCount: integer }` | 已有业务在用该选项，不能停用（本文补；d6-notify-docs-data.md:1507） |
| `DICT_ITEM_LOCKED` | 47304 | 409 | 否 | `{ rule }` | 该选项不允许此操作（不可停用、系统内置或特殊行业不可开放）（本文补） |
| `PARAM_WITHDRAW_TOO_LATE` | 47305 | 409 | 否 | `{ effectiveAt }` | 即将生效或已生效的参数不能撤销，请保存新值（本文补；d6-notify-docs-data.md:1589） |
| `CHECKLIST_VERSION_STALE` | 47306 | 409 | 否 | `{ code, currentVersionNo }` | 核对清单已更新，请刷新后按新清单检查（14-config-data.md:664；提交检查结果的接口复用，a03、a05、a06） |
| `CHECKLIST_NOT_PASSED` | 47307 | 400 | 否 | `{ missingKeys: string[], failedKeys: string[], invalidNaKeys: string[] }` | 清单没有全部通过：必填条目缺结论、有不通过项，或在不允许“不适用”的条目上填了不适用（A77 归本文重新取号；a06 初稿的 46203 释放，a05、a06 改为引用） |

本文用到的通用码（C27）中有特殊含义的：`AUTH_FAILED`（401）在 3.1–3.3 统一表示登录与激活失败，不区分原因；`PERMISSION_DENIED`（403）在 `assert-in-handler` 的接口表示处理器里的判定不通过；`STEP_UP_REQUIRED`（403）由注册表标了再验证的权限点或标记触发（3.17、3.20、3.21、3.35、3.64、3.86、3.87 等；3.41 由处理器按字段的权限点校验）；`CONFIRM_MISMATCH`（409）在 3.17、3.20、3.21、3.64、3.66 比对回显；`VERSION_CONFLICT`（409）在 3.47 的 `details.conflicts` 列出冲突的参数键；`RATE_LIMITED`（429）在 3.41 表示明文查看超限；`FEATURE_DISABLED`（403）在 3.10 表示开关关闭时带了扫码 `code`；`STATE_NOT_ALLOWED`（409）在 3.14、3.16 另表示角色尚未开放（`details.reason = role_not_available`），在 3.87 表示没有待确认的新密钥；`IDEMPOTENCY_IN_PROGRESS`（409）在三段式用例 3.10（扫码分支）、3.59、3.63、3.64。

## 6. 待确认

只留需要产品、业务、法务决定的问题（A108）。初稿的其余各项已由第十节裁决定论或按导语接受默认：原 1 → A88；原 2 → A80；原 3 → A78；原 5、7、8 接受默认（本人改密码保留当前会话、吊销其他会话，`revoke_reason = password_reset`，与 A81 同一口径；解锁只写审计）；原 6 → A107（`system_ops` 已登记）；原 9 → C68；原 10 → A103；原 12 改 `optional`（C2）；原 13 接受默认。

| # | 问题 | 默认做法 | 谁定 |
| --- | --- | --- | --- |
| 1 | 系统类页面的查看都写成“`system ≥ v`”，按 PRD 矩阵实际只有超级管理员；财务主管要看系统健康（d7-platform.md:2003） | 告警与违规列表对“财务模块 ≥ v 且是主管”另行放行（`assert-in-handler`）；流程运维的只读列表另认 `flow.ops.view`（键与默认授予“仅超级管理员”已由 A129 采纳，这里只问财务主管的放行）；其余系统页只给 `system ≥ v` | 产品 |
| 2 | 清单模板草稿要不要可改（数据模型说草稿编辑时比对 `lock_version`，但路线图没有修改接口） | V1.0 不提供修改：放弃后重新建版本；若要改，补 `PATCH /admin/checklist-templates/{checklistTemplateId}`（带 `lockVersion`，仅草稿） | 产品 |
| 3 | “彻底删除”（A36）是否需要双人确认或审批，删除后文件行是否保留 | 按 A36：仅超级管理员、再验证、填原因、写审计；行保留、`original_name` 置空并写 `file_object.erased_at`（`06-media.md:1877` 待确认 4，同一问题） | 法务 |
| 4 | 员工在用户菜单手填的企业微信账号（A103，3.10）系统无法核验，填错会让企业微信回调对不到人 | 填写即生效（`bound`），审计记 `meta.method = manual`；超级管理员在 A:SysStaff 看到后可用 3.25 改正。若要求“先核对再生效”，需加一个“待核对”状态（`staff.wecom_bind_status` 的 CHECK 改）和超级管理员的确认接口 | 产品、安全负责人 |

## 7. 修订记录

| 日期 | 改动 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 初稿：85 条接口（V1.0），公共结构 `StaffMe`、`StaffDetail`、`ApprovalItem`、`AuditLogItem`、`FileRegistration` 等，新错误码 48001–48017、46401–46406、47301–47306；上传类错误码引用 m08 的 47051–47057 | 路线图 `doc = a01-system`；A1–A75；C1–C84 |
| 2026-10-03 | 相对路线图的取舍：退出登录幂等改 `none`（A43，并建议改为 `DELETE /admin/sessions/current`）；禁用、重置密码、重置第二因子用 `sys.staff.secure_ops`（A46）；开关管理与部署核对用 `sys.super_admin`（A45）；审批、明文查看、文件签发等声明 `assert-in-handler`（A45）；`purge_run` 与 `webhook_event` 的迁移写实际状态列（`file_purge_run.state`、`webhook_event.process_state`）；选人推荐改按池与城市；日历导入、参数保存一律 `required`（A17） | A17、A43、A45、A46；数据模型 06、15 分组 |

**第二轮**（2026-10-03；处理第十节裁决 A76–A120、`review/xdoc-a01-system.md`、两位复核员意见与整体核对）：

| 日期 | 改动 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 接口清单：退出登录改为 3.11 `admin.session.current.delete`（`DELETE /admin/sessions/current`，幂等 `none`），初稿 `POST /admin/auth/logout` 不再保留；初稿 3.86 的建议条目收进路线图切片并补成完整小节：3.86 `admin.auth.me.enrollTotp`、3.87 `admin.auth.me.confirmTotp`（`self.mfa.reset`；enroll 为 `none`、confirm 为 `required` 加结果脱敏）、3.88 `admin.staff.summary`、3.89 `admin.file.cancel`。接口数 85 → 89 | A43、A82、A60、A88、A23、A57；C4、C12、C47、C50、C66、C83；复核 A、B |
| 2026-10-03 | 员工禁用与移交（3.17、3.19）：门店交付经理的改派同时改该门店未结订购单与未归档未终止工单的 `delivery_manager_id`，每个对象一行 `assignment_history`，联系时限只放门店那一行；客服工单的改派补 `transfer` 迁移（from = to，原因取本批 `reason_code`）与 `service_ticket.transferred`；定时器写明去重键；“接收人无效”改用 a05 的 `ASSIGNEE_INVALID`，删除 48011 | 09-order-ad.md:218-219、10-delivery.md:1261、12-support.md:160、168、419；x01 3.12、5.13；A77；复核 A、B |
| 2026-10-03 | 结果脱敏：`StaffMutationResult`、`ActivationIssue` 加 `replayed`，五条激活码接口登记 `x-redact-on-replay`；删去待确认 2 | A80；C50、C75；复核 B |
| 2026-10-03 | 企业微信（A103）：3.10 开关关闭时收员工手填的 `wecomUserid`，打开时收扫码 `code`（三段式只在扫码分支）；`userid` 挂在非启用员工名下时同事务转过来，挂在启用员工名下才报 `WECOM_USERID_TAKEN`；3.24 邀请不再受开关拦截，提醒员工到 3.10 绑定；3.14 的 `inviteWecom` 只在立即启用时生效；新增待确认 4（手填账号是否先核对） | A103；03-staff-authz-audit.md:166；复核 A |
| 2026-10-03 | 渠道运营等未开放角色：3.14 允许 `activateNow = false` 建待启用员工，立即启用与 3.16 启用返回 `STATE_NOT_ALLOWED`（`role_not_available`） | SysStaff.dc.html:91、164；03-staff-authz-audit.md:71；复核 A |
| 2026-10-03 | 选人（3.12）：`StaffListItem` 加 `openWorkBySource`（按来源与对象类型），选人弹层取对应一项；`pool` 可多值；持 `service.ticket.assign` / `transfer` 的员工可只读列出交付经理池；`PoolMemberList` 的 `isNext` 改名 `isRecommended`；`HandoverResult.moved`、`OpenWorkSummary.bySource` 带 `subjectType` | a08 的请求；proto-admin-a.md:125、proto-admin-c.md:371、418；复核 A、B |
| 2026-10-03 | 审批（2.10、3.36、3.37）：`ApprovalItem` 加 `deliveryTicketId` 与读取时派生的 `handler`；`overdue` 补 A93 的“无时限按 `approval.escalate_workdays`”；计数响应改名 `ApprovalCounts`（`ApprovalSummary` 留给快照），键与 `tab` 对齐并加 `byStatus`、`all`，查询参数与列表相同；“我的待审批”页与菜单角标共用 `total.todo`；新增共用的 `ApprovalDecisionView` | C83、A23、A93；03-staff-authz-audit.md:736、832、948；CreditAdjust.dc.html:62-64、215-225；a02、a06、a07 的请求；复核 A、B |
| 2026-10-03 | 参数（2.13、3.46、3.47）：`ParamItem` 加 `latestRev`，保存回传它（有预约值时不再必然冲突），写明立即生效与预约并存的规则；`ParamList` 改为 `{ items, groups, lastSaved }`；敏感 json 参数脱敏回显（`notify.test_recipients`）；A:Params 的“下架提醒”登记为调用方 | 14-config-data.md:288；A78、A107；a07、a09 的请求；复核 A、B |
| 2026-10-03 | 日历（2.14、3.49、3.50）：`CalendarYear` 的 `exceptions` 改名 `items`；导入的 `days` 改为选填，不传用随版本发布的内置安排（与原型的单按钮一致）；`calendar.imported` 改为同事务写并带去重键 | A78；proto-admin-e.md:394、410；x01 2.3；复核 A、B |
| 2026-10-03 | 文件（2.17、3.57–3.64）：新增按 32 个分类的后台授权矩阵（登记、签发、留痕），补齐 a03、a04、a06、a07、a08、a09 要的分类与权限点，`drama_master` 只经上传批次、`export` 只经导出任务；登记体改名 `AdminFileCreateBody`，`clientToken` 1–64；`FileRegistration` 不再声称与 m08 同构，凭证子结构引用 m08 的 `PostPolicy`、`StsCredential`；`production_record` 补 `source`、`variant`、`aigc_state`、`uploaded_by_staff_id`；恢复与彻底删除标为三段式，彻底删除先置 `deleting` 再删对象，改用显式标记 `erased_at`（待数据模型补列）判断，不再看 `original_name`；`file.uploaded` 维持确认时发并请主负责人统一 | A57、A77、A84、A98；06-media.md:188-202、731-765、1580-1615、1838；d4-identity.md 第 9.4 节；复核 A、B |
| 2026-10-03 | 运维：媒体任务人工重试重设 `deadline_at`、清空错误列（3.69）；回调死信重置不再发 `webhook.received`（3.83）；不变量的资金类按级别与编号前缀判定，`payment` 不是模块名，`codes` 可用命名空间通配（3.74、3.76）；定时器、出站投递、回调收件箱、不变量违规四个列表认 `flow.ops.view`，写明 a02 待办用的计数函数 | 06-media.md:644、693-703；15-integration-ops.md:120、381、410；x01 2.3；a02 的请求；复核 A、B |
| 2026-10-03 | 其他：错误上报改 `optional`；明文查看挂 `admin.pii_reveal` 档位、补 `STEP_UP_REQUIRED` 与资质提交值、修正值两个字段；当班切换改写 `ops` 审计并请主负责人把 `assignment_pool_member` 补进 C52；字典项查询参数改 `typeKey`，新增字典项挂到停用项下返回 `DICT_ITEM_DISABLED`；操作日志查询参数具名为 `AuditLogListQuery`，登记 A107 的审计类别；有界小集合按 A78 写成 `{ items, … }`；1.1 补 `flow.ops.view`、`self.mfa.reset` 与矩阵引用的键，`sys.super_admin` 不再单给“修改”加再验证；`CHECKLIST_NOT_PASSED` 在本文取号 47307；开关页可改 `admin.wecom_web_login.enabled` 与 `ops.maintenance_notice`；清单模板 9 个编码的 v1 由迁移播种 | C2、C43、C45、C52、C66、C68、C72；A13、A77、A78、A107；04-profile.md 4.6；m08、a02、a06、a09 的请求；复核 A、B |
| 2026-10-03 | 第 6 节：已裁决或按默认接受的 10 项移除，留 3 项并新增 1 项（企业微信手填账号是否先核对） | A88、A80、A78、A107、C68、A103、C2；第十节导语 |
| 2026-10-03 | 路线图切片：退出登录改 `DELETE /admin/sessions/current`、`none`；补 4 条新接口；权限点按清单回填（`sys.staff.secure_ops` 三条、`sys.super_admin` 三条、20 余条 `assert-in-handler`）；迁移列名改为 `file_purge_run.state`、`webhook_event.process_state`、`media_job.state`；补定时器、死信、上传登记与确认、禁用与移交的迁移；表名更正（解锁不写 `auth_event`、编辑不动 `staff_session`、设置分配池补 `assignment_cursor` 与 `staff`、移交补 `drama_order` 与 `status_transition`）；选人参数改为 `recommendPool` + `recommendCityCode`；错误上报改 `optional` | A119、A120；xdoc（本文作者）；复核 B |

**第三轮**（2026-10-03；处理第十二节裁决 A127–A146、`review/r3-in-a01-system.md`、公共结构核对）：

| 日期 | 改动 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 权限点（1.1）：`self.mfa.reset`、`flow.ops.view` 按 A129 采纳进增补表；`sys.super_admin` 不另设再验证标记；删去 `sys.staff.mfa_reset` 的残留说明（1.1、3.21）；以 07 主文档注册表为准；清单补 `permissionSupplements`（含二次确认回显列）与 `externalSchemas` | A129、A140；C66、C87 |
| 2026-10-03 | 公共结构：`SignedUrl`、`AdminPage<T>`、`StaffBrief` 写明由本文定义（`url` 不可空、整个对象可空）；`FileRegistration` 改为引用 m08 2.10 的定义（本文表格只作速查，`credentialsLeft` 补“`post` 重签不计次”），清单删去本文的同名定义；`ApprovalItem.reasons`、`ApprovalDecisionView.reasons` 改为 `DictRef[]`（仍是 `{ code, name }`）；`SentryEnvelope` 的清单写法与 p01 对齐 | A132、A133；C85、C87；m08 的请求 |
| 2026-10-03 | 审批（2.10、3.36–3.38）：`channel_account` 为角色队列，持 `publish.account.verify` 即全量可见、可决定，不套数据范围 | 11-publish.md:17；a06 的请求 |
| 2026-10-03 | 文件（2.17、3.57–3.64）：`erasedAt` 直接引用 `file_object.erased_at`；3.64 按 06 分组现文写条件更新与“提交后执行清除后钩子”；3.63、3.64 按 `fileId` 互斥（会话级 advisory lock），拿不到返回 `STATE_NOT_ALLOWED`；矩阵补 `drama_license_doc` 的 `drama.copyright.revise` 登记、`trailer_src` 签发改为全员；样片、成片、广告的登记鉴权指向 a05 1.3；3.61 补协议正文 PDF 30 分钟、发布清单文件 15 分钟；3.59 写明 `admin.uploadBatchItem.complete` 共用实现，`file.uploaded` 确认时发已回写 | A125、A141；06-media.md:127、191、198-202、694；a04、a05、a09 的请求 |
| 2026-10-03 | 其他：`ASSIGNEE_INVALID` 的 `details = { staffId, reason }`（a05 `AssigneeInvalidReason`）；3.69 去掉“待数据模型补列”；3.11 出处去掉旧 operationId；第 6 节第 1、3 项更新说明（仍待产品、法务） | A77、A82、A141；a05 的请求；api-check 第 6 节 |
| 2026-10-03 | 未采纳：a03 请把 `reasons` 改为 `{ code, label }`——与 A133、C85 的 `DictRef = { code, name }` 冲突，保留 `name`，已请 a03 把 `DictLabel` 改为引用 `DictRef` | A133；C85 |

**第四轮**（2026-10-03；处理第十四节裁决、`review/r4-in-a01-system.md`）：

| 日期 | 改动 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 审计类别补登 `payment`、`invoice`、`recon`、`finance_config`、`docs`、`delivery`、`service_ticket`、`approval`、`review`、`flow`（第 4 节，与 a02 第 2.7 节一致）；`PoolMember` 的 `cityCode` + `cityName` 合并为 `city: DictRef \| null`（请求仍收 `cityCode`）；3.67 驳回清除运行声明 `x-step-up: skip`（切片补 `xStepUp`）；审批类型表 `finance_config_change` 的领域详情写明 `tab=history&financeConfigRevisionId` | A149、A151、A155；C85、C86；a02、a07 的请求 |
