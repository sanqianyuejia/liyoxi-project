// 加锁顺序（W0-07）：全系统唯一的一份（06 第 5 节；01 第 7.1 节；ADR-012）。
// 规矩：一个事务锁多行时按次序从小到大加锁；同一张表的多行按主键升序；计费账户（billing_account）最后锁，
// 一个事务只锁一个主体的计费账户。表里没有的表不参与排序。
//
// 本文件是门禁文件（infra/ci/gate-files.json）：新增一张表是只增，同一个 PR 改 06 第 5 节，
// lock-order.doc.test.ts 逐行核对两边一致；改、删已有的行只在单独的 gate-change PR 里做。
// 加锁函数 lockRows 在 lock.ts：SQL 的写法以后还会长，不放进这份门禁文件。
import { KernelViolation, txState } from "./tx.js";
import type { HeldLock, Tx } from "./tx.js";

/** 表名 → 次序。行序、次序号、表名照 06 第 5 节的表逐行写 */
export const LOCK_ORDER = {
  assignment_cursor: 10, // 轮询游标
  staff: 20, // 员工账号
  approval_request: 30, // 统一审批单
  account_change_request: 40, // 账号类变更申请
  cancel_request: 50, // 取消申请
  cancel_request_line: 60, // 取消申请明细
  qualification_submission: 65, // 资质轮次
  refund_request: 70, // 现金退款申请
  merchant_user: 80, // 商家用户账号
  wechat_identity: 90, // 微信身份
  entity: 100, // 经营主体
  invitation: 110, // 店员邀请
  entity_member: 120, // 成员关系
  store: 130, // 门店
  store_profile: 135, // 门店档案
  drama: 140, // 剧目
  ad: 150, // 广告
  drama_order: 160, // 订购单
  order_item: 170, // 订单项
  delivery_ticket: 180, // 交付工单
  channel_account: 190, // 渠道账号
  delivery_plan: 200, // 交付方案
  delivery_release: 210, // 成片包
  episode_output: 220, // 成片剧集
  launch_task: 230, // 上线任务
  license_letter: 240, // 定制内容授权书
  patrol_task: 250, // 巡检任务
  sample: 260, // 样片版本
  service_ticket: 270, // 客服工单
  takedown_task: 280, // 下架任务
  billing_order: 290, // 付款单
  payment_txn: 300, // 收款交易
  transfer_proof: 310, // 对公转账凭证
  refund_txn: 320, // 退款交易
  invoice_request: 330, // 开票申请
  payment_exception: 340, // 差异单
  playable_asset: 350, // 可播放资产
  production_record: 360, // 制作留痕
  store_asset: 370, // 门店素材
  upload_batch: 380, // 批量上传批次
  zip_bundle: 390, // ZIP 缓存
  media_job: 400, // 媒体任务
  file_object: 410, // 文件对象
  billing_account: 420, // 主体计费账户
} as const;

export type LockTable = keyof typeof LOCK_ORDER;

const rankOf = (lock: HeldLock): number => LOCK_ORDER[lock.table as LockTable];

/**
 * 锁序断言的判定：已经持有 held 时再锁 table 的 keys，违规返回原因，不违规返回 undefined。
 * 已经持有的行再锁一遍不算违规（状态迁移里幂等的再锁）。keys 是主键值；复合主键的表由调用方拼成一个串。
 */
export function checkLockOrder(
  held: readonly HeldLock[],
  table: LockTable,
  keys: readonly string[],
): string | undefined {
  const fresh = keys.filter(
    (key) => !held.some((lock) => lock.table === table && lock.key === key),
  );
  if (fresh.length === 0) return undefined;
  if (table === "billing_account") {
    const subjects = new Set(fresh);
    for (const lock of held) if (lock.table === table) subjects.add(lock.key);
    if (subjects.size > 1) return "一个事务只锁一个主体的计费账户（06 第 5 节）";
  }
  // 已持有的锁里排在最后的一把：次序最大；同一张表里主键最大
  let top: HeldLock | undefined;
  for (const lock of held) {
    const ahead =
      top === undefined ||
      rankOf(lock) > rankOf(top) ||
      (lock.table === top.table && lock.key > top.key);
    if (ahead) top = lock;
  }
  if (top === undefined) return undefined;
  const rank = LOCK_ORDER[table];
  if (rank < rankOf(top)) {
    return top.table === "billing_account"
      ? `计费账户最后锁：锁了 billing_account 之后不能再锁 ${table}（06 第 5 节）`
      : `加锁顺序反了：已锁 ${top.table}（${rankOf(top)}），再锁 ${table}（${rank}）。按 06 第 5 节的次序从小到大加锁`;
  }
  const lowest = fresh.reduce((a, b) => (a < b ? a : b));
  if (table === top.table && lowest < top.key) {
    return `同一张表的多行按主键升序加锁：已锁 ${table} 的 ${top.key}，再锁 ${lowest}`;
  }
  return undefined;
}

/**
 * 锁序断言：加锁之前调。违规时本地与测试环境抛错，预发与生产上报后照常加锁（任务书 第 11 节第 5 项）；
 * 随后把这几把锁记到事务上。lockRows 已经调它；自己写加锁 SQL 的地方（如复合主键的 assignment_cursor）先调它。
 */
export function assertLockOrder(tx: Tx, table: LockTable, keys: readonly string[]): void {
  const state = txState(tx);
  const problem = checkLockOrder(state.held, table, keys);
  if (problem !== undefined) state.violate(new KernelViolation("lock_order", problem));
  for (const key of keys) {
    if (!state.held.some((lock) => lock.table === table && lock.key === key)) {
      state.held.push({ table, key });
    }
  }
}
