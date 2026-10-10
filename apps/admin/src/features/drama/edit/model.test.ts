import { expect, it, vi } from "vitest";
import type { AccessSnapshot } from "../../../lib/permissions";
import { contentScope, createContentIntent, editSearch, snapshotOf } from "./model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("详情页只接收正式页签和当前列表返回地址", () => {
  expect(editSearch({ tab: "copyright", returnTo: "/dramas?page=2&genreCode=romance" })).toEqual({
    tab: "copyright",
    returnTo: "/dramas?page=2&genreCode=romance",
  });
  for (const returnTo of [
    "https://other.invalid",
    "//other.invalid",
    "/dramas/other",
    "/dramas#wrong",
  ])
    expect(editSearch({ tab: "unknown", returnTo })).toEqual({ tab: "basic", returnTo: "/dramas" });
});
it("表单确认快照同时固定剧目与版权两个独立版本", () => {
  const detail = { dramaId: "drama", lockVersion: 3, copyright: { lockVersion: 7 } };
  const snapshot = snapshotOf(detail);
  detail.lockVersion = 4;
  detail.copyright.lockVersion = 8;
  expect(snapshot).toEqual({ dramaId: "drama", lockVersion: 3, copyrightLockVersion: 7 });
});
it("角色和人员变化隔离内容工作区，不跨权限复用打开的草稿", () => {
  const access: AccessSnapshot = {
    staff: { id: "staff-a", name: "虚构员工", roleKey: "ops", roleName: "运营" },
    isLead: false,
    moduleLevels: { drama: "e" },
    actions: ["drama.shelf"],
    dataScope: "all",
    releases: {},
  };
  expect(contentScope(access)).not.toBe(
    contentScope({ ...access, staff: { ...access.staff, id: "staff-b" } }),
  );
  expect(contentScope(access)).not.toBe(contentScope({ ...access, moduleLevels: { drama: "v" } }));
  expect(contentScope(access)).not.toBe(contentScope({ ...access, actions: [] }));
});
it("同一写意图失败重试保留key，修改草稿换key，同步双击只外发一次", async () => {
  let number = 0;
  const intent = createContentIntent("test", () => `key-${++number}`);
  const waiting = deferred<number>();
  const send = vi.fn(async (_key: string, _signal: AbortSignal) => waiting.promise);
  const first = intent.submit({ lockVersion: 3, title: "旧草稿" }, send);
  expect(await intent.submit({ lockVersion: 3, title: "旧草稿" }, send)).toBeUndefined();
  expect(send).toHaveBeenCalledTimes(1);
  waiting.resolve(1);
  await first;
  const failed = vi.fn(async (_key: string, _signal: AbortSignal) => {
    throw new Error("网络断开");
  });
  await expect(intent.submit({ lockVersion: 3, title: "旧草稿" }, failed)).rejects.toThrow(
    "网络断开",
  );
  const retry = vi.fn(async (_key: string, _signal: AbortSignal) => 2);
  await intent.submit({ lockVersion: 3, title: "旧草稿" }, retry);
  expect(retry.mock.calls[0]?.[0]).toBe(failed.mock.calls[0]?.[0]);
  await intent.submit({ lockVersion: 3, title: "新草稿" }, retry);
  expect(retry.mock.calls[1]?.[0]).not.toBe(retry.mock.calls[0]?.[0]);
  intent.close();
});
it("关闭取消owned请求；开发effect重新装配仍拒绝旧生命周期晚结果", async () => {
  const intent = createContentIntent("close", () => "fixed");
  const waiting = deferred<number>();
  let signal: AbortSignal | undefined;
  const old = intent.submit({}, async (_key, value) => {
    signal = value;
    return waiting.promise;
  });
  intent.close();
  expect(signal?.aborted).toBe(true);
  intent.activate();
  expect(intent.signal.aborted).toBe(false);
  waiting.resolve(1);
  expect(await old).toBeUndefined();
  expect(await intent.submit({}, async () => 2)).toBe(2);
  intent.close();
  expect(await intent.submit({}, async () => 3)).toBeUndefined();
});
