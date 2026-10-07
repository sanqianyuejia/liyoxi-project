// 各域的进程内循环的清单（M1 起）。M0 的四个循环（出站中继、出站派发、定时器扫描、周期补登记）在 runtime.ts。
// 加一个循环：在 src/loops/ 下加一个文件，在下面加一行。名字要先在契约里登记（@liyoxi/contract/registry 的 LOOPS）。
import type { DomainLoopDef } from "./loop.js";
import { billingAdvance } from "./loops/billing-advance.js";

import { deliveryReevaluate } from "./loops/delivery-reevaluate.js";
import { probe } from "./loops/probe.js";
import { webhookReprocess } from "./loops/webhook-reprocess.js";

export const DOMAIN_LOOPS: readonly DomainLoopDef[] = [
  billingAdvance,
  deliveryReevaluate,
  webhookReprocess,
  probe,
];
