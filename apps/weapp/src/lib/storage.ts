// 本地存储键的唯一出处，都带 lyx. 前缀（约定 C3；D7 第 3.2、4.12 节）。新加的键在这里登记，别处不写字面量。
export const StorageKey = {
  /** 会话令牌（约定 C3）。没有刷新令牌 */
  accessToken: "lyx.accessToken",
  /** 当前门店 */
  currentStoreId: "lyx.currentStoreId",
  /** 引导数据的缓存：{ data, fetchedAt } */
  bootstrap: "lyx.bootstrap",
  /** 本机的匿名标识：首次启动生成，游客的埋点靠它串起来 */
  anonymousId: "lyx.anonymousId",
  /** 没报上去的埋点（至多 200 条） */
  trackQueue: "lyx.track.queue",
  /** 订阅槽位的冷却：{ [slotKey]: 拒绝时刻的毫秒时间戳 } */
  subscribeCooldown: "lyx.subscribe.cooldown",
} as const;
export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];
