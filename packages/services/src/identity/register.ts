import { identityPiiFields } from "./pii-fields.js";
// identity 模块的登记（W1-04）：
//   端口     W2-10 PR1：tenant 的强制下载页成员授权吊销，调用方同事务持锁。
//   状态机   merchant_user.status 的随迁列与“注册”一行的守卫。
//   不变量   identity.I8、I9、I22、I23、I25；调度与落库由 ops（W0-24）。
// 订阅者 identity.onWechatBound（写一次性提示）随 M2；会话的过期清理随 W0-24 的清理框架接上时登记。
import { defineRegistration, implement } from "../kernel/index.js";
import type { InvariantRegistration } from "../kernel/index.js";
import { membershipAuthorizationsPort } from "../tenant/index.js";
import {
  findI22Violations,
  findI23Violations,
  findI25Violations,
  findI8Violations,
  findI9Violations,
} from "./invariants.js";
import { machineImplementations } from "./machines.js";
import { membershipAuthorizations } from "./portal-grants.js";

const check = (
  code: string,
  run: NonNullable<InvariantRegistration["run"]>,
): InvariantRegistration => ({ code, severity: "P2", modes: ["full"], heal: "none", run });

export const registration = defineRegistration("identity", {
  portImplementations: [
    ...identityPiiFields,
    ...machineImplementations(),
    implement(membershipAuthorizationsPort, membershipAuthorizations),
  ],
  invariants: [
    check("identity.I8", (tx) => findI8Violations(tx)),
    check("identity.I9", (tx) => findI9Violations(tx)),
    check("identity.I22", (tx) => findI22Violations(tx)),
    check("identity.I23", (tx) => findI23Violations(tx)),
    check("identity.I25", (tx) => findI25Violations(tx)),
  ],
});
