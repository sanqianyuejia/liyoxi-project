import { ParamListSchema, ParamItemSchema } from "@liyoxi/contract";
import type { ParamListQuerySchema, ParamReplaceBodySchema, z } from "@liyoxi/contract";
import { PARAM_KEYS, PARAM_KEYS_BY_GROUP } from "@liyoxi/contract/config/params";
import type { ParamGroup } from "@liyoxi/contract/config/params";
import {
  PARAM_DEFS,
  paramDef,
  validateParamValue,
  checkParamPairs,
  PARAM_PAIR_RULES,
} from "@liyoxi/shared/params";
import type { ParamDef } from "@liyoxi/shared/params";
import { AppError, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { auditConfig, invalid, requireConfigActor } from "./admin-context.js";
import type { ConfigActor, ConfigAdminDeps } from "./admin-context.js";

const groupOf = (key: string): ParamGroup => {
  const group = PARAM_KEYS.find((row) => row.key === key)?.group;
  if (!group) throw new TypeError("参数定义缺少正式分组登记");
  return group;
};
const groupTitles: Record<ParamGroup, string> = {
  sla: "时限策略",
  calendar: "工作时间",
  remind: "到期提醒",
  notify: "消息通知",
  general: "通用配置",
  billing: "计费",
  payment: "收款",
  refund: "退款",
  invoice: "开票",
  recon: "对账",
  export: "数据导出",
  analytics: "数据分析",
  platform: "平台信息",
  identity: "登录身份",
  tenant: "主体与门店",
  staff: "员工账号",
  approval: "审批",
  content: "短剧内容",
  media: "媒体文件",
  order: "订购",
  ad: "广告",
  delivery: "制作交付",
  publish: "发布与下线",
  support: "客服",
  profile: "门店档案",
};
const mask = (path: string, value: string) =>
  path === "phone" ? value.slice(0, 3) + "****" + value.slice(-4) : "****" + value.slice(-4);
function masked(def: ParamDef, value: unknown): unknown {
  if (!def.sensitivePaths?.length || !Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, v]) => [
        key,
        def.sensitivePaths?.includes(key) && typeof v === "string" ? mask(key, v) : v,
      ]),
    );
  });
}
function restored(def: ParamDef, value: unknown, previous: unknown): unknown {
  if (!def.sensitivePaths?.length || !Array.isArray(value)) return value;
  const prior = Array.isArray(previous) ? previous : [];
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null || !("staffId" in item)) return item;
    const old = prior.find(
      (v: unknown) =>
        typeof v === "object" && v !== null && "staffId" in v && v.staffId === item.staffId,
    );
    if (!old || typeof old !== "object") return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, v]) => {
        const previousValue = Object.entries(old).find(([field]) => field === key)?.[1];
        return [
          key,
          def.sensitivePaths?.includes(key) &&
          typeof previousValue === "string" &&
          v === mask(key, previousValue)
            ? previousValue
            : v,
        ];
      }),
    );
  });
}
async function lockKeys(tx: Tx, keys: readonly string[]) {
  for (const key of [...new Set(keys)].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`config.param:${key}`},0))`;
}
export function createAdminParams(deps: ConfigAdminDeps) {
  async function list(tx: Tx, query: z.infer<typeof ParamListQuerySchema> = {}) {
    if (query.group?.some((group) => !(group in PARAM_KEYS_BY_GROUP)))
      invalid("group", "未知参数分组");
    if (query.keys?.some((key) => !paramDef(key))) invalid("keys", "未知参数键");
    const defs = (PARAM_DEFS as readonly ParamDef[]).filter(
      (def) =>
        (!query.group || query.group.includes(groupOf(def.key))) &&
        (!query.keys || query.keys.includes(def.key)),
    );
    const now = deps.clock.now();
    const rows = await tx.paramValue.findMany({
      where: { key: { in: defs.map((def) => def.key) }, cancelledAt: null },
      orderBy: [{ seq: "desc" }],
    });
    const staff = await deps.staffBriefs(tx, [...new Set(rows.map((row) => row.createdByStaffId))]);
    const byStaff = new Map(staff.map((item) => [item.staffId, item]));
    const latestSaved = rows.reduce<(typeof rows)[number] | null>(
      (prev, row) => (!prev || row.createdAt > prev.createdAt ? row : prev),
      null,
    );
    const items = defs.map((def) => {
      const own = rows.filter((row) => row.key === def.key);
      const current = own
        .filter((row) => row.effectiveAt <= now)
        .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0];
      const validCurrent =
        current && validateParamValue(def, current.value) === null ? current : undefined;
      const range = def.options
        ? { options: [...def.options] }
        : def.min !== undefined || def.max !== undefined
          ? {
              ...(def.min === undefined ? {} : { min: def.min }),
              ...(def.max === undefined ? {} : { max: def.max }),
            }
          : null;
      return ParamItemSchema.parse({
        key: def.key,
        group: groupOf(def.key),
        label: def.label,
        description: def.description ?? "",
        type: def.type,
        unit: def.unit,
        range,
        defaultValue: masked(def, def.default),
        value: masked(def, validCurrent ? validCurrent.value : def.default),
        rev: validCurrent?.seq.toString() ?? null,
        latestRev: own[0]?.seq.toString() ?? null,
        effectiveAt: validCurrent?.effectiveAt.toISOString() ?? null,
        savedBy: validCurrent ? (byStaff.get(validCurrent.createdByStaffId) ?? null) : null,
        savedAt: validCurrent?.createdAt.toISOString() ?? null,
        pending: own
          .filter((row) => row.effectiveAt > now)
          .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
          .map((row) => ({
            paramValueId: row.id,
            value: masked(def, row.value),
            rev: row.seq.toString(),
            effectiveAt: row.effectiveAt.toISOString(),
            reason: row.reason,
            savedBy: byStaff.get(row.createdByStaffId) ?? null,
            savedAt: row.createdAt.toISOString(),
            canWithdraw: row.effectiveAt.getTime() > now.getTime() + 600000,
          })),
        snapshotOn: def.snapshotOn,
      });
    });
    const groups = [...new Set(defs.map((def) => groupOf(def.key)))].map((group) => ({
      group,
      title: groupTitles[group],
    }));
    const latestStaff = latestSaved ? byStaff.get(latestSaved.createdByStaffId) : undefined;
    return ParamListSchema.parse({
      items,
      groups,
      lastSaved:
        latestSaved && latestStaff
          ? { at: latestSaved.createdAt.toISOString(), staff: latestStaff }
          : null,
    });
  }
  return {
    list,
    async replace(tx: Tx, ctx: ConfigActor, input: z.infer<typeof ParamReplaceBodySchema>) {
      const staffId = requireConfigActor(ctx, "sys.param.edit");
      const pairKeys: string[] = PARAM_PAIR_RULES.filter((pair) =>
        input.items.some((item) => item.key === pair.start || item.key === pair.end),
      ).flatMap((pair) => [pair.start, pair.end]);
      await lockKeys(tx, [...input.items.map((item) => item.key), ...pairKeys]);
      const latest = await tx.paramValue.findMany({
        where: { key: { in: input.items.map((item) => item.key) }, cancelledAt: null },
        orderBy: { seq: "desc" },
        distinct: ["key"],
      });
      const byKey = new Map(latest.map((row) => [row.key, row]));
      const conflicts = input.items
        .filter((item) => item.expectedRev !== (byKey.get(item.key)?.seq.toString() ?? null))
        .map((item) => ({ key: item.key, latestRev: byKey.get(item.key)?.seq.toString() ?? null }));
      if (conflicts.length) throw new AppError("VERSION_CONFLICT", { details: { conflicts } });
      const now = deps.clock.now();
      // latest 只供CAS；脱敏回传沿用当前DTO对应的生效值，不能借未来预约提前生效。
      const current = await tx.paramValue.findMany({
        where: {
          key: { in: input.items.map((item) => item.key) },
          cancelledAt: null,
          effectiveAt: { lte: now },
        },
        orderBy: [{ effectiveAt: "desc" }, { seq: "desc" }],
        distinct: ["key"],
      });
      const currentByKey = new Map(current.map((row) => [row.key, row]));
      const prepared = input.items.map((item, index) => {
        const def = paramDef(item.key);
        if (!def) return invalid(`items.${index}.key`, "未登记的参数键");
        const currentRow = currentByKey.get(item.key);
        const previous =
          currentRow && validateParamValue(def, currentRow.value) === null
            ? currentRow.value
            : def.default;
        const value = restored(def, item.value, previous);
        const issue = validateParamValue(def, value);
        if (issue) invalid(`items.${index}.value`, issue);
        const effectiveAt = item.effectiveAt ? new Date(item.effectiveAt) : now;
        if (effectiveAt < now) invalid(`items.${index}.effectiveAt`, "生效时间不能早于现在");
        return { key: item.key, value, effectiveAt, index };
      });
      // 每一个预约边界都校验成对参数；另一键的预约也可能使本批次组合失效。
      if (pairKeys.length) {
        const pairRows = await tx.paramValue.findMany({
          where: { key: { in: pairKeys }, cancelledAt: null },
        });
        const boundaries = [
          now,
          ...prepared.map((item) => item.effectiveAt),
          ...pairRows.filter((row) => row.effectiveAt > now).map((row) => row.effectiveAt),
        ];
        for (const at of boundaries) {
          const values: Record<string, unknown> = {};
          for (const key of pairKeys) {
            const candidates = [
              ...pairRows.filter((row) => row.key === key && row.effectiveAt <= at),
              ...prepared.filter((row) => row.key === key && row.effectiveAt <= at),
            ].sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
            values[key] = candidates[0]?.value ?? paramDef(key)?.default;
          }
          if (checkParamPairs(values).length)
            invalid(
              `items.${prepared.find((item) => pairKeys.includes(item.key))?.index ?? 0}.value`,
              "起始时刻须早于结束时刻",
            );
        }
      }
      for (const item of prepared) {
        const id = uuidv7();
        await tx.$executeRaw`INSERT INTO param_value(id,key,value,effective_at,reason,created_by_staff_id,created_at) VALUES(${id}::uuid,${item.key},${JSON.stringify(item.value)}::jsonb,${item.effectiveAt},${input.reason ?? null},${staffId}::uuid,${now})`;
        await auditConfig(
          tx,
          ctx,
          "param",
          "sys.param.save",
          { type: "param_value", id: item.key },
          byKey.get(item.key) ?? null,
          { key: item.key, value: item.value, effectiveAt: item.effectiveAt },
          input.reason,
          { effectiveAt: item.effectiveAt.toISOString() },
        );
      }
      return list(tx, { keys: input.items.map((item) => item.key) });
    },
    async withdraw(tx: Tx, ctx: ConfigActor, id: string, reason?: string) {
      requireConfigActor(ctx, "sys.param.edit");
      const first = await tx.paramValue.findUnique({ where: { id } });
      if (!first) throw new AppError("NOT_FOUND");
      await lockKeys(tx, [first.key]);
      const row = await tx.paramValue.findUniqueOrThrow({ where: { id } });
      if (row.cancelledAt !== null) throw new AppError("STATE_NOT_ALLOWED");
      const now = deps.clock.now();
      const changed = await tx.paramValue.updateMany({
        where: { id, cancelledAt: null, effectiveAt: { gt: new Date(now.getTime() + 600000) } },
        data: { cancelledAt: now },
      });
      if (changed.count !== 1)
        throw new AppError("PARAM_WITHDRAW_TOO_LATE", {
          details: { effectiveAt: row.effectiveAt.toISOString() },
        });
      await auditConfig(
        tx,
        ctx,
        "param",
        "sys.param.withdraw",
        { type: "param_value", id },
        row,
        { ...row, cancelledAt: now },
        reason,
      );
      return (await list(tx, { keys: [row.key] })).items[0]!;
    },
  };
}
