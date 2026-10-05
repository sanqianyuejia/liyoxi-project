// 会话 store（D7 第 4.3 节；约定 C3）：访问令牌与用户概要。没有刷新令牌。
// 令牌落本地（lyx.accessToken），用户概要只在内存；落盘由 lib/persist.ts 接上，这里不碰存储。
import { create } from "zustand";

export interface SessionState {
  accessToken: string | null;
  /** 用户概要：m.me.get 的结果。结构等契约里有了 MeView 再收紧（W1-04） */
  me: unknown;
  setSession(accessToken: string, me?: unknown): void;
  setMe(me: unknown): void;
  clear(): void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  accessToken: null,
  me: null,
  setSession: (accessToken, me = null) => set({ accessToken, me }),
  setMe: (me) => set({ me }),
  clear: () => set({ accessToken: null, me: null }),
}));
