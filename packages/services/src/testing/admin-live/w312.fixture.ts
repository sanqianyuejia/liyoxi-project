import { z } from "zod";
import { addDays, calendarDate } from "@liyoxi/shared/time";
import { buildStaffContext, normalizeRoleConfig } from "../../authz/index.js";
import { createIdentityContext, uuidv7 } from "../../kernel/index.js";
import type { Runtime } from "../../runtime.js";
import type { AdminLiveFixture } from "./context.js";
import { assertDeliveryLiveEnvironment } from "./delivery-known-media.js";
import { OutputBatchLiveInputSchema } from "./w302.fixture.js";

/** Scope only. No ready files, masters, checks, listed state or terminal jobs are seeded. */
export const ContentAdminLiveScopeSchema = z.strictObject({
  runId: z.string().regex(/^[a-f0-9]{16}$/),
  name: z.string(),
  prefix: z.string(),
  startedAt: z.iso.datetime(),
  uploaderId: z.uuid(),
  dramaIds: z
    .array(z.uuid())
    .min(1)
    .max(16)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ContentAdminLiveScope = z.infer<typeof ContentAdminLiveScopeSchema>;
const contentManifestSchema = z.strictObject({
  scope: ContentAdminLiveScopeSchema,
  dramaId: z.uuid(),
  title: z.string(),
  query: z.string(),
  expectedDraftCount: z.literal(13),
});
/** Independent optional fixture: the original W302 schema remains strict. */
export function parseOutputBatchLiveManifest(raw: unknown) {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "w312" in raw) {
    const { w312, ...original } = raw;
    return {
      inputs: OutputBatchLiveInputSchema.parse(original),
      w312: contentManifestSchema.parse(w312).scope,
    };
  }
  return { inputs: OutputBatchLiveInputSchema.parse(raw), w312: undefined };
}
export function assertContentAdminLiveScope(
  runtime: { env: Pick<Runtime["env"], "APP_ENV" | "DATABASE_URL" | "REDIS_URL"> },
  raw: unknown,
) {
  const scope = ContentAdminLiveScopeSchema.parse(raw);
  const owned = assertDeliveryLiveEnvironment(runtime.env);
  if (scope.runId !== owned.runId || scope.name !== owned.name || scope.prefix !== owned.prefix)
    throw new Error("W312 content scope differs from the exact owned database");
  return scope;
}
export async function assertContentAdminLiveTargets(runtime: Runtime, raw: unknown) {
  const scope = assertContentAdminLiveScope(runtime, raw);
  await runtime.tx.run(async (tx) => {
    const staff = await tx.staff.findUnique({
      where: { id: scope.uploaderId },
      select: { status: true, staffRoleKey: true },
    });
    const rows = await tx.drama.findMany({
      where: { id: { in: scope.dramaIds } },
      select: { title: true, createdByStaffId: true, createdAt: true },
    });
    if (
      staff?.status !== "active" ||
      staff.staffRoleKey !== "super_admin" ||
      rows.length !== scope.dramaIds.length ||
      rows.some(
        (row) =>
          row.createdByStaffId !== scope.uploaderId ||
          row.createdAt < new Date(scope.startedAt) ||
          !row.title.startsWith(`页面${scope.runId.slice(0, 6)}-`),
      )
    )
      throw new Error("W312 targets do not belong to this exact fixture");
  });
  return scope;
}
/** Only jobs for these drama batches/playables and explicitly observed registration IDs. */
export async function findContentAdminLiveJobIds(
  runtime: Runtime,
  raw: unknown,
  registeredIds: readonly string[],
) {
  const scope = await assertContentAdminLiveTargets(runtime, raw);
  if (registeredIds.length > 100 || !registeredIds.every((id) => z.uuid().safeParse(id).success))
    throw new Error("W312 registered file set is not bounded");
  return runtime.tx.run(async (tx) => {
    const batches = await tx.uploadBatch.findMany({
      where: {
        purpose: "drama_master",
        targetId: { in: scope.dramaIds },
        createdByStaffId: scope.uploaderId,
        createdAt: { gte: new Date(scope.startedAt) },
        state: { in: ["matching", "uploading", "verifying", "ready"] },
      },
      select: { id: true },
    });
    const files = await tx.fileObject.findMany({
      where: {
        uploadActorType: "staff",
        uploadActorId: scope.uploaderId,
        uploadClient: "admin",
        scopeType: "platform",
        createdAt: { gte: new Date(scope.startedAt) },
        OR: [
          {
            id: { in: [...registeredIds] },
            category: { in: ["poster", "banner", "trailer_src", "drama_license_doc"] },
          },
          { uploadBatchId: { in: batches.map((row) => row.id) }, category: "drama_master" },
        ],
      },
      select: { id: true },
    });
    const assets = await tx.playableAsset.findMany({
      where: {
        ownerType: "drama",
        ownerId: { in: scope.dramaIds },
        kind: "trailer",
        sourceFileId: { in: files.map((row) => row.id) },
      },
      select: { id: true },
    });
    const jobs = await tx.mediaJob.findMany({
      where: {
        subjectType: "file_object",
        subjectId: { in: files.map((row) => row.id) },
        state: { in: ["queued", "running", "submitting", "submitted"] },
        nextRunAt: { lte: runtime.clock.now() },
        OR: [
          { parentType: null, parentId: null },
          { parentType: "upload_batch", parentId: { in: batches.map((row) => row.id) } },
          { parentType: "playable_asset", parentId: { in: assets.map((row) => row.id) } },
        ],
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true },
    });
    return jobs.map((row) => row.id);
  });
}
const fixture: AdminLiveFixture = async ({ runtime }) => {
  const owned = assertDeliveryLiveEnvironment(runtime.env);
  const startedAt = runtime.clock.now().toISOString();
  const admin = await runtime.tx.run((tx) =>
    tx.staff.findFirstOrThrow({
      where: { staffRoleKey: "super_admin", status: "active" },
      include: { staffRole: true },
    }),
  );
  const staff = buildStaffContext({
    staff: {
      id: admin.id,
      roleKey: "super_admin",
      isLead: admin.isLead,
      staffGroupId: admin.staffGroupId,
    },
    role: normalizeRoleConfig("super_admin", admin.staffRole),
    groupStaffIds: [],
    stepUpAt: runtime.clock.now(),
  });
  const actor = {
    staff,
    identity: createIdentityContext({
      actor: { type: "staff", id: admin.id, client: "admin" },
      requestId: uuidv7(),
      ip: "127.0.0.1",
      userAgent: "lyxtest W312 content fixture",
    }),
  };
  // Public dictionary write; no ready content or media state is seeded.
  await runtime.configAdmin.createDictItem(actor, {
    typeKey: "genre",
    name: `页面题材${owned.runId.slice(0, 6)}`,
  });
  const prefix = `页面${owned.runId.slice(0, 6)}-`;
  const main = await runtime.contentAdmin.create(actor, { title: `${prefix}内容` });
  const basic = await runtime.contentAdmin.basic(actor, main.dramaId, {
    lockVersion: main.lockVersion,
    totalEpisodes: 2,
    episodeDurationSec: 20,
    dramaClass: "class_3",
    synopsis: "虚构内容页面验收素材，不包含真实人物与权利文件。",
    isAiGenerated: false,
  });
  const commercial = await runtime.contentAdmin.commercial(actor, main.dramaId, {
    lockVersion: basic.lockVersion,
    heatTier: "A",
    industryCodes: [],
    allowedPlacements: ["opening", "ending"],
  });
  await runtime.contentAdmin.replace(actor, main.dramaId, {
    lockVersion: commercial.copyright.lockVersion,
    source: "own",
    platforms: ["douyin"],
    territory: "中国大陆",
    hasNetworkRight: true,
    canSublicense: true,
    canEditEmbed: true,
    canAdapt: true,
    licenseStartDate: calendarDate(runtime.clock.now()),
    licenseEndDate: addDays(calendarDate(runtime.clock.now()), 365),
    proofFileIds: [],
  });
  const dramaIds = [main.dramaId];
  for (let i = 1; i <= 12; i++)
    dramaIds.push(
      (await runtime.contentAdmin.create(actor, { title: `${prefix}草稿${i}` })).dramaId,
    );
  return {
    scope: { ...owned, startedAt, uploaderId: admin.id, dramaIds },
    dramaId: main.dramaId,
    title: `${prefix}内容`,
    query: prefix,
    expectedDraftCount: dramaIds.length,
  };
};
export default fixture;
