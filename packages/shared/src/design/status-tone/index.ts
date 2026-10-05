// 状态色调字典：状态与颜色的对应集中在这一份常量里，页面不写色值（规范 第 6.1 节）。
// 一个业务对象一个文件，这里按规范 第 6.2 节的先后汇总。表里没有的状态按规范 第 6.1 节的方法判断；
// 超时与逾期一律 danger。“键与契约枚举同名”的检查是 pnpm status-tone:check（W0-30a），只查有枚举对应的条目：
// 条目的“表.列”在契约里绑定了枚举，取值都在那个枚举之内。口径见 scripts/status-tone-check.ts 开头的注释。

import { ad } from "./ad.js";
import { approval } from "./approval.js";
import { billingOrder } from "./billing-order.js";
import { cartItem } from "./cart-item.js";
import { channelAccount } from "./channel-account.js";
import { deliveryPlan } from "./delivery-plan.js";
import { deliveryTicket } from "./delivery-ticket.js";
import { dramaOrder } from "./drama-order.js";
import { drama } from "./drama.js";
import { invitation } from "./invitation.js";
import { invoice } from "./invoice.js";
import { launchLink } from "./launch-link.js";
import { listing } from "./listing.js";
import { orderItem } from "./order-item.js";
import { partnerSettlement } from "./partner-settlement.js";
import { patrol } from "./patrol.js";
import { pointEntryType } from "./point-entry-type.js";
import { publication } from "./publication.js";
import { qualification } from "./qualification.js";
import { reconciliation } from "./reconciliation.js";
import { refundRequest } from "./refund-request.js";
import { renewalFollowUp } from "./renewal-follow-up.js";
import { serviceTicket } from "./service-ticket.js";
import { staff } from "./staff.js";
import { storeAsset } from "./store-asset.js";
import { subscription } from "./subscription.js";
import { taskQueue } from "./task-queue.js";
import type { StatusToneEntry, StatusToneGroup } from "./types.js";

export { TONES, UNBOUND_ENUM_NOTE } from "./types.js";
export type { Side, StatusToneEntry, StatusToneGroup, Tone, ToneSide } from "./types.js";

/** 全部业务对象，顺序同规范 第 6.2 节的表 */
export const STATUS_TONE_GROUPS: readonly StatusToneGroup[] = [
  dramaOrder,
  orderItem,
  deliveryTicket,
  deliveryPlan,
  ad,
  qualification,
  channelAccount,
  launchLink,
  serviceTicket,
  billingOrder,
  refundRequest,
  invoice,
  storeAsset,
  invitation,
  subscription,
  listing,
  drama,
  publication,
  cartItem,
  taskQueue,
  pointEntryType,
  approval,
  renewalFollowUp,
  reconciliation,
  staff,
  patrol,
  partnerSettlement,
];

/** 按库里的“表.列”与取值找条目；同一对取值在字典里只出现一次 */
export function statusToneByEnum(column: string, value: string): StatusToneEntry | undefined {
  for (const group of STATUS_TONE_GROUPS) {
    const found = group.entries.find((e) => e.column === column && e.values.includes(value));
    if (found) return found;
  }
  return undefined;
}

/** 按业务对象的分组键与状态名找条目：无枚举对应的展示状态用这个 */
export function statusToneByState(groupKey: string, state: string): StatusToneEntry | undefined {
  return STATUS_TONE_GROUPS.find((g) => g.key === groupKey)?.entries.find((e) => e.state === state);
}
