/** 仅 Vite development 使用；生产直传地址不改写。 */
export const LOCAL_STORAGE_PREFIX = "/__lyx_local_storage";

export function localStorageOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  const host = url.hostname;
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
  if (
    !local ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("本地存储转发只接受本机或私有局域网的 HTTP(S) 根地址");
  }
  return url.origin;
}

export function localStorageRequestUrl(url: string, origin: string): string {
  if (!origin) return url;
  const target = new URL(url);
  return target.origin === origin
    ? `${LOCAL_STORAGE_PREFIX}${target.pathname}${target.search}`
    : url;
}
