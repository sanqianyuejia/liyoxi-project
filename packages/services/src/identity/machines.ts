// merchant_user.status 的登记（W1-04；02 分组 第 2.1 节的状态机表）：M1 只用“注册”一行（02:125）。
// 迁移表本身在 @liyoxi/shared/machines；这里是它的守卫。禁用、启用、注销、空账号清理四行随 M2：
// 在那之前迁移到这些行即抛内部错误，不放行。
import { chainKey, machinePort, rowKey } from "../flow/index.js";
import type { Guard, MachineBinding } from "../flow/index.js";
import { implementKeyed } from "../kernel/index.js";
import type { PortImplementation } from "../kernel/index.js";

/** 注册那一行迁移随 args 带的事实 */
export interface RegisterArgs {
  /** 同一事务里刚写完同意记录，用户级协议是否已齐（docs.assertConsents 的结论） */
  readonly consentComplete: boolean;
}

/**
 * 02:125 merchant_user.register：协议已同意。用例先写同意记录再迁移（同一事务），把结论经 args 带进来；
 * 守卫自己回库核对这个账号确有不带单据的同意记录（登录、加入、重新同意写的那一类）。
 */
const consentGiven: Guard = async (tx, facts) => {
  const { consentComplete } = (facts.args ?? {}) as Partial<RegisterArgs>;
  if (consentComplete !== true) return false;
  const rows = await tx.agreementConsent.count({
    where: { merchantUserId: facts.subjectId, bizType: null },
  });
  return rows > 0;
};

export const IDENTITY_MACHINE_BINDINGS: Readonly<Record<string, MachineBinding>> = {
  [chainKey("merchant_user", "status")]: {
    // 注销时与状态同一条 UPDATE 写的列（ck_merchant_user_deleted、ck_merchant_user_pii_by_status），随 M2 用上
    companions: [
      "deleted_at",
      "phone_enc",
      "phone_bidx",
      "phone_mask",
      "phone_last4",
      "display_name",
    ],
    guards: { [rowKey("02:125", "merchant_user.register")]: consentGiven },
  },
};

export const machineImplementations = (): PortImplementation[] =>
  Object.entries(IDENTITY_MACHINE_BINDINGS).map(([key, binding]) =>
    implementKeyed(machinePort, key, binding),
  );
