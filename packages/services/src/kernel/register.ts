// kernel 的登记（W0-17）：声明本模块定义的五个端口，装配时才查得出“实现指向没声明过的端口”。
// 三个单实现的端口都带空实现，两个按键的端口可以一个实现都没有：谁都不登记也装得起来。
import { defineRegistration } from "./assembly/index.js";
import {
  alertsPort,
  invariantsPort,
  notifyReadPort,
  remindersPort,
  trackPort,
} from "./ports/index.js";

export const registration = defineRegistration("kernel", {
  ports: [alertsPort, invariantsPort, trackPort, notifyReadPort, remindersPort],
});
