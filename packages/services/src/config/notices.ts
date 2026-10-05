// 规则变更公告 notices.announce 的最小实现（W1-03；14 分组 第 2.6 节；D6 第 4.5 节）。
// 价目修订、需公告的计费参数、会员协议与积分规则的新版本保存时，在调用方的事务里建一条公告记录：
//   没有才插（同一变更至多一条 announced 的行，靠部分唯一索引 uq_site_notice_kind_ref_id_announced）；
//   已有就返回它的 id，不新建、不再发事件；新建时发出站事件 site_notice.announced。
// 现在只有“建”：撤回（notices.withdraw）、首页公告条的读取、站内消息的派发随 G2-B、G2-C。
// 第一个参数是事务句柄：公告与被公告的变更同一事务，变更回滚公告也没了。
import type { EnumValue, SITE_NOTICE_KIND } from "@liyoxi/contract/enums";

import type { EmitContext, Events } from "../events/index.js";
import { uuidv7 } from "../kernel/index.js";
import type { Clock, Tx } from "../kernel/index.js";

const DAY_MS = 86_400_000;

export interface NoticeAnnouncement {
  /** 公告类型，同时是 refId 的多态类型：取最终表名 */
  readonly kind: EnumValue<typeof SITE_NOTICE_KIND>;
  /** 被公告的变更：plan_revision.id、billing_param.change_id、agreement_version.id */
  readonly refId: string;
  /** 1–40 个字 */
  readonly title: string;
  /** 1–200 个字 */
  readonly summary: string;
  /** 不含价格数字的摘要；价目修订与计费参数必填，协议版本可不给 */
  readonly summaryNoPrice?: string | null;
  /** 规则生效时刻：不早于公告时刻 */
  readonly effectiveAt: Date;
  /** 公告期不足时的原因，只可能来自协议版本 */
  readonly shortNoticeReason?: string | null;
  /** 深链 { route, params } */
  readonly link: { readonly route: string; readonly params: Readonly<Record<string, unknown>> };
  /** 是否进首页公告条；不给即进 */
  readonly barEnabled?: boolean;
  /** 保存变更的员工 */
  readonly createdByStaffId: string;
}

export interface AnnouncedNotice {
  readonly siteNoticeId: string;
  /** 这一次是不是新建的；false 即这条变更已经公告过，返回的是原来那一行 */
  readonly created: boolean;
}

export interface NoticesDeps {
  /** 业务时钟：公告时刻取它 */
  readonly clock: Clock;
  readonly events: Pick<Events, "emit">;
}

export interface Notices {
  /** 在调用方的事务里公告一条变更；同一变更重复调返回同一行 */
  announce(tx: Tx, ctx: EmitContext, input: NoticeAnnouncement): Promise<AnnouncedNotice>;
}

export function createNotices(deps: NoticesDeps): Notices {
  return {
    async announce(tx, ctx, input) {
      const now = deps.clock.now();
      const id = uuidv7();
      const leadDays = Math.floor((input.effectiveAt.getTime() - now.getTime()) / DAY_MS);
      // jsonb 以文本传：Prisma 对 Json 入参认 $type 等键名，深链的 params 是调用方给的对象
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO site_notice (
          id, kind, ref_id, title, summary, summary_no_price, effective_at, announced_at, lead_days,
          short_notice_reason, link, bar_enabled, status, created_by_staff_id, created_at, updated_at
        ) VALUES (
          ${id}::uuid, ${input.kind}, ${input.refId}::uuid, ${input.title}, ${input.summary},
          ${input.summaryNoPrice ?? null}, ${input.effectiveAt}, ${now}, ${leadDays},
          ${input.shortNoticeReason ?? null}, ${JSON.stringify(input.link)}::jsonb,
          ${input.barEnabled ?? true}, 'announced', ${input.createdByStaffId}::uuid, ${now}, ${now}
        )
        ON CONFLICT (kind, ref_id) WHERE status = 'announced' DO NOTHING
        RETURNING id::text AS id`;
      if (inserted.length === 0) {
        const [existing] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM site_notice
           WHERE kind = ${input.kind} AND ref_id = ${input.refId}::uuid AND status = 'announced'`;
        if (existing === undefined) throw new Error("公告没有插入，也没有查到已有的那一行");
        return { siteNoticeId: existing.id, created: false };
      }
      await deps.events.emit(tx, ctx, {
        type: "site_notice.announced",
        aggregate: { type: "site_notice", id },
        payload: {
          v: 1,
          siteNoticeId: id,
          kind: input.kind,
          refId: input.refId,
          effectiveAt: input.effectiveAt.toISOString(),
        },
      });
      return { siteNoticeId: id, created: true };
    },
  };
}
