import { expect, it } from "vitest";
import { localStorageOrigin, localStorageRequestUrl } from "./local-storage";
it("只改写配置的本地存储源，保留路径和签名参数", () => {
  const origin = localStorageOrigin("http://192.168.1.4:9110");
  expect(localStorageRequestUrl(`${origin}/bucket/file?X-Amz-Signature=test`, origin)).toBe(
    "/__lyx_local_storage/bucket/file?X-Amz-Signature=test",
  );
  expect(localStorageRequestUrl("https://other.example/file", origin)).toBe(
    "https://other.example/file",
  );
  expect(localStorageRequestUrl(`${origin}/bucket`, "")).toBe(`${origin}/bucket`);
});
it("代理目标限定为本机或私有局域网，不接受凭据、路径或任意外网", () => {
  for (const target of [
    "http://127.0.0.1:9100",
    "http://localhost:9100",
    "http://10.0.1.2:9000",
    "http://172.16.0.2:9000",
  ]) {
    expect(localStorageOrigin(target)).toBe(target);
  }
  for (const target of [
    "http://example.com",
    "http://172.32.0.1",
    "http://localhost/path",
    "http://user:pass@localhost",
    "http://localhost?key=secret",
    "file:///tmp",
  ]) {
    expect(() => localStorageOrigin(target)).toThrow();
  }
});
