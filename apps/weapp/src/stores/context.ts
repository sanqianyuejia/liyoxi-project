// 门店上下文 store（D7 第 4.3、4.6 节）：当前门店与上下文修订号。成员关系随 m.me.get 来，存在会话 store 的 me 里。
// 只有 currentStoreId 落本地（lyx.currentStoreId）；落盘由 lib/persist.ts 接上。
import { create } from "zustand";

export interface ContextState {
  currentStoreId: string | null;
  /** 每切一次门店加一：带门店维度的列表与缓存据此作废（D7 第 4.3 节“切换门店”） */
  contextRev: number;
  /** 切换门店是纯客户端行为；记住选择、重拉首页与角标由调用方接着做 */
  switchStore(storeId: string | null): void;
  clear(): void;
}

export const useContextStore = create<ContextState>()((set, get) => ({
  currentStoreId: null,
  contextRev: 0,
  switchStore: (storeId) => {
    if (storeId === get().currentStoreId) return;
    set({ currentStoreId: storeId, contextRev: get().contextRev + 1 });
  },
  clear: () => set({ currentStoreId: null, contextRev: get().contextRev + 1 }),
}));
