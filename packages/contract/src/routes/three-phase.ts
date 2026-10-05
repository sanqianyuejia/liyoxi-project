// 三段式用例的登记（约定 C51 的表；W0-22b）。按 operationId 登记，取值是形态：
//   external-first  先调外部、再开事务
//   commit-first    先落库、提交后外调
//   multi-tx        外部调用夹在两个事务之间
// 路由上的 x-three-phase: true 与这张表是同一个声明的两种写法：isThreePhaseRoute 两处都认。
// 三段式走的仍是幂等上下文（占用、续做、写回都在幂等记录上），所以 api 的“声明即挂载”把它对到幂等中间件。
// 加一条：先改约定 C51 的表，再在这里加一行。
import type { RouteMeta } from "./meta.js";

export const THREE_PHASE_SHAPES = ["external-first", "commit-first", "multi-tx"] as const;
export type ThreePhaseShape = (typeof THREE_PHASE_SHAPES)[number];

export const THREE_PHASE_OPERATIONS = {
  "m.paymentOrder.wechatPrepay": "multi-tx",
  "m.paymentOrder.cancel": "external-first",
  "m.paymentOrder.sync": "external-first",
  "admin.refundRequest.execute": "multi-tx",
  "admin.refundRequest.retry": "external-first",
  "admin.refundRequest.confirmNotAccepted": "external-first",
  "admin.paymentException.resolve": "external-first",
  "m.me.changePhone": "external-first",
  "m.smsCode.create": "commit-first",
  "m.storeProfile.contactSmsCode.create": "commit-first",
  "m.file.complete": "multi-tx",
  "admin.notifyScene.testSend": "commit-first",
  "admin.smsTemplate.testSend": "commit-first",
  "m.qualificationDoc.create": "external-first",
  "admin.uploadBatchItem.complete": "multi-tx",
  "admin.auth.bindWecom": "external-first",
  "admin.file.complete": "multi-tx",
  "admin.file.restore": "external-first",
  "admin.file.erase": "multi-tx",
} as const satisfies Record<string, ThreePhaseShape>;

/** 这条路由是不是三段式用例：登记表里有，或路由自己标了 x-three-phase */
export function isThreePhaseRoute(
  route: Pick<RouteMeta, "operationId" | "x-three-phase">,
): boolean {
  return (
    route["x-three-phase"] === true || Object.hasOwn(THREE_PHASE_OPERATIONS, route.operationId)
  );
}
