// staff 的种子（W0-21）：8 个固定角色，取契约里的代码默认配置（03 分组 第 2.1 节）。
// 没有才插：后台改过的模块等级、权限点开关、数据范围都留着；权限点登记以后多出来的键不回填进已有的行
//（库里缺的键读时取代码默认值，03 分组 第 4 节）。
import { defaultRoleActions, STAFF_ROLE_DEFAULTS } from "@liyoxi/contract";
import type { StaffRoleKey } from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";

import { defineSeed, insertMissing, uuidv7 } from "../kernel/index.js";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * 每个角色一个默认组（W1-01a；03 分组 第 2.2 节）：“本组”数据范围的组织实体，新员工缺省进所属角色的默认组。
 * 没有才插：按“这个角色有没有默认组”认，运营改过组名的不动。
 */
export const DEFAULT_STAFF_GROUP_NAMES: Readonly<Record<StaffRoleKey, string>> = {
  super_admin: "管理员组",
  cs: "客服组",
  delivery_manager: "交付组",
  editor: "剪辑组",
  publisher: "发布组",
  content_ops: "内容运营组",
  channel_ops: "渠道运营组",
  finance: "财务组",
};

export const seed = defineSeed("staff", async (tx, { now }) => [
  await insertMissing({
    table: "staff_role",
    rows: STAFF_ROLE_DEFAULTS,
    keyOf: (row) => row.key,
    existingKeys: async () =>
      (await tx.staffRole.findMany({ select: { key: true } })).map((row) => row.key),
    insert: (missing) =>
      tx.staffRole.createMany({
        data: missing.map((row) => ({
          key: row.key,
          name: row.name,
          description: row.description,
          moduleLevels: json(row.moduleLevels),
          actions: json(defaultRoleActions(row.key)),
          dataScope: row.dataScope,
          isLocked: row.isLocked,
          availableFrom: row.availableFrom,
          createdAt: now,
          updatedAt: now,
        })),
      }),
  }),
  await insertMissing({
    table: "staff_group",
    rows: STAFF_ROLE_DEFAULTS.map((role) => role.key),
    keyOf: (roleKey) => roleKey,
    existingKeys: async () =>
      (
        await tx.staffGroup.findMany({ where: { isDefault: true }, select: { staffRoleKey: true } })
      ).map((row) => row.staffRoleKey),
    insert: (missing) =>
      tx.staffGroup.createMany({
        data: missing.map((roleKey) => ({
          id: uuidv7(),
          name: DEFAULT_STAFF_GROUP_NAMES[roleKey],
          staffRoleKey: roleKey,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })),
      }),
  }),
]);
