import { newIdempotencyKey } from "../../../lib/idempotency";
import type { AccessSnapshot } from "../../../lib/permissions";
import type { DramaDetail } from "./api";

export const EDIT_TABS = ["basic", "license", "copyright", "commercial", "episodes"] as const;
export type EditTab = (typeof EDIT_TABS)[number];
export function editSearch(raw: Readonly<Record<string, unknown>>) {
  const tab = EDIT_TABS.find((value) => value === raw.tab) ?? "basic";
  const returnTo =
    typeof raw.returnTo === "string" &&
    /^\/dramas(?:\?|$)/.test(raw.returnTo) &&
    !raw.returnTo.includes("#")
      ? raw.returnTo
      : "/dramas";
  return { tab, returnTo };
}
export function contentScope(access: AccessSnapshot | null) {
  return JSON.stringify([access?.staff.id, access?.moduleLevels, access?.actions]);
}
/** 一个已打开表单持有独立快照。读取的新版本不得自动换掉此处的CAS。 */
export function snapshotOf(
  drama: Pick<DramaDetail, "dramaId" | "lockVersion"> & {
    copyright: Pick<DramaDetail["copyright"], "lockVersion">;
  },
) {
  return {
    dramaId: drama.dramaId,
    lockVersion: drama.lockVersion,
    copyrightLockVersion: drama.copyright.lockVersion,
  };
}
export function createContentIntent(
  keyPrefix: string,
  newKey = () => newIdempotencyKey(keyPrefix),
) {
  let signature: string | undefined;
  let key = newKey();
  let busy = false;
  let closed = false;
  let lifetime = new AbortController();
  return {
    activate() {
      if (closed) {
        closed = false;
        lifetime = new AbortController();
      }
    },
    get pending() {
      return busy;
    },
    get signal() {
      return lifetime.signal;
    },
    close() {
      closed = true;
      lifetime.abort();
    },
    async submit<T>(
      body: unknown,
      send: (key: string, signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> {
      if (closed || busy) return undefined;
      const next = JSON.stringify(body);
      if (signature !== undefined && signature !== next) key = newKey();
      signature = next;
      busy = true;
      const requestLifetime = lifetime;
      try {
        const result = await send(key, requestLifetime.signal);
        return closed || requestLifetime.signal.aborted ? undefined : result;
      } finally {
        busy = false;
      }
    },
  };
}
export function statusLabel(status: string) {
  return (
    ({ draft: "草稿", listed: "已上架", delisted: "已下架" } as Readonly<Record<string, string>>)[
      status
    ] ?? status
  );
}
export function dateText(value: string | null | undefined) {
  return value ?? "—";
}
export function pointsText(value: number | null | undefined) {
  return value == null ? "未设置" : value.toLocaleString("zh-CN");
}
export const DRAMA_CLASS_OPTIONS = [
  { value: "class_1", label: "一类微短剧" },
  { value: "class_2", label: "二类微短剧" },
  { value: "class_3", label: "三类微短剧" },
];
export const PLACEMENT_LABELS: Readonly<Record<string, string>> = {
  opening: "片头",
  ending: "片尾",
  corner: "角标",
  mid_roll: "中插",
};
