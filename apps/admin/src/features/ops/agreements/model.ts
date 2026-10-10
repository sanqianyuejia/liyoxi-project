import { AdminAgreementConsentListQuerySchema } from "@liyoxi/contract";
import {
  atMinuteOfDay,
  calendarDate,
  isLocalDate,
  minuteOfDay,
  parseHm,
} from "@liyoxi/shared/time";
import { readContractQuery } from "../../../lib/contract-query";
import { newIdempotencyKey } from "../../../lib/idempotency";
import {
  AgreementFailure,
  type AgreementApi,
  type AgreementDetail,
  type Version,
  type WithdrawBody,
} from "./api";

export const AGREEMENT_KEYS = [
  "user",
  "privacy",
  "member",
  "points",
  "custom_license",
  "ad_service",
] as const;
export const CONSENT_KEYS = [
  "agreementKey",
  "agreementVersionId",
  "merchantUserId",
  "entityId",
  "storeId",
  "scene",
  "method",
  "bizType",
  "bizId",
  "no",
  "consentNo",
  "consentedFrom",
  "consentedTo",
  "page",
  "pageSize",
  "sort",
] as const;
export type AgreementSearch = Record<string, string>;
export function agreementSearch(raw: Readonly<Record<string, unknown>>): AgreementSearch {
  const candidate = { ...raw };
  if (
    typeof candidate.agreementKey === "string" &&
    !AGREEMENT_KEYS.some((k) => k === candidate.agreementKey)
  )
    delete candidate.agreementKey;
  const { wire } = readContractQuery(AdminAgreementConsentListQuerySchema, candidate, {
    keys: CONSENT_KEYS,
    defaults: { page: "1", pageSize: "20", sort: "-consentedAt" },
    recover: { bizType: ["bizId"], consentedTo: ["consentedFrom", "consentedTo"] },
  });
  if (raw.tab === "evidence") wire.tab = "evidence";
  return wire;
}
export function consentQuery(search: AgreementSearch) {
  const copy = { ...search };
  delete copy.tab;
  return AdminAgreementConsentListQuerySchema.parse(copy);
}
export function phaseLabel(version: Pick<Version, "displayStatus">): string {
  const labels: Record<string, string> = {
    draft: "草稿",
    pending: "待生效",
    active: "生效中",
    superseded: "历史版本",
    withdrawn: "已撤回",
  };
  return typeof version.displayStatus === "string"
    ? (labels[version.displayStatus] ?? "未知状态")
    : "未知状态";
}
export function localEffective(value: string | null) {
  if (!value) return { date: "", time: "09:00" };
  const instant = new Date(value),
    minute = minuteOfDay(instant);
  return {
    date: calendarDate(instant),
    time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
  };
}
export function effectiveInstant(date: string, time: string): string | null {
  if (!date && !time) return null;
  if (!isLocalDate(date)) throw new Error("请选择有效生效日期");
  const minute = parseHm(time);
  if (minute >= 1440) throw new Error("请填写有效生效时刻 HH:mm");
  return atMinuteOfDay(date, minute).toISOString();
}
export function createWriteIntent(generate = () => newIdempotencyKey("agreement")) {
  let signature: string | undefined, key: string;
  return {
    key(action: string, target: string, body: unknown) {
      const next = JSON.stringify([action, target, body]);
      if (next !== signature) {
        signature = next;
        key = generate();
      }
      return key;
    },
    reset() {
      signature = undefined;
    },
  };
}
export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : "操作未完成，请重试";
}
export function failureDetails(error: unknown): Record<string, unknown> {
  const details = error instanceof AgreementFailure ? error.failure.body?.details : undefined;
  return details && typeof details === "object" && !Array.isArray(details) ? { ...details } : {};
}
interface Snapshot {
  selected?: string;
  detail?: AgreementDetail;
  loading: boolean;
  error?: string;
  busy?: string;
}
export function createAgreementWorkspace(api: AgreementApi) {
  let state: Snapshot = { loading: false },
    closed = false,
    generation = 0;
  let controller: AbortController | undefined, writing: object | undefined;
  const listeners = new Set<() => void>(),
    intent = createWriteIntent();
  const publish = (patch: Partial<Snapshot>) => {
    if (!closed) {
      state = { ...state, ...patch };
      for (const f of listeners) f();
    }
  };
  const current = (ticket: number) => !closed && ticket === generation;
  async function select(key?: string) {
    controller?.abort();
    controller = new AbortController();
    const ticket = ++generation;
    writing = undefined;
    intent.reset();
    publish({
      selected: key,
      detail: undefined,
      error: undefined,
      loading: Boolean(key),
      busy: undefined,
    });
    if (!key) return;
    try {
      const detail = await api.get(key, controller.signal);
      if (current(ticket)) publish({ detail, loading: false });
    } catch (error) {
      if (current(ticket)) publish({ error: failureText(error), loading: false });
    }
  }
  async function write<T>(busy: string, run: () => Promise<T>): Promise<T | undefined> {
    if (closed) return undefined;
    if (writing) throw new Error("正在处理，请稍候");
    const token = {},
      ticket = generation;
    writing = token;
    publish({ busy });
    try {
      const result = await run();
      return current(ticket) ? result : undefined;
    } finally {
      if (writing === token) {
        writing = undefined;
        publish({ busy: undefined });
      }
    }
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select,
    write,
    async withdraw(version: Version, body: WithdrawBody) {
      const result = await write("撤回中", () =>
        api.withdraw(
          version.agreementVersionId,
          body,
          intent.key("withdraw", version.agreementVersionId, body),
        ),
      );
      return result === undefined ? undefined : result.newDraft;
    },
    async download(fileId: string) {
      const ticket = generation;
      try {
        const result = await api.download(fileId);
        return current(ticket) ? result : undefined;
      } catch (error) {
        if (current(ticket)) throw error;
        return undefined;
      }
    },
    close() {
      closed = true;
      ++generation;
      controller?.abort();
      writing = undefined;
      state = { loading: false };
      listeners.clear();
      intent.reset();
    },
  };
}
export type AgreementWorkspace = ReturnType<typeof createAgreementWorkspace>;
