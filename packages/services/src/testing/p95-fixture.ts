// 无 Vitest 的 APPtest owned 前置。先由真实服务建完整图，再分批复制图；不是逐笔业务重放。
import { divRoundHalfUp } from "@liyoxi/shared/pricing";
import type { PrismaClient } from "@liyoxi/db";
import { createPrismaClient } from "@liyoxi/db";
import { assertTestDatabaseUrl } from "@liyoxi/db/testing/standalone";
import type { Tx } from "../kernel/index.js";
import { seedPlaceholderFinanceConfig } from "../billing/index.js";
import { loadKeyring } from "../security/index.js";
import { createPublish } from "../publish/index.js";
import { createNotices } from "../config/index.js";
import { createIdentityContext, uuidv7 } from "../kernel/index.js";
import { runInvariants } from "../ops/index.js";
import { createM1Support } from "./m1-support.js";
import { createLedgerHarness, topUp } from "./billing.js";
import { prepareOrderDrama, prepareOrderFixture } from "./order.fixture.js";
import { createFactories } from "./data/factories/index.js";
import { openSealed, testSealer } from "./data/seal.js";
import { fakeUscc } from "./data/factories/context.js";
import { signInAsStaff } from "./staff.js";
import { completeP95Prototype, completeP95Qualification } from "./p95-graph.js";

type Row = Record<string, unknown>;
export interface P95Dataset {
  readonly counts: Readonly<Record<string, number>>;
  readonly entryKinds: readonly { type: string; entries: number }[];
  readonly generation?: {
    readonly mode: "prototype_uuid_graph_copy";
    readonly prototypeRelay: { readonly expanded: number; readonly consumed: number };
    readonly prototypeEventTypes: readonly {
      type: string;
      events: number;
      implementedSubscribers: readonly string[];
    }[];
    readonly registeredSubscribers: readonly {
      name: string;
      module: string;
      events: readonly string[];
    }[];
  };
  readonly invariants: {
    readonly runId: string;
    // 是当前 own 库中持久化未解决记录，不是本轮各检查返回的完整分项条数。
    readonly persistedUnresolved:
      | ({
          readonly scope: "owned_database_unresolved_records";
          readonly perRun: false;
        } & (
          | {
              readonly status: "queried";
              readonly byCode: readonly { code: string; records: number }[];
              readonly unregisteredCodeRecords: number;
            }
          | { readonly status: "query_failed" }
        ))
      | null;
    readonly modules: readonly string[];
    readonly codes: readonly string[];
    readonly reportOnlyCodes: readonly string[];
    readonly status: string;
    readonly checksRun: number;
    readonly violations: number;
    readonly errors: readonly { code: string; category: string }[];
    readonly elapsedMs: number;
  };
}
const TABLES = [
  "merchant_user",
  "entity",
  "store",
  "entity_member",
  "file_object",
  "store_profile",
  "store_profile_media",
  "store_service_item",
  "channel_account",
  "approval_request",
  "qualification_submission",
  "qualification_doc",
  "channel_account_submission",
  "file_ref",
  "payment_txn",
  "billing_order",
  "subscription_term",
  "point_lot",
  "grant_schedule",
  "billing_account",
  "agreement_consent",
  "point_hold",
  "point_hold_alloc",
  "ledger_operation",
  "point_ledger_entry",
  "subscription_event",
  "drama_order",
  "order_item",
  "order_item_account",
  "delivery_plan",
  "delivery_plan_version",
  "delivery_ticket",
  "delivery_ticket_stage",
  "timer",
  "status_transition",
  "audit_log",
  "outbox_event",
  "outbox_delivery",
] as const;
export interface P95Scope {
  entityId: string;
  storeId: string;
  memberId: string;
  merchantUserId: string;
  phone: string;
  orderIds: string[];
  channelAccountId: string;
}
const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function mapped(value: unknown, ids: Map<string, string>, labels: Map<string, string>): unknown {
  if (typeof value === "string")
    return labels.get(value) ?? value.replace(idPattern, (id) => ids.get(id) ?? id);
  if (Array.isArray(value)) return value.map((v) => mapped(v, ids, labels));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapped(v, ids, labels)]));
  return value;
}
export async function createP95Fixture(options: {
  runId?: string;
  scale: number;
  seed: number;
  progress?: (message: string) => void;
  dataset?: (value: P95Dataset) => void;
}) {
  if (
    !Number.isFinite(options.scale) ||
    options.scale < 0.002 ||
    options.scale > 10 ||
    !Number.isSafeInteger(options.seed)
  )
    throw new Error("P95规模/种子不合法");
  const support = await createM1Support({ runId: options.runId });
  const { runtime, clock } = support;
  assertTestDatabaseUrl(runtime.env.DATABASE_URL);
  const db: PrismaClient = createPrismaClient({
    connectionString: runtime.env.DATABASE_URL,
    max: 1,
  });
  let closed = false,
    seeded = false;
  const scopes: P95Scope[] = [];
  let generation: P95Dataset["generation"];
  const assertOwned = () => {
    if (
      closed ||
      runtime.env.APP_ENV !== "test" ||
      !runtime.env.DATABASE_URL.includes(`/${support.databaseName}`)
    )
      throw new Error("P95前置归属不一致");
    assertTestDatabaseUrl(runtime.env.DATABASE_URL);
  };
  async function validateDataset() {
    assertOwned();
    const counts = Object.fromEntries(
      await Promise.all(
        [
          ...TABLES,
          "staff",
          "drama",
          "drama_episode",
          "drama_copyright",
          "drama_copyright_revision",
          "drama_permit",
          "agreement",
          "agreement_version",
          "site_notice",
          "plan",
          "plan_revision",
          "billing_param",
        ].map(async (table) => [
          table,
          Number(
            (await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table}`))[0]!.n,
          ),
        ]),
      ),
    );
    const entryKinds = await db.$queryRawUnsafe<{ op_type: string; n: bigint }[]>(
      "SELECT o.op_type,count(*) AS n FROM point_ledger_entry e JOIN ledger_operation o ON o.id=e.ledger_operation_id GROUP BY o.op_type ORDER BY o.op_type",
    );
    const invariantStarted = performance.now();
    const runnable = runtime.assembly.invariants.filter(
      (check) => check.run !== undefined && check.modes.includes("full"),
    );
    const invariants = await runInvariants(
      { tx: runtime.tx, assembly: runtime.assembly, clock },
      {
        mode: "full",
        trigger: "manual",
      },
    );
    const invariantElapsedMs = performance.now() - invariantStarted;
    let persistedUnresolved: P95Dataset["invariants"]["persistedUnresolved"] = null;
    if (invariants.violationsFound > 0) {
      try {
        assertOwned();
        const rows = await db.invariantViolation.groupBy({
          by: ["code"],
          where: { resolvedAt: null },
          _count: { _all: true },
          orderBy: { code: "asc" },
        });
        const registered = new Set(runtime.assembly.invariants.map((check) => check.code));
        persistedUnresolved = {
          scope: "owned_database_unresolved_records",
          perRun: false,
          status: "queried",
          byCode: rows
            .filter((row) => registered.has(row.code))
            .map((row) => ({ code: row.code, records: row._count._all })),
          // 未登记 code 不输出原值；仅明确保留它们的实际记录数量。
          unregisteredCodeRecords: rows
            .filter((row) => !registered.has(row.code))
            .reduce((count, row) => count + row._count._all, 0),
        };
      } catch {
        // 辅助报告失败不能遮盖已确定的不变量失败，也不伪造查询到的零记录。
        persistedUnresolved = {
          scope: "owned_database_unresolved_records",
          perRun: false,
          status: "query_failed",
        };
      }
    }
    const dataset: P95Dataset = {
      counts,
      generation,
      entryKinds: entryKinds.map((r) => ({ type: r.op_type, entries: Number(r.n) })),
      invariants: {
        runId: invariants.runId,
        persistedUnresolved,
        modules: [...new Set(runnable.map((check) => check.module))].sort(),
        codes: runnable.map((check) => check.code),
        reportOnlyCodes: runtime.assembly.invariants
          .filter((check) => check.run === undefined)
          .map((check) => check.code),
        status: invariants.status,
        checksRun: invariants.checksRun,
        violations: invariants.violationsFound,
        errors: invariants.errors.map((e) => ({
          code: e.code,
          // 既有 runner 的摘要可能包含 Prisma 调用片段；报告只留类型，不输出其文本。
          category: e.message.match(/^([A-Za-z][A-Za-z0-9]*):/)?.[1] ?? "CheckError",
        })),
        elapsedMs: invariantElapsedMs,
      },
    };
    if (invariants.status !== "succeeded" || invariants.violationsFound !== 0) {
      options.dataset?.(dataset);
      throw new Error(
        `P95数据不变量未通过:${invariants.status}/${invariants.violationsFound}/${invariants.errors.map((e) => e.code).join(",")}`,
      );
    }
    await db.$executeRawUnsafe("ANALYZE");
    return { dataset, invariants };
  }
  return {
    support,
    async loginAgreements() {
      assertOwned();
      const make = createFactories({ db, clock });
      const staff = await make.staff({ staffRoleKey: "super_admin" });
      const proposer = await make.staff({ staffRoleKey: "finance" }),
        approver = await make.staff({ staffRoleKey: "finance", isLead: true });
      await seedPlaceholderFinanceConfig(
        {
          tx: runtime.tx,
          clock,
          assembly: runtime.assembly,
          bizNo: runtime.bizNo,
          keyring: loadKeyring(runtime.env),
        },
        { proposerId: proposer.id, approverId: approver.id },
      );
      for (const agreementKey of ["user", "privacy", "member", "points"]) {
        if (await db.agreementVersion.findFirst({ where: { agreementKey, status: "active" } }))
          continue;
        if (agreementKey === "user" || agreementKey === "privacy") {
          await make.agreementVersion({ agreementKey });
          continue;
        }
        const id = uuidv7();
        await runtime.tx.run(async (tx) => {
          const notice = await createNotices({ clock, events: runtime.events }).announce(
            tx,
            createIdentityContext({ actor: { type: "staff", id: staff.id, client: "admin" } }),
            {
              kind: "agreement_version",
              refId: id,
              title: "P95测试协议",
              summary: "本轮隔离测试前置",
              effectiveAt: clock.now(),
              shortNoticeReason: "首次测试前置",
              link: { route: "/agreement", params: { agreementKey } },
              createdByStaffId: staff.id,
            },
          );
          await createFactories({ db: tx, clock }).agreementVersion({
            id,
            agreementKey,
            siteNoticeId: notice.siteNoticeId,
            shortNoticeReason: "首次测试前置",
          });
        });
      }
    },
    async seed(scope: Omit<P95Scope, "orderIds" | "channelAccountId">) {
      assertOwned();
      if (seeded) throw new Error("P95前置不可重复填充");
      seeded = true;
      const h = createLedgerHarness(db, { clock });
      const fixture = await prepareOrderFixture(db, runtime, clock, scope);
      // 待审队列也有真实领域单据，避免在空队列上把查询耗时当作基线。
      const screenshot = await h.make.fileObject({
        category: "channel_screenshot",
        bucket: "asset",
        scopeType: "store",
        entityId: scope.entityId,
        storeId: scope.storeId,
        uploadActorType: "merchant",
        uploadActorId: scope.merchantUserId,
        uploadClient: "weapp",
      });
      const publish = createPublish({
        tx: runtime.tx,
        clock,
        assembly: runtime.assembly,
        approval: runtime.approval,
        flow: runtime.flow,
        media: runtime.media,
      });
      await publish.bind(
        {
          ctx: createIdentityContext({
            actor: { type: "merchant", id: scope.merchantUserId, client: "weapp", role: "owner" },
            entityId: scope.entityId,
            storeId: scope.storeId,
          }),
          membership: fixture.actor.membership,
        },
        {
          platform: "douyin",
          accountName: "P95待审核账号",
          accountUid: uuidv7(),
          accountType: "none",
          screenshotFileIds: [screenshot.id],
        },
      );
      const term = await db.subscriptionTerm.findFirstOrThrow({
        where: { entityId: scope.entityId, status: "active" },
      });
      const orderIds: string[] = [];
      for (let n = 0; n < 4; n++) {
        for (let k = 0; k < 16; k++) await topUp(h, { entityId: scope.entityId, points: 100 });
        const account = await db.billingAccount.findUniqueOrThrow({
          where: { entityId: scope.entityId },
        });
        const target = n === 0 ? account.planAvailableQty + 1600 : 1600;
        const price = divRoundHalfUp([target, 10_000], [term.discountBp]);
        const drama = await prepareOrderDrama(h, price);
        const quoteInput = {
          dramaIds: [drama.id],
          channelAccountIds: [fixture.channelAccountId],
          isTopModel: false,
        };
        const quote = await runtime.order.quote(fixture.actor, quoteInput);
        if (quote.totalChargePoints !== target)
          throw new Error(
            `P95正式折扣计价不一致:${target}/${quote.totalChargePoints}/${price}/${term.discountBp}`,
          );
        const order = await runtime.order.create(fixture.actor, {
          ...fixture.input,
          ...quoteInput,
          expect: quote.expect,
        });
        orderIds.push(order.orderId);
        options.progress?.(`P95真实prototype订单 ${n + 1}/4`);
        const transportScope = { ...scope, orderId: order.orderId };
        const timer = await support.orderTimer(transportScope);
        await support.runDueTimer(transportScope, timer.timerId);
      }
      // 给真实测量的订购写接口留合法余额，保持批次/流水/支付来源一致。
      await topUp(h, { entityId: scope.entityId, points: 5000 });
      const spareDrama = await prepareOrderDrama(h, 100);
      await completeP95Prototype({ support, db }, scope);
      const drained = await support.drainEvents();
      const eventTypes = await db.$queryRawUnsafe<{ event_type: string; n: bigint }[]>(
        "SELECT event_type,count(*) AS n FROM outbox_event WHERE entity_id=$1::uuid GROUP BY event_type ORDER BY event_type",
        scope.entityId,
      );
      generation = {
        mode: "prototype_uuid_graph_copy",
        prototypeRelay: drained,
        prototypeEventTypes: eventTypes.map((row) => ({
          type: row.event_type,
          events: Number(row.n),
          implementedSubscribers: runtime.events.subscribers
            .forEvent(row.event_type)
            .map((subscriber) => subscriber.name),
        })),
        registeredSubscribers: runtime.events.subscribers.all.map(({ name, module, events }) => ({
          name,
          module,
          events,
        })),
      };
      options.progress?.(
        `P95真实prototype出站事件 expanded=${drained.expanded}/consumed=${drained.consumed}`,
      );
      const raw = new Map<string, Row[]>(),
        columns = new Map<string, string[]>();
      for (const table of TABLES) {
        const metadata = await db.$queryRawUnsafe<{ column_name: string }[]>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          table,
        );
        const names = metadata.map((c) => c.column_name);
        columns.set(
          table,
          names.filter((c) => c !== "seq"),
        );
        let where: string, params: unknown[];
        if (table === "merchant_user") {
          where = "id=$1::uuid";
          params = [scope.merchantUserId];
        } else if (table === "entity") {
          where = "id=$1::uuid";
          params = [scope.entityId];
        } else if (names.includes("entity_id")) {
          where =
            table === "agreement_consent"
              ? "entity_id=$1::uuid OR (merchant_user_id=$2::uuid AND entity_id IS NULL)"
              : "entity_id=$1::uuid";
          params =
            table === "agreement_consent"
              ? [scope.entityId, scope.merchantUserId]
              : [scope.entityId];
        } else if (table === "outbox_delivery") {
          where = "outbox_event_id IN (SELECT id FROM outbox_event WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else if (table === "file_ref") {
          where = "file_id IN (SELECT id FROM file_object WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else if (table === "point_hold_alloc") {
          where = "point_hold_id IN (SELECT id FROM point_hold WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else if (table === "order_item_account") {
          where = "order_item_id IN (SELECT id FROM order_item WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else if (table === "delivery_ticket_stage") {
          where = "delivery_ticket_id IN (SELECT id FROM delivery_ticket WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else if (table === "timer") {
          where = "subject_id IN (SELECT id FROM drama_order WHERE entity_id=$1::uuid)";
          params = [scope.entityId];
        } else throw new Error(`P95表未明确归属:${table}`);
        const rows = await db.$queryRawUnsafe<{ row: Row }[]>(
          `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${where} ORDER BY ${table === "outbox_delivery" ? "outbox_event_id,subscriber" : names.includes("seq") ? "seq" : names.includes("id") ? "id" : names[0]}`,
          ...params,
        );
        raw.set(
          table,
          rows.map((v) => v.row),
        );
      }
      scopes.push({ ...scope, orderIds, channelAccountId: fixture.channelAccountId });
      const count = Math.ceil(options.scale * 500);
      let state = options.seed >>> 0;
      const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
      };
      for (let start = 1; start < count; start += 20) {
        const batches = new Map<string, Row[]>();
        for (let n = start; n < Math.min(start + 20, count); n++) {
          const ids = new Map<string, string>();
          for (const rows of raw.values())
            for (const row of rows) if (typeof row["id"] === "string") ids.set(row["id"], uuidv7());
          const labels = new Map<string, string>();
          for (const table of ["drama_order", "billing_order"])
            for (const [k, row] of raw.get(table)!.entries())
              if (typeof row["order_no"] === "string")
                labels.set(
                  row["order_no"],
                  `${table === "drama_order" ? "LYX" : "FK"}20260105${String(100000 + n * 100 + k)}`,
                );
          for (const row of raw.get("channel_account")!) {
            labels.set(String(row["account_uid"]), ids.get(String(row["id"]))!);
            labels.set(String(row["account_uid_norm"]), ids.get(String(row["id"]))!);
          }
          for (const [k, row] of raw.get("delivery_ticket")!.entries())
            labels.set(String(row["ticket_no"]), `JX20260105${String(100000 + n * 100 + k)}`);
          for (const row of raw.get("payment_txn")!) {
            const newId = ids.get(String(row["id"]))!;
            labels.set(String(row["out_trade_no"]), newId.replaceAll("-", ""));
            if (row["channel_txn_no"])
              labels.set(
                String(row["channel_txn_no"]),
                `420${newId.replaceAll("-", "").slice(0, 29)}`,
              );
          }
          const phone = `136${String(10_000_000 + n).padStart(8, "0")}`,
            sealed = testSealer.phone("merchant_user.phone_enc", phone),
            cloneUscc = fakeUscc(200000 + n),
            entityName = `P95主体${n}`,
            uscc = testSealer.uscc("entity.uscc_enc", cloneUscc);
          for (const table of TABLES) {
            const rows = raw.get(table)!.map((row) => mapped(row, ids, labels) as Row);
            if (table === "merchant_user")
              for (const row of rows)
                Object.assign(row, {
                  phone_enc: sealed.enc,
                  phone_bidx: `\\x${Buffer.from(sealed.bidx).toString("hex")}`,
                  phone_mask: sealed.mask,
                  phone_last4: sealed.last4,
                  display_name: `P95用户${random()}`,
                });
            if (table === "agreement_consent")
              for (const row of rows) {
                const snapshot = testSealer.phone("agreement_consent.phone_enc", phone);
                Object.assign(row, {
                  phone_enc: snapshot.enc,
                  phone_mask: snapshot.mask,
                  ...(row["entity_id"]
                    ? { entity_name: entityName, uscc_enc: uscc.enc, uscc_mask: uscc.mask }
                    : {}),
                });
              }
            if (table === "entity")
              for (const row of rows)
                Object.assign(row, {
                  uscc_enc: uscc.enc,
                  uscc_bidx: `\\x${Buffer.from(uscc.bidx).toString("hex")}`,
                  uscc_mask: uscc.mask,
                  name: entityName,
                });
            if (table === "qualification_submission")
              for (const row of rows) {
                const contact = row["contact_snapshot"];
                if (!contact || typeof contact !== "object" || Array.isArray(contact))
                  throw new Error("P95 qualification contact snapshot 缺失");
                row["contact_snapshot"] = { ...contact, phoneMask: sealed.mask };
              }
            if (table === "qualification_doc")
              for (const row of rows) {
                if (
                  row["doc_type"] !== "business_license" ||
                  row["scope"] !== "entity" ||
                  typeof row["submitted_fields_enc"] !== "string"
                )
                  throw new Error("P95 qualification document 不符合批准的原型图");
                const fields = JSON.parse(
                  openSealed("qualification_doc.submitted_fields_enc", row["submitted_fields_enc"]),
                ) as Record<string, unknown>;
                const cert = testSealer.uscc("qualification_doc.cert_no_enc", cloneUscc);
                Object.assign(row, {
                  holder_name: entityName,
                  cert_no_enc: cert.enc,
                  cert_no_bidx: `\\x${Buffer.from(cert.bidx).toString("hex")}`,
                  cert_no_mask: cert.mask,
                  submitted_fields_enc: testSealer.text(
                    "qualification_doc.submitted_fields_enc",
                    JSON.stringify({ ...fields, uscc: cloneUscc, name: entityName }),
                  ),
                });
              }
            batches.set(table, [...(batches.get(table) ?? []), ...rows]);
          }
          scopes.push({
            entityId: ids.get(scope.entityId)!,
            storeId: ids.get(scope.storeId)!,
            memberId: ids.get(scope.memberId)!,
            merchantUserId: ids.get(scope.merchantUserId)!,
            phone,
            orderIds: orderIds.map((id) => ids.get(id)!),
            channelAccountId: ids.get(fixture.channelAccountId)!,
          });
        }
        await runtime.tx.run(
          async (tx: Tx) => {
            // payment_txn ↔ billing_order 有真实双向外键：先写未应用支付，再写单据，同TX回填应用。
            for (const table of TABLES) {
              const rows = batches.get(table)!;
              if (rows.length === 0) continue;
              const names = columns
                .get(table)!
                .map((c) => `"${c}"`)
                .join(",");
              const initial =
                table === "payment_txn"
                  ? rows.map((row) => ({ ...row, billing_order_id: null, applied_at: null }))
                  : table === "store_profile"
                    ? rows.map((row) => ({ ...row, effective_qualification_submission_id: null }))
                    : rows;
              await tx.$executeRawUnsafe(
                `INSERT INTO ${table} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,
                JSON.stringify(initial),
              );
            }
            await tx.$executeRawUnsafe(
              `UPDATE store_profile p SET effective_qualification_submission_id=r.effective_qualification_submission_id FROM jsonb_populate_recordset(NULL::store_profile,$1::jsonb) r WHERE p.store_id=r.store_id AND p.entity_id=r.entity_id`,
              JSON.stringify(batches.get("store_profile")),
            );
            await tx.$executeRawUnsafe(
              `UPDATE payment_txn p SET billing_order_id=r.billing_order_id,applied_at=r.applied_at FROM jsonb_populate_recordset(NULL::payment_txn,$1::jsonb) r WHERE p.id=r.id`,
              JSON.stringify(batches.get("payment_txn")),
            );
          },
          { timeoutMs: 15_000 },
        );
        options.progress?.(`P95图复制 ${Math.min(start + 20, count)}/${count} 店`);
      }
      const { dataset, invariants } = await validateDataset();
      options.dataset?.(dataset);
      return {
        scopes,
        spareDramaId: spareDrama.id,
        counts: dataset.counts,
        generation: dataset.generation,
        entryKinds: dataset.entryKinds,
        invariants,
      };
    },
    async prepareBuyer(
      scope: Pick<P95Scope, "entityId" | "storeId" | "merchantUserId" | "memberId" | "phone">,
    ) {
      assertOwned();
      const uscc = testSealer.uscc("entity.uscc_enc", fakeUscc(400000 + (await db.entity.count())));
      await runtime.tx.run(async (tx) => {
        await tx.entity.update({
          where: { id: scope.entityId },
          data: {
            name: "P95新购主体",
            entityType: "enterprise",
            verificationStatus: "verified",
            verifiedAt: clock.now(),
            usccEnc: uscc.enc,
            usccBidx: uscc.bidx,
            usccMask: uscc.mask,
            updatedAt: clock.now(),
          },
        });
        await tx.store.update({
          where: { id: scope.storeId },
          data: { name: "P95新购门店", qualificationStatus: "verified", updatedAt: clock.now() },
        });
        await tx.storeProfile.create({
          data: {
            storeId: scope.storeId,
            entityId: scope.entityId,
            brandName: "P95新购门店",
            industryCode: "W115I",
            categoryCode: "W115C",
            provinceCode: "W115P",
            cityCode: "W115M",
            districtCode: "W115D",
            addressDetail: "测试路一号",
            createdAt: clock.now(),
            updatedAt: clock.now(),
          },
        });
      });
      await completeP95Qualification({ support, db }, scope);
    },
    async validatePrepared() {
      assertOwned();
      const drained = await support.drainEvents();
      options.progress?.(
        `P95采样前实际出站消费 expanded=${drained.expanded}/consumed=${drained.consumed}`,
      );
      return (await validateDataset()).dataset;
    },
    async adminSession() {
      assertOwned();
      return signInAsStaff(db, {
        roleKey: "super_admin",
        now: clock.now(),
        origin: "http://admin.localhost",
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await db.$disconnect();
      await support.close();
    },
  };
}
