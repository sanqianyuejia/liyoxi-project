import type { Prisma } from "@liyoxi/db";
import { z } from "@liyoxi/contract";
import { calendarDate, addDays, dayRange } from "@liyoxi/shared/time";
import { visible, orderable, stopDate, selectPermits } from "@liyoxi/shared/catalog";
import { AppError, uuidv7, lockRows, bumpLockVersion } from "../kernel/index.js";
import type { Tx, Clock, Assembly } from "../kernel/index.js";
import type { Flow } from "../flow/index.js";
import type { EmitContext } from "../events/index.js";
import type { Media } from "../media/index.js";
import { record } from "../audit/index.js";
import { paramsAt } from "../config/index.js";
import { DramaPricePort } from "./ports.js";
import { assertListing, dateOf, listingChecks, orderableFacts, permitsOf } from "./checks.js";
import { basicInput, commercialInput, copyrightInput, permitInput, rolesInput } from "./inputs.js";
import type {
  BasicInput,
  CommercialInput,
  CopyrightInput,
  PermitInput,
  RolesInput,
} from "./inputs.js";

export interface ContentDeps {
  readonly clock: Clock;
  readonly flow: Flow;
  readonly media: Pick<Media, "link" | "release">;
  readonly assembly: Pick<Assembly, "port">;
}
const json = (value: unknown) => value as Prisma.InputJsonValue;
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError("VALIDATION_FAILED", {
      details: {
        fieldErrors: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  return result.data;
};
const metaOf = (ctx: EmitContext) => ({
  requestId: ctx.requestId,
  ip: ctx.ip,
  userAgent: ctx.userAgent,
  authMethod: null,
  sessionId: null,
  ...(ctx.actor.client === "cli" ? { jobName: "cli.demo_seed" } : {}),
});
const staff = (ctx: EmitContext): string => {
  if (ctx.actor.type !== "staff" || !ctx.actor.id) throw new AppError("PERMISSION_DENIED");
  return ctx.actor.id;
};
async function audit(
  tx: Tx,
  ctx: EmitContext,
  id: string,
  action: `${string}.${string}.${string}`,
  summary: string,
  before: object,
  after: object,
  fields: readonly string[],
) {
  await record(
    tx,
    ctx.actor,
    {
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      authMethod: null,
      sessionId: null,
      ...(ctx.actor.client === "cli" ? { jobName: "cli.demo_seed" } : {}),
    },
    {
      stream: "activity",
      category: "flow",
      action,
      summary,
      target: { type: "drama", id },
      before,
      after,
      fields,
    },
  );
}
async function editable(tx: Tx, id: string) {
  await lockRows(tx, "drama", [id]);
  const row = await tx.drama.findUnique({ where: { id } });
  if (!row) throw new AppError("NOT_FOUND");
  if (row.archivedAt) throw new AppError("DRAMA_ARCHIVED");
  // M1 写侧只用于从未上架的草稿；已上架保存校验随 M3 a04 一起接入。
  if (row.status !== "draft") throw new AppError("STATE_NOT_ALLOWED");
  return row;
}
async function dicts(
  tx: Tx,
  type: string,
  selected: readonly string[] | undefined,
  previous: readonly string[],
  primary = false,
) {
  if (!selected) return;
  for (const code of selected.filter((code) => !previous.includes(code))) {
    await tx.$queryRaw`SELECT id FROM dict_item WHERE dict_type_key=${type} AND code=${code} ORDER BY id FOR SHARE`;
    const row = await tx.dictItem.findUnique({
      where: { dictTypeKey_code: { dictTypeKey: type, code } },
    });
    const ext = row?.ext as { open?: boolean } | undefined;
    if (!row?.isEnabled || (primary && (row.parentCode !== null || ext?.open !== true)))
      throw new AppError("DICT_ITEM_DISABLED", { details: { dictTypeKey: type, code } });
  }
}
export function createContent(deps: ContentDeps) {
  const prices = deps.assembly.port(DramaPricePort);
  const checks = (tx: Tx, id: string, at = deps.clock.now()) => listingChecks(tx, id, at, prices);
  const link = async (
    tx: Tx,
    ids: readonly string[],
    refType: string,
    refId: string,
    role: string,
  ) => {
    await lockRows(tx, "file_object", ids);
    for (const fileId of ids)
      await deps.media.link(tx, { fileId, refType, refId, role, entityId: null, storeId: null });
  };
  return {
    listingChecks: checks,
    async createDraft(tx: Tx, ctx: EmitContext, input: { title: string }) {
      const title = parse(
        z
          .string()
          .refine(
            (value) => [...value].length >= 1 && [...value].length <= 20 && value.trim().length > 0,
          ),
        input.title,
      );
      const id = uuidv7(),
        now = deps.clock.now(),
        actor = staff(ctx);
      await tx.drama.create({
        data: {
          id,
          title,
          status: "draft",
          statusChangedAt: now,
          createdByStaffId: actor,
          updatedByStaffId: actor,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.dramaCopyright.create({ data: { dramaId: id, createdAt: now, updatedAt: now } });
      await deps.flow.transition(tx, ctx, {
        machine: "drama",
        stateField: "status",
        id,
        event: "drama.create",
        created: true,
        meta: metaOf(ctx),
        emit: { type: "drama.created", payload: { v: 1, dramaId: id } },
      });
      return tx.drama.findUniqueOrThrow({ where: { id } });
    },
    async saveBasic(tx: Tx, ctx: EmitContext, id: string, raw: BasicInput) {
      const input = parse(basicInput, raw),
        before = await editable(tx, id),
        actor = staff(ctx),
        now = deps.clock.now();
      await dicts(tx, "genre", input.genreCodes, before.genreCodes);
      await dicts(tx, "selling_tag", input.sellingTagCodes, before.sellingTagCodes);
      if (
        input.dramaClass &&
        input.dramaClass !== "class_3" &&
        before.allowedPlacements.some((slot) => !["opening", "ending"].includes(slot))
      )
        throw new AppError("PLACEMENT_NOT_OPEN");
      await bumpLockVersion(tx, { table: "drama", id, expected: input.lockVersion });
      const { lockVersion: _version, ...data } = input;
      const after = await tx.drama.update({
        where: { id },
        data: { ...data, updatedByStaffId: actor, updatedAt: now },
      });
      if (input.totalEpisodes !== undefined) {
        const n = input.totalEpisodes ?? 0;
        await tx.dramaEpisode.deleteMany({ where: { dramaId: id, episodeNo: { gt: n } } });
        const current = new Set(
          (
            await tx.dramaEpisode.findMany({ where: { dramaId: id }, select: { episodeNo: true } })
          ).map((row) => row.episodeNo),
        );
        const missing = Array.from({ length: n }, (_, index) => index + 1).filter(
          (no) => !current.has(no),
        );
        if (missing.length)
          await tx.dramaEpisode.createMany({
            data: missing.map((episodeNo) => ({
              id: uuidv7(),
              dramaId: id,
              episodeNo,
              createdAt: now,
              updatedAt: now,
            })),
          });
      }
      if (input.posterFileId && input.posterFileId !== before.posterFileId)
        await link(tx, [input.posterFileId], "drama", id, "poster");
      await audit(
        tx,
        ctx,
        id,
        "content.drama.basic_update",
        "更新短剧基础信息",
        before,
        after,
        Object.keys(data),
      );
      return after;
    },
    async saveCommercial(tx: Tx, ctx: EmitContext, id: string, raw: CommercialInput) {
      const input = parse(commercialInput, raw),
        before = await editable(tx, id),
        actor = staff(ctx),
        now = deps.clock.now();
      await dicts(tx, "industry", input.industryCodes, before.industryCodes, true);
      if (input.allowedPlacements) {
        const params = await paramsAt(tx, ["content.placement.open_slots"], now);
        if (
          input.allowedPlacements.some(
            (slot) =>
              !params["content.placement.open_slots"].includes(slot) ||
              (before.dramaClass !== "class_3" && !["opening", "ending"].includes(slot)),
          )
        )
          throw new AppError("PLACEMENT_NOT_OPEN");
      }
      await bumpLockVersion(tx, { table: "drama", id, expected: input.lockVersion });
      const { lockVersion: _version, ...data } = input;
      const after = await tx.drama.update({
        where: { id },
        data: { ...data, updatedByStaffId: actor, updatedAt: now },
      });
      await audit(
        tx,
        ctx,
        id,
        "content.drama.commercial_update",
        "更新短剧商业信息",
        before,
        after,
        Object.keys(data),
      );
      return after;
    },
    async saveRoles(tx: Tx, ctx: EmitContext, id: string, raw: RolesInput) {
      const input = parse(rolesInput, raw),
        before = await editable(tx, id);
      staff(ctx);
      await bumpLockVersion(tx, { table: "drama", id, expected: input.lockVersion });
      const after = await tx.drama.update({
        where: { id },
        data: {
          roles: json(input.roles.map((row) => ({ ...row, actor: row.actor ?? null }))),
          updatedByStaffId: staff(ctx),
          updatedAt: deps.clock.now(),
        },
      });
      await audit(tx, ctx, id, "content.drama.roles_update", "更新角色介绍", before, after, [
        "roles",
      ]);
      return after;
    },
    async saveCopyrightDraft(tx: Tx, ctx: EmitContext, id: string, raw: CopyrightInput) {
      const input = parse(copyrightInput, raw),
        drama = await editable(tx, id);
      staff(ctx);
      if (drama.firstListedAt) throw new AppError("COPYRIGHT_REVISION_REQUIRED");
      const before = await tx.dramaCopyright.findUniqueOrThrow({ where: { dramaId: id } }),
        now = deps.clock.now();
      await bumpLockVersion(tx, {
        table: "drama_copyright",
        id,
        expected: input.lockVersion,
        key: { column: "drama_id", type: "uuid" },
      });
      const { lockVersion: _version, licenseStartDate, licenseEndDate, ...data } = input;
      const after = await tx.dramaCopyright.update({
        where: { dramaId: id },
        data: {
          ...data,
          licenseStartDate: licenseStartDate ? new Date(`${licenseStartDate}T00:00:00Z`) : null,
          licenseEndDate: licenseEndDate ? new Date(`${licenseEndDate}T00:00:00Z`) : null,
          updatedAt: now,
        },
      });
      const newIds = input.proofFileIds.filter((fileId) => !before.proofFileIds.includes(fileId)),
        removed = before.proofFileIds.filter((fileId) => !input.proofFileIds.includes(fileId));
      await lockRows(tx, "file_object", [...newIds, ...removed]);
      await link(tx, newIds, "drama_copyright", id, "proof");
      for (const fileId of removed)
        await deps.media.release(tx, {
          fileId,
          refType: "drama_copyright",
          refId: id,
          role: "proof",
          entityId: null,
          storeId: null,
          keepUntil: dayRange(addDays(calendarDate(now), 30)).start,
        });
      await audit(
        tx,
        ctx,
        id,
        "content.drama.copyright_update",
        "填写版权信息并上传授权合同",
        before,
        after,
        Object.keys(data).concat("licenseStartDate", "licenseEndDate"),
      );
      return after;
    },
    async createPermit(tx: Tx, ctx: EmitContext, id: string, raw: PermitInput) {
      const input = parse(permitInput, raw),
        before = await editable(tx, id),
        now = deps.clock.now();
      await tx.drama.update({
        where: { id },
        data: { lockVersion: { increment: 1 }, updatedByStaffId: staff(ctx), updatedAt: now },
      });
      const permit = await tx.dramaPermit.create({
        data: {
          id: uuidv7(),
          dramaId: id,
          platform: input.platform,
          permitKind: input.permitKind,
          status: "active",
          permitNo: input.permitNo,
          scanFileIds: input.scanFileIds,
          note: input.note ?? null,
          createdByStaffId: staff(ctx),
          createdAt: now,
          updatedAt: now,
        },
      });
      await link(tx, input.scanFileIds, "drama_permit", permit.id, "scan");
      await audit(
        tx,
        ctx,
        id,
        "content.drama.permit_create",
        "填写短剧许可信息",
        before,
        { ...before, permit },
        ["permit"],
      );
      return permit;
    },
    async list(tx: Tx, ctx: EmitContext, id: string) {
      const before = await editable(tx, id),
        now = deps.clock.now();
      staff(ctx);
      const result = await checks(tx, id, now);
      assertListing(result);
      await deps.flow.transition(tx, ctx, {
        machine: "drama",
        stateField: "status",
        id,
        event: "drama.list",
        meta: metaOf(ctx),
        set: { first_listed_at: now, listed_at: now, updated_by_staff_id: staff(ctx) },
        payload: {
          passed: result.isShelvable,
          total: result.total,
          items: result.items.map(({ code, severity, isOk }) => ({ code, severity, ok: isOk })),
        },
        args: { prices, media: deps.media },
        emit: { type: "drama.listed", payload: { v: 1, dramaId: id, isRelist: false } },
      });
      return tx.drama.findUniqueOrThrow({ where: { id: before.id } });
    },
    async getDramaCards(tx: Tx, ids: readonly string[], at = deps.clock.now()) {
      const rows = await tx.drama.findMany({
        where: { id: { in: [...ids] } },
        include: { dramaCopyrights: true },
      });
      const priceMap = await prices.priceAt(tx, ids, at);
      return rows.map((row) => ({
        ...row,
        listPricePoints:
          typeof priceMap.get(row.id) === "object"
            ? (priceMap.get(row.id) as { points: number }).points
            : null,
        licenseEndDate: dateOf(row.dramaCopyrights[0]?.licenseEndDate ?? null),
        usableUntilDate: dateOf(row.dramaCopyrights[0]?.licenseEndDate ?? null),
      }));
    },
    async visibleCatalog(tx: Tx, at = deps.clock.now()) {
      const ids = (
        await tx.drama.findMany({
          where: { status: "listed", archivedAt: null },
          select: { id: true },
        })
      ).map((row) => row.id);
      const rows = await this.getDramaCards(tx, ids, at),
        months = await prices.minLicenseMonths(tx, at);
      return rows.filter((row) =>
        visible(
          {
            status: row.status,
            archivedAt: row.archivedAt,
            licenseEndDate: row.licenseEndDate,
            minLicenseMonths: months,
          },
          calendarDate(at),
        ),
      );
    },
    async getOrderability(tx: Tx, ids: readonly string[], today = calendarDate(deps.clock.now())) {
      const rows = await this.getDramaCards(tx, ids),
        months = await prices.minLicenseMonths(tx, deps.clock.now());
      return new Map(
        rows.map((row) => [
          row.id,
          {
            dramaId: row.id,
            orderable: visible(
              {
                status: row.status,
                archivedAt: row.archivedAt,
                licenseEndDate: row.licenseEndDate,
                minLicenseMonths: months,
              },
              today,
            ),
            reason:
              row.status !== "listed" || row.archivedAt
                ? ("not_listed" as const)
                : row.licenseEndDate === null || today >= stopDate(row.licenseEndDate, months)
                  ? ("stopped" as const)
                  : null,
            stopDate: row.licenseEndDate ? stopDate(row.licenseEndDate, months) : null,
            licenseEndDate: row.licenseEndDate,
          },
        ]),
      );
    },
    async assertOrderable(
      tx: Tx,
      id: string,
      platforms: readonly string[],
      today = calendarDate(deps.clock.now()),
    ) {
      const facts = await orderableFacts(tx, id),
        months = await prices.minLicenseMonths(tx, deps.clock.now()),
        params = await paramsAt(tx, ["content.permit.platform_check"], deps.clock.now());
      const { drama: d, copyright: c, permits } = facts,
        licenseEndDate = dateOf(c?.licenseEndDate ?? null);
      if (
        !orderable(
          {
            status: d.status,
            archivedAt: d.archivedAt,
            licenseEndDate,
            minLicenseMonths: months,
            platforms: c?.platforms ?? [],
            permits: permitsOf(permits),
            dramaClass: d.dramaClass,
            permitCheck: params["content.permit.platform_check"],
          },
          platforms,
          today,
        )
      )
        throw new AppError("DRAMA_NOT_ORDERABLE", {
          details: {
            dramaId: id,
            reason:
              d.status !== "listed" || d.archivedAt
                ? "not_listed"
                : !licenseEndDate || today >= stopDate(licenseEndDate, months)
                  ? "stopped"
                  : platforms.some((platform) => !c?.platforms.includes(platform))
                    ? "platform_not_licensed"
                    : "permit_missing",
          },
        });
      const selected = [
        ...new Map(
          platforms
            .flatMap((platform) => selectPermits(permitsOf(permits), platform))
            .map((row) => [`${row.platform}/${row.kind}`, row]),
        ).values(),
      ];
      return {
        dramaId: id,
        title: d.title,
        totalEpisodes: d.totalEpisodes!,
        dramaClass: d.dramaClass,
        genreCodes: d.genreCodes,
        permits: selected.map(({ platform, kind, number }) => ({ platform, kind, number })),
        licenseEndDate: licenseEndDate!,
        posterFileId: d.posterFileId,
        allowedPlacements: d.allowedPlacements,
        isAiGenerated: d.isAiGenerated,
      };
    },
  };
}
export type Content = ReturnType<typeof createContent>;
