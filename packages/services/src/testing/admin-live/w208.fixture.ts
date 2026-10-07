import { createActor } from "../../kernel/index.js";
import { record } from "../../audit/index.js";
import { issueActivationCode, base32Decode, hotp, totpStep } from "../../staff/index.js";
import { loadKeyring, openField } from "../../security/index.js";
import type { AdminLiveFixture } from "./context.js";
// 全部是本轮隔离库的虚构记录。PII access 行由浏览器用例实际 POST 产生，不预写终态。
const fixture: AdminLiveFixture = async ({ make, runtime }) => {
  let stage = "finance";
  try {
    const finance = await runtime.tx.run((tx) =>
      tx.staff.findFirstOrThrow({
        where: { name: "演练财务配置审批", staffRoleKey: "finance", status: "active" },
      }),
    );
    // 合法可编辑角色前置：只在本轮 finance 增加 system 查看等级，旧员工/数量/范围保持。
    await runtime.tx.run(async (tx) => {
      const role = await tx.staffRole.findUniqueOrThrow({ where: { key: "finance" } });
      await tx.staffRole.update({
        where: { key: role.key },
        data: { moduleLevels: { ...(role.moduleLevels as Record<string, string>), system: "v" } },
      });
    });
    const phone = openField(loadKeyring(runtime.env), "staff.phone_enc", finance.phoneEnc),
      password = "Liyoxi-2026-ok",
      meta = { ip: "127.0.0.1", userAgent: "lyxtest W208 live" };
    const issued = await runtime.tx.run((tx) =>
      issueActivationCode(tx, {
        staffId: finance.id,
        purpose: "activate",
        delivery: "manual",
        createdByStaffId: null,
        now: runtime.clock.now(),
      }),
    );
    stage = "activate";
    const activated = await runtime.staffAuth.activate({ phone, activationCode: issued.code });
    if (!activated.ticket) throw new Error("日志演练激活票据缺失");
    stage = "password";
    const set = await runtime.staffAuth.setPassword({
      ticket: activated.ticket,
      newPassword: password,
      meta,
    });
    if (!set.ticket) throw new Error("日志演练口令票据缺失");
    stage = "enroll";
    const enrolled = await runtime.staffAuth.enrollTotp({ ticket: set.ticket });
    stage = "confirm";
    const signed = await runtime.staffAuth.confirmTotp({
      ticket: enrolled.ticket,
      code: hotp(base32Decode(enrolled.secret), totpStep(runtime.clock.now())),
      meta,
    });
    stage = "merchant";
    const merchant = await make.merchant({ verified: true });
    if (!merchant.user.phoneEnc) throw new Error("日志演练商家工厂缺少假手机号密文");
    stage = "record";
    const records = [];
    for (let index = 0; index < 24; index++) {
      const system = index === 0;
      const result = await runtime.tx.run((tx) =>
        record(
          tx,
          createActor(
            system
              ? { type: "system", job: "lyxtest.w208" }
              : { type: "staff", id: finance.id, client: "admin" },
          ),
          {
            requestId: `w208-${index}`,
            ip: "198.51.100.23",
            userAgent: "lyxtest",
            authMethod: system ? "system" : "password+totp",
            sessionId: null,
            actorName: system ? "系统" : finance.name,
            actorRole: system ? "自动任务" : "财务",
          },
          {
            stream: "ops",
            category: system || index % 2 ? "param" : "staff_authz",
            action: system || index % 2 ? "sys.param.update" : "sys.staff.update",
            summary: `日志演练 ${String(index + 1).padStart(2, "0")}：更新虚构配置`,
            target: system
              ? { type: "billing_param", id: "demo.w208", label: "日志演练参数" }
              : { type: "staff", id: finance.id, label: finance.name },
            entityId: merchant.entity.id,
            storeId: merchant.store.id,
            before: { status: "pending", phone: "13900008881" },
            after: { status: "active", phone: "13900008882" },
            fields: ["status", "phone"],
            meta: {
              count: index,
              unexpected: { privateMemo: "W208_PRIVATE_NESTED_VALUE" },
              purpose: "verify_identity",
              note: "隔离演练，无真实商家信息",
            },
          },
        ),
      );
      records.push(result);
    }
    return {
      records,
      entityId: merchant.entity.id,
      storeId: merchant.store.id,
      staffId: finance.id,
      phone,
      password,
      recoveryCode: signed.recoveryCodes[0],
      privateMarker: "W208_PRIVATE_NESTED_VALUE",
      piiSubjectId: merchant.user.id,
      piiPhone: openField(
        loadKeyring(runtime.env),
        "merchant_user.phone_enc",
        merchant.user.phoneEnc,
      ),
    };
  } catch (error) {
    const failure = new Error("本轮日志演练前置失败");
    failure.name = `W208_${stage}_${error instanceof Error ? error.name : "unknown"}`;
    throw failure;
  }
};
export default fixture;
