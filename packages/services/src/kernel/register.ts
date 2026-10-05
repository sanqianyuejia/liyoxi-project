// kernel 的登记（W0-17）：声明本模块定义的五个端口，装配时才查得出“实现指向没声明过的端口”；另登记一条清理项。
// 三个单实现的端口都带空实现，两个按键的端口可以一个实现都没有：谁都不登记也装得起来。
// W1-03 加第六个：商家读侧的事实端口（按键，同样可以一个实现都没有）。
import { defineRegistration } from "./assembly/index.js";
import { purgeExpiredIdempotencyRecords } from "./idempotency-tools.js";
import {
  alertsPort,
  invariantsPort,
  merchantFactsPort,
  notifyReadPort,
  remindersPort,
  trackPort,
} from "./ports/index.js";

export const registration = defineRegistration("kernel", {
  ports: [alertsPort, invariantsPort, trackPort, notifyReadPort, remindersPort, merchantFactsPort],
  // 幂等行的过期清理（W0-24 登记；01 分组 第 2.1 节，15 分组 第 5.3 节）：每小时一轮，由 ops.retention 调度
  cleanups: [
    {
      name: "kernel.idempotency_record",
      every: "hour",
      run: (tx, ctx) => purgeExpiredIdempotencyRecords(tx, ctx.limit),
    },
  ],
});
