-- 角色与授权（W0-06a）。手写的迁移，不是生成物；不建表、不改结构，只建角色、写授权。
-- 依据：06 第 3.4、4 节；01、03、05–08、10、12–14 分组文档里各表的授权说明；D7 第 2.5、7.5 节。
-- 做法：
--   1. 两个角色不存在才建，不可登录、不带口令。口令、登录账号、把账号加进角色，都由环境初始化做，不进迁移。
--      lyx_migrator 是跑迁移的登录身份，不由迁移创建；谁跑迁移谁是表的属主，这里不改属主。
--   2. lyx_app（api 与 worker 共用）白名单式逐表授权：下面没写到的表，应用一概碰不到。以后加表要在新迁移里补授权，
--      漏了由 packages/db/src/grants.test.ts 拦下。埋点事件表只授父表，分区子表不单独授。
--   3. 只增表只给 INSERT、SELECT；触发器放行“写一次”的列另授列级 UPDATE，不多给。触发器那一道照旧在。
--   4. lyx_readonly（备份与排障）对全部表与序列只读；跑迁移的账号以后建的表与序列（含每月新建的分区）自动带上。
-- 只用 PostgreSQL 14 也支持的语法。可重复执行：GRANT、REVOKE 本身是幂等的。

-- ===== 1. 角色 =====
-- 同一个实例上别的库的迁移可能刚好同时在建（测试时常见）：撞上“已存在”就当它建好了。
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['lyx_app', 'lyx_readonly'] LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('CREATE ROLE %I NOLOGIN', r);
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END LOOP;
END;
$$;

GRANT USAGE ON SCHEMA public TO lyx_app, lyx_readonly;

-- ===== 2. lyx_app：逐表授权，按 06 第 4 节的分组 =====

-- 01 内核与流程基础
GRANT SELECT, INSERT, UPDATE, DELETE ON
  idempotency_record, biz_sequence, outbox_delivery, timer, work_calendar_day
  TO lyx_app;
GRANT SELECT, INSERT ON outbox_event, status_transition TO lyx_app; -- 只增
GRANT UPDATE (published_at) ON outbox_event TO lyx_app; -- 01 分组 第 2.3 节

-- 02 身份与租户
GRANT SELECT, INSERT, UPDATE, DELETE ON
  merchant_user, wechat_identity, user_session, portal_session, merchant_user_notice, sms_verification,
  wecom_contact, account_change_request, entity, store, entity_member, store_member, invitation,
  referral_code, portal_ticket
  TO lyx_app;

-- 03 员工、权限、审计与统一审批单
GRANT SELECT, INSERT, UPDATE, DELETE ON
  staff, staff_group, staff_role, staff_activation, staff_session, assignment_pool_member,
  assignment_cursor, follow_up, approval_request
  TO lyx_app;
GRANT SELECT, INSERT ON assignment_history, audit_log, auth_event TO lyx_app; -- 只增
-- 03 分组 第 2.8 节：触发器放行的六列（补“已联系”或“作废”标记、重算联系截止时间）
GRANT UPDATE (contact_due_at, sla_snapshot, contacted_at, contacted_by_staff_id, contact_voided_at, updated_at)
  ON assignment_history TO lyx_app;

-- 04 门店档案与资质审核
GRANT SELECT, INSERT, UPDATE, DELETE ON
  store_profile, store_profile_media, store_service_item, qualification_submission, qualification_doc
  TO lyx_app;

-- 05 短剧库
GRANT SELECT, INSERT, UPDATE, DELETE ON
  drama, drama_episode, drama_permit, drama_copyright, drama_stat
  TO lyx_app;
GRANT SELECT, INSERT ON drama_copyright_revision TO lyx_app; -- 只增

-- 06 媒体
GRANT SELECT, INSERT, UPDATE ON file_object TO lyx_app; -- 06 分组 第 5.4 节：不给 DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON
  file_ref, file_purge_run, media_info, media_check, upload_batch, upload_batch_item, media_job,
  production_record, master_checkout, playable_asset, zip_bundle, drama_trailer, drama_episode_master,
  store_asset, store_asset_file, store_asset_insight, store_asset_tag, store_asset_usage,
  store_asset_demand, ocr_result
  TO lyx_app;

-- 07 价目、订阅、积分账本
GRANT SELECT, INSERT, UPDATE, DELETE ON
  plan, plan_revision, plan_promo_claim, point_pack, drama_price_revision, billing_param,
  billing_account, subscription_term, grant_schedule, point_lot, point_hold, point_hold_alloc,
  billing_entity_daily, valuation_policy, point_entry_valuation, point_adjustment_request,
  term_extension_request
  TO lyx_app;
GRANT SELECT, INSERT ON
  price_tier_revision, subscription_event, ledger_operation, point_ledger_entry
  TO lyx_app; -- 只增

-- 08 付款单、收款交易、退款、对账、发票（08 分组 第 1 节：行都不物理删除，不给 DELETE）
GRANT SELECT, INSERT, UPDATE ON
  billing_order, payment_txn, transfer_proof, refund_request, refund_txn, payment_exception,
  wx_bill_file, wx_bill_line, recon_day, invoice_request, invoice_doc
  TO lyx_app;
GRANT SELECT, INSERT ON finance_config_revision TO lyx_app; -- 只增
GRANT UPDATE (effective_at) ON finance_config_revision TO lyx_app; -- 08 分组 第 2.12 节：批准时写一次

-- 09 订购与广告
GRANT SELECT, INSERT, UPDATE, DELETE ON
  cart_item, drama_order, order_item, order_item_account, order_item_placement, cancel_request,
  cancel_request_line, ad, ad_version, ad_revision
  TO lyx_app;

-- 10 交付
GRANT SELECT, INSERT, UPDATE, DELETE ON
  delivery_ticket, delivery_ticket_stage, delivery_ticket_pause, delivery_plan, delivery_plan_version,
  delivery_plan_change_request, sample, episode_output, qc_record, delivery_release, delivery_reissue,
  download_grant, publish_list, publish_list_episode
  TO lyx_app;
GRANT SELECT, INSERT ON delivery_download_log TO lyx_app; -- 只增
GRANT UPDATE (client_ack, client_ack_at) ON delivery_download_log TO lyx_app; -- 10 分组 第 2.13 节

-- 11 发布
GRANT SELECT, INSERT, UPDATE, DELETE ON
  channel_account, channel_account_submission, launch_task, launch_submission, patrol_batch,
  patrol_task, takedown_task
  TO lyx_app;

-- 12 客服工单（12 分组 第 1 节：工单不删；时间线只插入；关联行可增删、不可改）
GRANT SELECT, INSERT, UPDATE ON service_ticket TO lyx_app;
GRANT SELECT, INSERT ON service_ticket_entry TO lyx_app;
GRANT SELECT, INSERT, DELETE ON service_ticket_ref TO lyx_app;

-- 13 通知与文书
GRANT SELECT, INSERT, UPDATE, DELETE ON
  notify_scene, wx_template_slot, sms_template, notification, notification_delivery, merchant_message,
  staff_message, wx_subscribe_quota, agreement, agreement_version, license_letter,
  license_letter_revision
  TO lyx_app;
GRANT SELECT, INSERT ON manual_reminder_log, agreement_consent TO lyx_app; -- 只增

-- 14 配置与数据
GRANT SELECT, INSERT, UPDATE, DELETE ON
  dict_type, dict_item, site_config_revision, home_banner, site_notice, feature_flag,
  checklist_template, analytics_event_dedup, analytics_identity, report_month_close, export_job
  TO lyx_app;
GRANT SELECT, INSERT ON param_value, analytics_event TO lyx_app; -- 只增；analytics_event 是分区父表
GRANT UPDATE (cancelled_at) ON param_value TO lyx_app; -- 14 分组 第 2.3 节：生效前撤销，写一次

-- 15 回调收件、租约与告警、不变量校验结果
GRANT SELECT, INSERT, UPDATE, DELETE ON
  webhook_event, worker_lease, alert_event, invariant_run, invariant_violation
  TO lyx_app;

-- ===== 3. lyx_app：序列与函数 =====
-- 14 个自增列背后的序列，加审计编号的序列（插入触发器里取号）。只给 USAGE（取号），不给 UPDATE（setval）。
GRANT USAGE ON SEQUENCE
  outbox_event_seq_seq, status_transition_seq_seq, staff_staff_no_seq, assignment_history_seq_seq,
  audit_log_seq_seq, auth_event_seq_seq, drama_copyright_revision_seq_seq, subscription_event_seq_seq,
  ledger_operation_seq_seq, point_ledger_entry_seq_seq, delivery_download_log_seq_seq,
  manual_reminder_log_seq_seq, agreement_consent_seq_seq, param_value_seq_seq, audit_no_seq
  TO lyx_app;

-- 以属主身份执行的函数（SECURITY DEFINER）只有这一个：先收回缺省给所有人的执行权，再只授给应用角色。
-- 应用删不了登录与安全事件，只能经它清理 12 个月以前的（03 分组 第 2.11 节）。
REVOKE ALL ON FUNCTION lyx_03_purge_auth_event(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lyx_03_purge_auth_event(timestamptz) TO lyx_app;

-- ===== 4. lyx_readonly：全部表与序列只读 =====
-- 含分区子表与 _prisma_migrations：逻辑备份（pg_dump）要逐张读。
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lyx_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO lyx_readonly;
-- 当前账号（跑迁移的那个）以后在 public 里建的表与序列，自动对它只读：每月新建的分区、之后的迁移建的表。
-- 换了别的账号来建，就不带这条缺省授权：建分区由谁执行见本包的 ADR。
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lyx_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO lyx_readonly;
