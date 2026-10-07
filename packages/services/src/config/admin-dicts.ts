import { dictExtSchema, DictItemViewSchema } from "@liyoxi/contract";
import type { DictItemCreateBodySchema, DictItemUpdateBodySchema } from "@liyoxi/contract";
import type { z } from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { AppError, dictReferencesOf, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { auditConfig, invalid, requireConfigActor } from "./admin-context.js";
import type { ConfigActor, ConfigAdminDeps } from "./admin-context.js";

const locked = (rule: string): never => {
  throw new AppError("DICT_ITEM_LOCKED", { details: { rule } });
};
export function createAdminDicts(deps: ConfigAdminDeps) {
  const counts = dictReferencesOf(deps.assembly);
  const view = (row: Prisma.DictItemGetPayload<object>, refCount: number | null = null) =>
    DictItemViewSchema.parse({
      ...row,
      dictItemId: row.id,
      typeKey: row.dictTypeKey,
      refCount,
      updatedAt: row.updatedAt.toISOString(),
    });
  async function typeLocked(tx: Tx, key: string) {
    // 配置行不在 LOCK_ORDER；同一类型的发码与修改共用这一把行锁。
    await tx.$queryRaw`SELECT type_key FROM dict_type WHERE type_key=${key} FOR UPDATE`;
    const type = await tx.dictType.findUnique({ where: { typeKey: key } });
    if (!type) throw new AppError("NOT_FOUND");
    return type;
  }
  async function extOf(tx: Tx, typeKey: string, input: unknown) {
    if (
      typeKey === "industry" &&
      typeof input === "object" &&
      input !== null &&
      "special" in input &&
      input.special === true &&
      "open" in input &&
      input.open === true
    )
      locked("special_industry_cannot_open");
    const result = dictExtSchema(typeKey).safeParse(input);
    if (!result.success) return invalid("ext", "扩展属性不合该类型结构");
    if (
      typeKey === "industry" &&
      "requiredCerts" in result.data &&
      Array.isArray(result.data.requiredCerts)
    ) {
      const codes = result.data.requiredCerts as string[];
      await tx.$queryRaw`SELECT id FROM dict_item WHERE dict_type_key='permit_type' AND code=ANY(${codes}::text[]) ORDER BY id FOR SHARE`;
      const permits = await tx.dictItem.findMany({
        where: { dictTypeKey: "permit_type", code: { in: codes } },
      });
      for (const code of codes) {
        const permit = permits.find((row) => row.code === code);
        if (!permit) invalid("ext.requiredCerts", "许可类型不存在");
        if (!permit?.isEnabled)
          throw new AppError("DICT_ITEM_DISABLED", {
            details: { dictTypeKey: "permit_type", code },
          });
      }
    }
    return result.data as Prisma.InputJsonObject;
  }
  return {
    async types(tx: Tx) {
      const [types, items] = await Promise.all([
        tx.dictType.findMany({ orderBy: { typeKey: "asc" } }),
        tx.dictItem.findMany(),
      ]);
      return {
        items: types.map((type) => {
          const own = items.filter((item) => item.dictTypeKey === type.typeKey);
          const byCode = new Map(own.map((row) => [row.code, row]));
          const levelCounts = Array.from({ length: type.maxDepth }, () => 0);
          for (const item of own) {
            let depth = 0;
            let parent = item.parentCode;
            const seen = new Set([item.code]);
            while (parent && !seen.has(parent)) {
              seen.add(parent);
              depth++;
              parent = byCode.get(parent)?.parentCode ?? null;
            }
            if (depth < levelCounts.length) levelCounts[depth] = (levelCounts[depth] ?? 0) + 1;
          }
          return {
            ...type,
            itemCount: own.length,
            enabledCount: own.filter((row) => row.isEnabled).length,
            levelCounts,
          };
        }),
      };
    },
    async withReferences(tx: Tx, items: readonly { typeKey: string; code: string }[]) {
      const result = new Map<string, number | null>();
      for (const type of new Set(items.map((item) => item.typeKey))) {
        const codes = items.filter((item) => item.typeKey === type).map((item) => item.code);
        const found = await counts.count(tx, type, codes);
        for (const code of codes) result.set(`${type}:${code}`, found?.get(code) ?? null);
      }
      return result;
    },
    async create(tx: Tx, ctx: ConfigActor, input: z.infer<typeof DictItemCreateBodySchema>) {
      const staffId = requireConfigActor(ctx, "sys.dict.edit");
      const type = await typeLocked(tx, input.typeKey);
      if (!type.canCreate || !type.codePrefix || !type.codeWidth)
        throw new AppError("DICT_TYPE_NOT_EDITABLE");
      const parentCode = input.parentCode ?? null;
      const siblings = await tx.dictItem.findMany({
        where: { dictTypeKey: type.typeKey, parentCode },
      });
      if (siblings.some((row) => row.name === input.name))
        throw new AppError("DICT_NAME_DUPLICATED");
      let code: string;
      if (parentCode) {
        let parent = await tx.dictItem.findUnique({
          where: { dictTypeKey_code: { dictTypeKey: type.typeKey, code: parentCode } },
        });
        if (!parent) return invalid("parentCode", "上级不存在");
        if (!parent.isEnabled)
          throw new AppError("DICT_ITEM_DISABLED", {
            details: { dictTypeKey: type.typeKey, code: parentCode },
          });
        let depth = 1;
        while (parent.parentCode) {
          depth++;
          parent = await tx.dictItem.findUnique({
            where: { dictTypeKey_code: { dictTypeKey: type.typeKey, code: parent.parentCode } },
          });
          if (!parent) return invalid("parentCode", "上级层级不完整");
        }
        if (depth >= type.maxDepth) invalid("parentCode", "超出最大层级");
        const seq =
          Math.max(0, ...siblings.map((row) => Number(row.code.slice(parentCode.length)))) + 1;
        if (seq > 99) invalid("parentCode", "子编码序号已耗尽");
        code = parentCode + String(seq).padStart(2, "0");
      } else code = type.codePrefix + String(type.nextCodeNo).padStart(type.codeWidth, "0");
      const now = deps.clock.now();
      const row = await tx.dictItem.create({
        data: {
          id: uuidv7(),
          dictTypeKey: type.typeKey,
          code,
          parentCode,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags ?? [],
          ext: await extOf(tx, type.typeKey, input.ext ?? {}),
          position: Math.max(-1, ...siblings.map((row) => row.position)) + 1,
          createdByStaffId: staffId,
          updatedByStaffId: staffId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.dictType.update({
        where: { typeKey: type.typeKey },
        data: {
          versionNo: { increment: 1 },
          ...(parentCode ? {} : { nextCodeNo: { increment: 1 } }),
          updatedAt: now,
        },
      });
      await auditConfig(
        tx,
        ctx,
        "dict",
        "sys.dict.item_create",
        { type: "dict_item", id: row.id },
        null,
        row,
      );
      return view(row);
    },
    async update(
      tx: Tx,
      ctx: ConfigActor,
      id: string,
      input: z.infer<typeof DictItemUpdateBodySchema>,
    ) {
      const staffId = requireConfigActor(ctx, "sys.dict.edit");
      const first = await tx.dictItem.findUnique({ where: { id } });
      if (!first) throw new AppError("NOT_FOUND");
      const type = await typeLocked(tx, first.dictTypeKey);
      await tx.$queryRaw`SELECT id FROM dict_item WHERE id=${id}::uuid ORDER BY id FOR UPDATE`;
      const before = await tx.dictItem.findUniqueOrThrow({ where: { id } });
      if (input.lockVersion !== before.lockVersion) throw new AppError("VERSION_CONFLICT");
      if (
        type.isSystem &&
        Object.keys(input).some((key) => !["lockVersion", "name", "description"].includes(key))
      )
        locked("system_enum_display_only");
      if (input.isEnabled === false && type.disablePolicy === "never") locked("never_disable");
      if (input.isEnabled === false && type.disablePolicy === "block_if_referenced") {
        const refs = await counts.count(tx, type.typeKey, [before.code]);
        if (refs === null) return locked("reference_source_not_registered");
        const refCount = refs.get(before.code) ?? 0;
        if (refCount > 0) throw new AppError("DICT_ITEM_IN_USE", { details: { refCount } });
      }
      if (
        input.name !== undefined &&
        input.name !== before.name &&
        (await tx.dictItem.count({
          where: {
            dictTypeKey: type.typeKey,
            parentCode: before.parentCode,
            name: input.name,
            id: { not: id },
          },
        }))
      )
        throw new AppError("DICT_NAME_DUPLICATED");
      if (
        type.typeKey === "industry" &&
        typeof before.ext === "object" &&
        before.ext !== null &&
        !Array.isArray(before.ext) &&
        before.ext.special === true &&
        input.ext?.open === true
      )
        locked("special_industry_cannot_open");
      const { lockVersion: _lockVersion, ext, ...changes } = input;
      const now = deps.clock.now();
      const row = await tx.dictItem.update({
        where: { id },
        data: {
          ...changes,
          ...(ext === undefined ? {} : { ext: await extOf(tx, type.typeKey, ext) }),
          lockVersion: { increment: 1 },
          updatedByStaffId: staffId,
          updatedAt: now,
        },
      });
      await tx.dictType.update({
        where: { typeKey: type.typeKey },
        data: { versionNo: { increment: 1 }, updatedAt: now },
      });
      await auditConfig(
        tx,
        ctx,
        "dict",
        "sys.dict.item_update",
        { type: "dict_item", id },
        before,
        row,
      );
      return view(row);
    },
  };
}
