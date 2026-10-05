// store 与本地存储的接线：启动时放回上次存的，之后有变就写。store 自己不碰存储，所以用例里不用造存储。
import type { KeyValueStorage } from "./platform";
import { StorageKey } from "./storage";
import { useBootstrapStore, type BootstrapData } from "../stores/bootstrap";
import { useContextStore } from "../stores/context";
import { useSessionStore } from "../stores/session";

interface BootstrapCache {
  data: Partial<BootstrapData>;
  fetchedAt: number;
}

/** 启动时调一次。返回取消订阅的函数（用例用） */
export function bindPersistence(storage: KeyValueStorage): () => void {
  const token = storage.get<string>(StorageKey.accessToken);
  if (typeof token === "string" && token !== "") useSessionStore.setState({ accessToken: token });
  const storeId = storage.get<string>(StorageKey.currentStoreId);
  if (typeof storeId === "string" && storeId !== "") {
    useContextStore.setState({ currentStoreId: storeId });
  }
  const cache = storage.get<BootstrapCache>(StorageKey.bootstrap);
  if (cache && typeof cache === "object" && typeof cache.fetchedAt === "number" && cache.data) {
    useBootstrapStore.getState().restore(cache.data, cache.fetchedAt);
  }

  const put = (key: StorageKey, value: unknown) =>
    value === null ? storage.remove(key) : storage.set(key, value);
  const stops = [
    useSessionStore.subscribe((state, previous) => {
      if (state.accessToken !== previous.accessToken)
        put(StorageKey.accessToken, state.accessToken);
    }),
    useContextStore.subscribe((state, previous) => {
      if (state.currentStoreId !== previous.currentStoreId) {
        put(StorageKey.currentStoreId, state.currentStoreId);
      }
    }),
    useBootstrapStore.subscribe((state, previous) => {
      // 只缓存从接口取到的；默认值与刚放回的缓存不用再写
      if (state.source === "server" && state.data !== previous.data && state.fetchedAt !== null) {
        const cached: BootstrapCache = { data: state.data, fetchedAt: state.fetchedAt };
        storage.set(StorageKey.bootstrap, cached);
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
