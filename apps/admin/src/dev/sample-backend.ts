// 样例接口的夹具后端：纯函数加内存状态，不碰网络与文件。两处用它：
//   冒烟（test/e2e/smoke.spec.ts）：Playwright 拦下 /api/v1/admin/samples/**，交给它应答；
//   本地开发（vite.config.ts 的开发服务器中间件）：同一份逻辑，手工看样不用起 api。
// 响应照约定 C21、C22、C43 的外形（信封、错误体、页码分页），好让请求层的统一处置走真实的分支。
import {
  SAMPLE_REVIEWS,
  SAMPLE_STORES,
  type SampleReview,
  type SampleReviewItem,
  type SampleStore,
  type SampleStoreDetail,
} from "./sample-data";

export const SAMPLE_API_PREFIX = "/api/v1/admin/samples";

export interface SampleRequest {
  method: string;
  /** 完整路径，带 /api/v1 前缀，不带查询串 */
  path: string;
  query: Readonly<Record<string, string>>;
  /** 请求头，键一律小写 */
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface SampleResponse {
  status: number;
  body: unknown;
}

const ok = (data: unknown): SampleResponse => ({
  status: 200,
  body: { code: 0, message: "ok", data },
});

const error = (
  status: number,
  code: number,
  symbol: string,
  message: string,
  requestId: string,
): SampleResponse => ({
  status,
  body: { code, error: symbol, message, retryable: false, requestId },
});

const TAIL_OF: Readonly<Record<string, string>> = { "st-09": "6688" };

function detailOf(store: SampleStore, disabled: boolean): SampleStoreDetail {
  const phoneTail = TAIL_OF[store.id] ?? `5${store.id.slice(-2)}8`;
  return {
    ...store,
    phoneMasked: `138****${phoneTail}`,
    phoneTail,
    contact: "王先生",
    address: `成都市${store.region}万达广场 3 楼`,
    businessHours: "10:00–22:00",
    avgSpendFen: 9800,
    disabled,
    logs: [
      { at: "2026-09-28T14:52:00+08:00", actor: "商家", text: "修改了营业时间" },
      { at: "2026-09-13T10:05:00+08:00", actor: "系统", text: "专业版续费成功，积分已发放" },
      { at: "2026-06-12T09:30:00+08:00", actor: store.manager ?? "系统", text: "资质审核通过" },
    ],
  };
}

function sortStores(stores: SampleStore[], sort: string | undefined): SampleStore[] {
  if (!sort) return stores;
  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  const pick = (store: SampleStore): number | string =>
    field === "availablePoints"
      ? store.availablePoints
      : field === "paidFen"
        ? store.paidFen
        : store.lastOrderAt;
  return [...stores].sort((a, b) => {
    const [left, right] = [pick(a), pick(b)];
    const order = left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    return descending ? -order : order;
  });
}

export interface SampleBackend {
  handle(request: SampleRequest): SampleResponse;
  /** 收到过的请求，冒烟用它核对请求头 */
  readonly received: SampleRequest[];
}

export function createSampleBackend(): SampleBackend {
  const received: SampleRequest[] = [];
  const pending = new Map<string, SampleReview>(SAMPLE_REVIEWS.map((item) => [item.id, item]));
  const done: SampleReviewItem[] = [];
  const disabled = new Set<string>();
  const replays = new Map<string, SampleResponse>();

  const filterStores = (query: Readonly<Record<string, string>>): SampleStore[] =>
    SAMPLE_STORES.filter((store) => {
      if (query.region && store.region !== query.region) return false;
      if (query.source && store.source !== query.source) return false;
      if (query.q && !`${store.name}${store.entityName}`.includes(query.q)) return false;
      return true;
    });

  const inTab = (store: SampleStore, tab: string | undefined): boolean =>
    !tab || tab === "all" || store.qualificationStatus === tab;

  const write = (request: SampleRequest, requestId: string): SampleResponse => {
    const parts = request.path.slice(SAMPLE_API_PREFIX.length).split("/").filter(Boolean);
    const [resource, id, action] = parts;
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (resource === "reviews" && id && (action === "approve" || action === "reject")) {
      const item = pending.get(id);
      // rv-3 演示“别人先处理了”：服务端用带状态条件的更新保证只有一个人成功（D7 第 5.3 节）
      if (!item || id === "rv-3") {
        if (item) {
          pending.delete(id);
          done.push({ ...item, qualificationStatus: "verified", handledBy: "林晓" });
        }
        return error(409, 40902, "STATE_NOT_ALLOWED", "该事项已被林晓处理", requestId);
      }
      if (body.lockVersion !== item.lockVersion) {
        return error(409, 40901, "VERSION_CONFLICT", "内容已被他人修改，请刷新后重试", requestId);
      }
      pending.delete(id);
      done.push({ ...item, qualificationStatus: action === "approve" ? "verified" : "rejected" });
      return ok({ id, result: action });
    }
    if (resource === "stores" && id && action === "disable") {
      const store = SAMPLE_STORES.find((entry) => entry.id === id);
      if (!store) return error(404, 40401, "NOT_FOUND", "内容不存在或已被移除", requestId);
      const confirm = (body.confirm ?? {}) as Record<string, unknown>;
      if (confirm.phoneTail !== detailOf(store, false).phoneTail) {
        return error(
          409,
          40905,
          "CONFIRM_MISMATCH",
          "确认信息与当前内容不一致，请刷新后重新确认",
          requestId,
        );
      }
      disabled.add(id);
      return ok({ id, disabled: true });
    }
    return error(404, 40401, "NOT_FOUND", "内容不存在或已被移除", requestId);
  };

  const read = (request: SampleRequest, requestId: string): SampleResponse => {
    const parts = request.path.slice(SAMPLE_API_PREFIX.length).split("/").filter(Boolean);
    const [resource, id] = parts;
    const { query } = request;
    if (resource === "stores" && id === "summary") {
      const all = filterStores(query);
      return ok({
        all: all.length,
        pending: all.filter((store) => inTab(store, "pending")).length,
        verified: all.filter((store) => inTab(store, "verified")).length,
      });
    }
    if (resource === "stores" && id) {
      const store = SAMPLE_STORES.find((entry) => entry.id === id);
      return store
        ? ok(detailOf(store, disabled.has(id)))
        : error(404, 40401, "NOT_FOUND", "内容不存在或已被移除", requestId);
    }
    if (resource === "stores") {
      // 演示出错重试：关键词是“出错”时返回 500
      if (query.q === "出错")
        return error(500, 50000, "INTERNAL", "服务异常，请稍后重试", requestId);
      const page = Math.max(1, Number(query.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
      const matched = sortStores(
        filterStores(query).filter((store) => inTab(store, query.tab)),
        query.sort,
      );
      const items = matched.slice((page - 1) * pageSize, page * pageSize);
      return ok({ items, page, pageSize, total: matched.length });
    }
    if (resource === "reviews" && id === "summary") {
      return ok({ pending: pending.size, done: done.length });
    }
    if (resource === "reviews") {
      const source = query.tab === "done" ? done : [...pending.values()];
      const items = source.filter((item) => !query.q || item.storeName.includes(query.q));
      return ok({ items });
    }
    return error(404, 40401, "NOT_FOUND", "内容不存在或已被移除", requestId);
  };

  return {
    received,
    handle(request) {
      received.push(request);
      const requestId = request.headers["x-request-id"] ?? "sample-request";
      if (request.method === "GET") return read(request, requestId);
      // 非 GET 照约定 C4、C47 把关：防跨站头与幂等键
      if (request.headers["x-lyx-admin"] !== "1") {
        return error(
          403,
          40305,
          "ORIGIN_REJECTED",
          "请求来源不被允许，请刷新页面后重试",
          requestId,
        );
      }
      const key = request.headers["idempotency-key"];
      if (!key) {
        return error(
          400,
          40002,
          "IDEMPOTENCY_KEY_REQUIRED",
          "操作未完成，请刷新页面后重试",
          requestId,
        );
      }
      // 同键重放返回上次成功的结果；失败不留记录（约定 C50）
      const replayKey = `${request.method} ${request.path} ${key}`;
      const replayed = replays.get(replayKey);
      if (replayed) return replayed;
      const response = write(request, requestId);
      if (response.status === 200) replays.set(replayKey, response);
      return response;
    },
  };
}
