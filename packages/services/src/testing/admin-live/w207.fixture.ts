import { createIdentityContext } from "../../kernel/index.js";
import { base32Decode, hotp, issueActivationCode, totpStep } from "../../staff/index.js";
import { loadKeyring, openField } from "../../security/index.js";
import { sampleStaffContext } from "../approval.js";
import type { AdminLiveFixture } from "./context.js";

/** 四页前置只用本轮合法配置与既有员工，保持原live员工数量与生产默认配置不变。 */
const fixture: AdminLiveFixture = async ({ runtime, make }) => {
  const admin = await runtime.tx.run((tx) =>
    tx.staff.findFirstOrThrow({ where: { staffRoleKey: "super_admin", status: "active" } }),
  );
  const actor = {
    staff: await runtime.tx.run((tx) => sampleStaffContext(tx, admin.id)),
    identity: createIdentityContext({ actor: { type: "staff", id: admin.id, client: "admin" } }),
  };
  const industry = await runtime.configAdmin.createDictItem(actor, {
    typeKey: "industry",
    name: "配置演练引用行业",
    ext: { open: true, special: false, requiredCerts: [] },
  });
  const child = await runtime.configAdmin.createDictItem(actor, {
    typeKey: "industry",
    parentCode: industry.code,
    name: "配置演练品类",
    ext: { open: true, special: false, requiredCerts: [] },
  });
  const store = await make.store({ name: "配置演练引用门店" });
  await runtime.tx.run((tx) =>
    tx.storeProfile.create({
      data: {
        storeId: store.id,
        entityId: store.entityId,
        industryCode: industry.code,
        categoryCode: child.code,
        createdAt: runtime.clock.now(),
        updatedAt: runtime.clock.now(),
      },
    }),
  );
  const free = await runtime.configAdmin.createDictItem(actor, {
    typeKey: "industry",
    name: "配置演练未引用",
    ext: { open: true, special: false, requiredCerts: [] },
  });
  const params = await runtime.configAdmin.params({ keys: ["work.start"] });
  await runtime.configAdmin.replaceParams(actor, {
    items: [{ key: "work.start", value: "09:00", expectedRev: params.items[0]?.latestRev ?? null }],
  });
  // 只给finance真实查看等级，权限点仍是原财务配置，不能编辑配置或读取超级管开关。
  await runtime.tx.run(async (tx) => {
    const role = await tx.staffRole.findUniqueOrThrow({ where: { key: "finance" } });
    const levels =
      typeof role.moduleLevels === "object" &&
      role.moduleLevels !== null &&
      !Array.isArray(role.moduleLevels)
        ? role.moduleLevels
        : {};
    await tx.staffRole.update({
      where: { key: role.key },
      data: { moduleLevels: { ...levels, system: "v" } },
    });
  });
  const viewer = await runtime.tx.run((tx) =>
    tx.staff.findFirstOrThrow({ where: { name: "演练财务配置提议", status: "active" } }),
  );
  const phone = openField(loadKeyring(runtime.env), "staff.phone_enc", viewer.phoneEnc);
  const password = "Liyoxi-2026-view",
    meta = { ip: "127.0.0.1", userAgent: "lyxtest W207 live" };
  const issued = await runtime.tx.run((tx) =>
    issueActivationCode(tx, {
      staffId: viewer.id,
      purpose: "activate",
      delivery: "manual",
      createdByStaffId: null,
      now: runtime.clock.now(),
    }),
  );
  const activated = await runtime.staffAuth.activate({ phone, activationCode: issued.code });
  if (!activated.ticket) throw new Error("W207演练查看员工激活票据缺失");
  const set = await runtime.staffAuth.setPassword({
    ticket: activated.ticket,
    newPassword: password,
    meta,
  });
  if (!set.ticket) throw new Error("W207演练查看员工绑定票据缺失");
  const enrolled = await runtime.staffAuth.enrollTotp({ ticket: set.ticket });
  const signed = await runtime.staffAuth.confirmTotp({
    ticket: enrolled.ticket,
    code: hotp(base32Decode(enrolled.secret), totpStep(runtime.clock.now())),
    meta,
  });
  return {
    industry: { id: industry.dictItemId, code: industry.code, name: industry.name },
    free: { id: free.dictItemId, code: free.code, name: free.name },
    viewer: {
      phone,
      password,
      recoveryCode: signed.recoveryCodes[0],
      w206RecoveryCode: signed.recoveryCodes[1],
      w312RecoveryCode: signed.recoveryCodes[2],
    },
    year: 2026,
    checklistCode: "patrol.check",
    flagKey: "release.partner",
  };
};
export default fixture;
