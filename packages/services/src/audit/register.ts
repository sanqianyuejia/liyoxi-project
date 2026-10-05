// audit 模块的登记（W1-01a）：auth_event 的清理项。调度在 ops.retention（W0-24），这里只登记。
// 两条每日校验（audit.I2、audit.I3）的登记随 W0-24。
import { defineRegistration } from "../kernel/index.js";
import { purgeAuthEvents } from "./auth-event.js";

export const registration = defineRegistration("audit", {
  cleanups: [{ name: "audit.auth_event", every: "day", run: purgeAuthEvents }],
});
