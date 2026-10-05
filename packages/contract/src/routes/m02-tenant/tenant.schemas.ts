// 商家端：主体、门店与成员 · 主体与门店的结构（docs/api/m02-tenant.md 第 2.1–2.3、2.7、3.2、3.7 节；W1-03）。
// EntityBrief 以本文件为唯一定义（约定 C87），m01 的 GET /m/me 引用它。成员、邀请、下载页授权的结构随 M2。
import {
  DictRefSchema,
  IdSchema,
  InstantSchema,
  DateSchema,
  openEnum,
  orNull,
} from "../../common/index.js";
import {
  MERCHANT_ROLE,
  QUALIFICATION_STATUS,
  STORE_ARCHIVE_REASON,
  STORE_LIFECYCLE,
} from "../../enums/index.js";
import { z } from "../../zod.js";

const verificationStatus = () => openEnum(QUALIFICATION_STATUS.values);

/** 额度引导的文案依据：套餐生效 / 未开通或已过期 */
export const QUOTA_LIMIT_REASONS = ["plan", "inactive"] as const;
/** 门店卡的可执行动作（约定 C16）；守卫的最终判断在服务端 */
export const STORE_ACTIONS = ["archive", "delete", "restore"] as const;

// ---------- 2.2 主体 ----------

export const EntityBriefSchema = z
  .strictObject({
    entityId: IdSchema,
    name: orNull(z.string()),
    verificationStatus: verificationStatus(),
  })
  .openapi("EntityBrief");
export type EntityBrief = z.infer<typeof EntityBriefSchema>;

export const EntityQuotaCardSchema = z
  .object({
    entityId: IdSchema,
    name: orNull(z.string()),
    verificationStatus: verificationStatus(),
    subscription: orNull(
      z.object({ planName: z.string(), endDate: DateSchema, isActive: z.boolean() }),
    ),
    storesUsed: z.int().min(0),
    storeLimit: z.int().min(0),
    seatsUsed: z.int().min(0),
    /** null = 不限 */
    memberLimit: orNull(z.int().min(0)),
    pendingInvitationCount: z.int().min(0),
    storesOver: z.int().min(0),
    seatsOver: z.int().min(0),
    limitReason: z.enum(QUOTA_LIMIT_REASONS),
    canAddStore: z.boolean(),
  })
  .openapi("EntityQuotaCard");
export type EntityQuotaCard = z.infer<typeof EntityQuotaCardSchema>;

// ---------- 2.3 门店卡 ----------

export const MemberPreviewSchema = z
  .object({ displayName: orNull(z.string()), role: openEnum(MERCHANT_ROLE.values) })
  .openapi("MemberPreview");

const storeCardForClerkShape = {
  storeId: IdSchema,
  name: orNull(z.string()),
  isPrimary: z.boolean(),
  lifecycle: openEnum(STORE_LIFECYCLE.values),
  isLastSelected: z.boolean(),
  city: orNull(DictRefSchema),
  category: orNull(DictRefSchema),
  qualificationStatus: verificationStatus(),
  assetCount: z.int().min(0),
  clerkCount: z.int().min(0),
  todoCount: z.int().min(0),
};

/** 店员视图：不带上线中与交付中计数、审核时间、完整度、待接受邀请数、头像组；actions 恒为空 */
export const StoreCardForClerkSchema = z
  .strictObject({ ...storeCardForClerkShape, actions: z.array(z.enum(STORE_ACTIONS)).max(0) })
  .openapi("StoreCardForClerk");
export type StoreCardForClerk = z.infer<typeof StoreCardForClerkSchema>;

export const StoreCardSchema = z
  .object({
    ...storeCardForClerkShape,
    archiveReason: orNull(openEnum(STORE_ARCHIVE_REASON.values)),
    archivedAt: orNull(InstantSchema),
    verifiedAt: orNull(InstantSchema),
    submittedAt: orNull(InstantSchema),
    expectedDecisionAt: orNull(InstantSchema),
    completenessPct: z.int().min(0).max(100),
    liveCount: z.int().min(0),
    deliveringCount: z.int().min(0),
    pendingInvitationCount: z.int().min(0),
    memberPreview: z.array(MemberPreviewSchema).max(4),
    actions: z.array(z.enum(STORE_ACTIONS)),
  })
  .openapi("StoreCard");
export type StoreCard = z.infer<typeof StoreCardSchema>;

/** m.store.list：不分页，按 viewerRole 判别（约定 C55）；none = 账号没有有效成员关系 */
export const StoreListSchema = z.discriminatedUnion("viewerRole", [
  z.object({
    viewerRole: z.literal("owner"),
    entity: EntityQuotaCardSchema,
    items: z.array(StoreCardSchema),
  }),
  z.object({
    viewerRole: z.literal("clerk"),
    entity: EntityBriefSchema,
    items: z.array(StoreCardForClerkSchema),
  }),
  z.object({
    viewerRole: z.literal("none"),
    entity: z.null(),
    // 恒为空数组：元素类型借店员的门店卡（OpenAPI 写不出“没有元素”的数组）
    items: z.array(StoreCardForClerkSchema).max(0),
  }),
]);
export type StoreList = z.infer<typeof StoreListSchema>;

// ---------- 2.7 成员关系结果 ----------

export const MembershipResultSchema = z
  .object({
    entityId: IdSchema,
    memberId: IdSchema,
    role: openEnum(MERCHANT_ROLE.values),
    /** 建议进入的门店：新建主体为首家门店；已有主体取上次选择的门店，没有则取首家门店 */
    storeId: IdSchema,
    isNew: z.boolean(),
    abandonedEntityId: orNull(IdSchema),
  })
  .openapi("MembershipResult");
export type MembershipResult = z.infer<typeof MembershipResultSchema>;

/** m.entity.create 的请求体：空对象 */
export const EntityCreateBodySchema = z.strictObject({});

// ---------- 3.7 记住当前门店 ----------

export const CurrentStoreBodySchema = z.object({ storeId: IdSchema });
export const CurrentStoreSchema = z.object({ storeId: IdSchema });
