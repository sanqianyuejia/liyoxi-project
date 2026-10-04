// 样例接口的类型与取数函数。契约里现在一条后台路由都没有（W0-10 接管后才有），
// 样例页自带一份最小的 paths 类型，借用应用里那一个请求客户端：请求头、幂等键、统一错误处置都走真实的路径。
import type { ErrorBody } from "@liyoxi/contract/errors";
import type { Client } from "openapi-fetch";
import type { OpenapiQueryClient } from "openapi-react-query";

import type { AppServices } from "../app/services";

import type { SampleReview, SampleStore, SampleStoreDetail } from "./sample-data";

type NoParams = { query?: never; header?: never; path?: never; cookie?: never };
type Ok<T> = {
  headers: Record<string, unknown>;
  content: { "application/json": { code: 0; message: "ok"; data: T } };
};
type Fail = { headers: Record<string, unknown>; content: { "application/json": ErrorBody } };
type Responses<T> = { 200: Ok<T>; 400: Fail; 403: Fail; 404: Fail; 409: Fail; 500: Fail };
type Get<Q, P, T> = {
  parameters: { query?: Q; header?: never; path: P; cookie?: never };
  requestBody?: never;
  responses: Responses<T>;
};
type Post<P, B, T> = {
  parameters: { query?: never; header?: { "Idempotency-Key"?: string }; path: P; cookie?: never };
  requestBody: { content: { "application/json": B } };
  responses: Responses<T>;
};
type Unused = {
  put?: never;
  delete?: never;
  options?: never;
  head?: never;
  patch?: never;
  trace?: never;
};
type ListQuery = Record<string, string | number>;

export interface SamplePaths {
  "/admin/samples/stores": { parameters: NoParams; post?: never } & Unused & {
      get: Omit<
        Get<
          ListQuery,
          never,
          { items: SampleStore[]; page: number; pageSize: number; total: number }
        >,
        "parameters"
      > & {
        parameters: { query?: ListQuery; header?: never; path?: never; cookie?: never };
      };
    };
  "/admin/samples/stores/summary": { parameters: NoParams; post?: never } & Unused & {
      get: Omit<
        Get<ListQuery, never, { all: number; pending: number; verified: number }>,
        "parameters"
      > & {
        parameters: { query?: ListQuery; header?: never; path?: never; cookie?: never };
      };
    };
  "/admin/samples/stores/{storeId}": { parameters: NoParams; post?: never } & Unused & {
      get: Get<never, { storeId: string }, SampleStoreDetail>;
    };
  "/admin/samples/stores/{storeId}/disable": { parameters: NoParams; get?: never } & Unused & {
      post: Post<
        { storeId: string },
        { lockVersion: number; confirm: { phoneTail: string } },
        { id: string; disabled: boolean }
      >;
    };
  "/admin/samples/reviews": { parameters: NoParams; post?: never } & Unused & {
      get: Omit<
        Get<ListQuery, never, { items: (SampleReview & { result?: string })[] }>,
        "parameters"
      > & {
        parameters: { query?: ListQuery; header?: never; path?: never; cookie?: never };
      };
    };
  "/admin/samples/reviews/summary": { parameters: NoParams; post?: never } & Unused & {
      get: Omit<Get<never, never, { pending: number; done: number }>, "parameters"> & {
        parameters: NoParams;
      };
    };
  "/admin/samples/reviews/{reviewId}/approve": { parameters: NoParams; get?: never } & Unused & {
      post: Post<
        { reviewId: string },
        { lockVersion: number; checked: string[] },
        { id: string; result: string }
      >;
    };
  "/admin/samples/reviews/{reviewId}/reject": { parameters: NoParams; get?: never } & Unused & {
      post: Post<
        { reviewId: string },
        { lockVersion: number; checked: string[] },
        { id: string; result: string }
      >;
    };
}

/** 应用里那一个请求客户端，换上样例的 paths 类型 */
export function sampleClient(services: AppServices): Client<SamplePaths> {
  return services.api.client as unknown as Client<SamplePaths>;
}

/** 应用里那一组带类型的查询钩子，换上样例的 paths 类型 */
export function sampleQuery(services: AppServices): OpenapiQueryClient<SamplePaths> {
  return services.query as unknown as OpenapiQueryClient<SamplePaths>;
}

/** 取数失败时抛出去的错：带上服务端的文案，给骨架的出错态显示 */
export class SampleApiError extends Error {
  constructor(readonly body: ErrorBody | undefined) {
    super(body?.message ?? "数据没有取到，请重新加载");
  }
}
