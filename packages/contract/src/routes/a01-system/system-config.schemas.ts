import { z } from "../../zod.js";
import { IdSchema, InstantSchema, DateSchema, orNull } from "../../common/index.js";
import { CHECKLIST_TEMPLATE_CODE } from "../../enums/index.js";
import { zodEnum } from "../../enums/zod.js";
import { ChecklistItemsSchema, FlagRuleSchema } from "../../config/schemas.js";
import { StaffBriefSchema } from "./structures.js";
// JSON 的运行时校验保留；命名的 OpenAPI 3.1 类型阻止生成器展开 z.json 的递归 lazy。
const ConfigJsonSchema = z.json().openapi("SystemConfigJsonValue", {
  type: ["object", "array", "string", "number", "boolean", "null"],
});
const ApiFlagRulesSchema = z.array(FlagRuleSchema.extend({ value: ConfigJsonSchema })).max(50);
const csv = z
  .string()
  .min(1)
  .transform((v) => [...new Set(v.split(","))]);
export const DictTypeListSchema = z.object({
  items: z.array(
    z.object({
      typeKey: z.string(),
      name: z.string(),
      structure: z.enum(["flat", "tree"]),
      maxDepth: z.int(),
      isSystem: z.boolean(),
      canCreate: z.boolean(),
      disablePolicy: z.enum(["free", "block_if_referenced", "never"]),
      isMerchantVisible: z.boolean(),
      versionNo: z.int(),
      itemCount: z.int(),
      enabledCount: z.int(),
      levelCounts: z.array(z.int()),
    }),
  ),
});
export const DictItemCreateBodySchema = z.strictObject({
  typeKey: z.string().min(1),
  parentCode: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(20),
  description: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().min(1).max(20)).max(20).optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export const DictItemUpdateBodySchema = z.strictObject({
  lockVersion: z.int().min(0),
  name: z.string().min(1).max(20).optional(),
  description: z.string().max(40).nullable().optional(),
  isEnabled: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(20)).max(20).optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
  position: z.int().min(0).optional(),
});
export const ParamListQuerySchema = z.object({ group: csv.optional(), keys: csv.optional() });
const rev = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .nullable();
export const ParamReplaceBodySchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          key: z.string().min(1),
          value: ConfigJsonSchema,
          expectedRev: rev,
          effectiveAt: InstantSchema.optional(),
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().max(100).optional(),
  })
  .refine((v) => new Set(v.items.map((i) => i.key)).size === v.items.length, {
    path: ["items"],
    message: "参数键不能重复",
  });
export const ParamWithdrawBodySchema = z.strictObject({ reason: z.string().max(100).optional() });
const PendingParamSchema = z.object({
  paramValueId: IdSchema,
  value: z.unknown(),
  rev: z.string(),
  effectiveAt: InstantSchema,
  reason: z.string().nullable(),
  savedBy: orNull(StaffBriefSchema),
  savedAt: InstantSchema,
  canWithdraw: z.boolean(),
});
export const ParamItemSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  type: z.enum(["int", "bp", "int_list", "time_hm", "bool", "enum", "text", "json", "sla_policy"]),
  unit: z.string().nullable(),
  range: z.record(z.string(), z.unknown()).nullable(),
  defaultValue: z.unknown(),
  value: z.unknown(),
  rev,
  latestRev: rev,
  effectiveAt: orNull(InstantSchema),
  savedBy: orNull(StaffBriefSchema),
  savedAt: orNull(InstantSchema),
  pending: z.array(PendingParamSchema),
  snapshotOn: z.enum(["create", "read"]),
});
export const ParamListSchema = z.object({
  items: z.array(ParamItemSchema),
  groups: z.array(z.object({ group: z.string(), title: z.string() })),
  lastSaved: z.object({ at: InstantSchema, staff: StaffBriefSchema }).nullable(),
});
export const FeatureFlagViewSchema = z.object({
  flagKey: z.string(),
  valueType: z.enum(["bool", "enum", "json"]),
  defaultValue: z.unknown(),
  rules: ApiFlagRulesSchema,
  exposedTo: z.enum(["client", "server"]),
  description: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  updatedAt: InstantSchema,
  updatedBy: orNull(StaffBriefSchema),
  lockVersion: z.int().min(0),
});
export const FeatureFlagListSchema = z.object({ items: z.array(FeatureFlagViewSchema) });
export const FeatureFlagUpdateBodySchema = z.strictObject({
  lockVersion: z.int().min(0),
  defaultValue: z.unknown().optional(),
  rules: ApiFlagRulesSchema.max(20)
    .refine(
      (rules) => rules.every((rule) => (rule.when.entityIds?.length ?? 0) <= 50),
      "主体白名单不超过50个",
    )
    .optional(),
  description: z.string().max(100).optional(),
});
export const CalendarListQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  includeAllDays: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export const CalendarExceptionSchema = z.strictObject({
  date: DateSchema,
  kind: z.enum(["holiday", "adjusted_workday"]),
  note: z.string().min(1).max(20),
});
export const CalendarImportBodySchema = z.strictObject({
  year: z.int().min(2024).max(2100),
  days: z.array(CalendarExceptionSchema).max(80).optional(),
  source: z.string().min(1).max(100).optional(),
});
export const CalendarYearSchema = z.object({
  items: z.array(CalendarExceptionSchema),
  year: z.int(),
  calendarVersion: z.int(),
  holidays: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["holiday", "adjusted_workday"]),
      from: DateSchema,
      to: DateSchema,
      days: z.int(),
    }),
  ),
  days: z
    .array(
      z.object({
        date: DateSchema,
        kind: z.enum(["weekday", "weekend", "holiday", "adjusted_workday"]),
        isWorkday: z.boolean(),
      }),
    )
    .nullable(),
  importedAt: orNull(InstantSchema),
  workHours: z.object({ start: z.string(), end: z.string() }),
});
export const CalendarImportResultSchema = z.object({
  year: z.int(),
  isChanged: z.boolean(),
  changedDays: z.array(DateSchema),
  calendarVersion: z.int(),
  holidayCount: z.int(),
  adjustedWorkdayCount: z.int(),
  source: z.string().nullable(),
  calendar: CalendarYearSchema,
});
export const ChecklistTemplateCreateBodySchema = z.strictObject({
  code: zodEnum(CHECKLIST_TEMPLATE_CODE),
  items: ChecklistItemsSchema.min(1)
    .max(50)
    .refine(
      (items) =>
        items.every((item) => [...item.label].length <= 60 && [...(item.hint ?? "")].length <= 100),
      "清单名称不超过60字、提示不超过100字",
    ),
});
