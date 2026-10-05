import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPrismaClient, type PrismaClient } from "./index.js";

// 权限测试（W0-06a 任务书 第 7 节第 1–7 条）。命令：pnpm --filter @liyoxi/db exec vitest run src/grants.test.ts
// 自建自删一个库 lyx_test_db_grants_<进程号>：空库上把全部迁移跑两遍，再以三种身份去试。
// 主机与账号取环境变量 DATABASE_URL（本地的写法见 CLAUDE.md 第 9 节），那个账号要能建库、能切换角色（本地与 CI 是管理账号）。
// 连不上即失败，不跳过。
//
// 身份靠连接串的启动参数定（options=-c role=…），等同于连上之后 SET ROLE，不需要口令；连接断了重连也还是这个角色。
//   owner     跑迁移的账号，即表的属主：用来证明“触发器那一道还在”
//   app       lyx_app
//   seed      lyx_app，外加 session_replication_role = replica：只用来插夹具行。
//             十张表的外键指向别的表，为了不把上游的行一路造出来，插入时让外键（与别的触发器）不触发；
//             权限检查不受它影响。改、删、清空的断言一律不用这个连接。
//   readonly  lyx_readonly
// 期望的权限清单在 src/grants.expected.json（与核对脚本 infra/ci/db-verify-grants.mjs 共用一份），与迁移里的授权语句各写各的：
// 迁移漏了、多了，或以后加表没补授权，这里都会红。

// 全仓用例并行跑时库很忙：建库、两遍迁移、删库各要十几秒，缺省的 5 秒（用例）与 10 秒（钩子）不够
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const pkg = fileURLToPath(new URL("..", import.meta.url));
const DB = `lyx_test_db_grants_${process.pid}`;
/** 迁移目录下的全部迁移，按名字排序：以后加了迁移，这里跟着目录走 */
const MIGRATIONS = readdirSync(join(pkg, "prisma/migrations"), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
  .sort();
/** insufficient_privilege：权限那一道 */
const DENIED = "42501";
/** restrict_violation：触发器那一道（00-common.sql 的几个函数都用它） */
const RESTRICTED = "23001";

function urlOf(db: string, options?: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL 未设置：本包的用例要连本地的 PostgreSQL（取值见 CLAUDE.md 第 9 节，准备步骤见 packages/db/README.md）",
    );
  }
  const url = new URL(base);
  url.pathname = `/${db}`;
  if (options) url.searchParams.set("options", options);
  return url.toString();
}

const names = (text: string): string[] => text.trim().split(/\s+/);

// ===== 期望的权限清单 =====

/** 期望的授权：与核对脚本 infra/ci/db-verify-grants.mjs 共用一份。各项的含义见那份文件开头的“说明” */
interface ExpectedGrants {
  /** 逻辑表 → lyx_app 的表级权限（按字母序、逗号连接） */
  tables: Record<string, string>;
  /** 只增表（06 第 4 节“只增”一列为“是”的 16 张） */
  appendOnly: string[];
  /** 另授列级 UPDATE 的列（触发器放行“写一次”的那几列） */
  columnUpdate: Record<string, string[]>;
  /** 以属主身份执行的函数 → 可以执行它的角色 */
  definerFunctions: Record<string, string[]>;
}
const EXPECTED = JSON.parse(
  readFileSync(join(pkg, "src/grants.expected.json"), "utf8"),
) as ExpectedGrants;
/** 只增表 → 另授列级 UPDATE 的列 */
const APPEND_ONLY: Record<string, string[]> = Object.fromEntries(
  EXPECTED.appendOnly.map((table) => [table, EXPECTED.columnUpdate[table] ?? []]),
);
/** lyx_app 在 166 张逻辑表上的表级权限 */
const TABLE_PRIVILEGES = EXPECTED.tables;
/** 14 个自增列（表.列）；它们背后的序列加审计编号的序列 audit_no_seq，lyx_app 各有 USAGE */
const SERIAL_COLUMNS = [
  ...names(`
    outbox_event status_transition assignment_history audit_log auth_event drama_copyright_revision
    subscription_event ledger_operation point_ledger_entry delivery_download_log manual_reminder_log
    agreement_consent param_value
  `).map((table) => `${table}.seq`),
  "staff.staff_no",
].sort();

// ===== 夹具：18 张表各一行，值是 SQL 表达式 =====

const NOW = "now()";
const TODAY = "(now() AT TIME ZONE 'Asia/Shanghai')::date";
const uuid = (): string => `'${randomUUID()}'`;
const SYSTEM = { actor_type: "'system'" };
/** needsFk：有非空外键，插入时走 seed 连接 */
const FIXTURES: Record<string, { needsFk?: true; values: Record<string, string> }> = {
  outbox_event: {
    values: { event_type: "'lyx.grants_test'", payload: `'{"v":1}'`, occurred_at: NOW, ...SYSTEM },
  },
  status_transition: {
    values: {
      machine: "'drama_order'",
      subject_id: uuid(),
      state_field: "'status'",
      to_state: "'submitted'",
      event: "'submit'",
      occurred_at: NOW,
      biz_date: TODAY,
      ...SYSTEM,
    },
  },
  assignment_history: {
    needsFk: true,
    values: {
      batch_id: uuid(),
      source: "'store_manager'",
      subject_type: "'store'",
      subject_id: uuid(),
      from_staff_id: uuid(),
      to_staff_id: uuid(),
      reason_code: "'reassigned'",
      contact_due_at: "now() + interval '1 day'",
      sla_snapshot: `'{}'`,
      created_at: NOW,
      updated_at: NOW,
      ...SYSTEM,
    },
  },
  audit_log: {
    values: {
      stream: "'ops'",
      category: "'test'",
      action: "'db.grants.test'",
      summary: "'权限测试'",
      actor_name: "'系统'",
      actor_role: "'system'",
      ...SYSTEM,
    },
  },
  auth_event: { values: { created_at: NOW, space: "'staff'", event: "'login_success'" } },
  drama_copyright_revision: {
    needsFk: true,
    values: {
      drama_id: uuid(),
      change_kind: "'initial'",
      copyright_snapshot: `'{}'`,
      new_end_date: "'2030-01-01'",
      reason: "'首次上架'",
      created_by_staff_id: uuid(),
      created_at: NOW,
    },
  },
  price_tier_revision: {
    values: { tier: "'S'", points: "100", effective_at: NOW, batch_id: uuid(), created_at: NOW },
  },
  subscription_event: {
    needsFk: true,
    values: {
      entity_id: uuid(),
      subscription_term_id: uuid(),
      type: "'activated'",
      occurred_at: NOW,
      biz_date: TODAY,
      created_at: NOW,
      ...SYSTEM,
    },
  },
  ledger_operation: {
    needsFk: true,
    values: {
      op_key: `'grants-test-' || ${uuid()}`,
      op_type: "'fix'",
      entity_id: uuid(),
      occurred_at: NOW,
      biz_date: TODAY,
      spendable_after_qty: "0",
      held_after_qty: "0",
      created_at: NOW,
      ...SYSTEM,
    },
  },
  point_ledger_entry: {
    needsFk: true,
    values: {
      ledger_operation_id: uuid(),
      entity_id: uuid(),
      point_lot_id: uuid(),
      lot_kind: "'addon'",
      from_bucket: "'external'",
      to_bucket: "'available'",
      qty: "1",
      occurred_at: NOW,
      biz_date: TODAY,
      created_at: NOW,
    },
  },
  finance_config_revision: {
    needsFk: true,
    values: {
      config_key: "'controls'",
      payload: `'{}'`,
      change_note: "'权限测试'",
      approval_request_id: uuid(),
      created_at: NOW,
    },
  },
  delivery_download_log: {
    needsFk: true,
    values: {
      entity_id: uuid(),
      store_id: uuid(),
      delivery_release_id: uuid(),
      order_item_id: uuid(),
      kind: "'zip'",
      file_id: uuid(),
      actor_type: "'staff'",
      actor_id: uuid(),
      client: "'admin'",
      url_ttl_sec: "60",
      created_at: NOW,
    },
  },
  manual_reminder_log: {
    needsFk: true,
    values: {
      subject_type: "'ad'",
      subject_id: uuid(),
      scene: "'confirm_ad'",
      biz_date: TODAY,
      sent_by_staff_id: uuid(),
      created_at: NOW,
    },
  },
  agreement_consent: {
    needsFk: true,
    values: {
      agreement_key: "'user_agreement'",
      agreement_version_id: uuid(),
      content_sha256: "repeat('0', 64)",
      merchant_user_id: uuid(),
      phone_enc: "'enc'",
      phone_mask: "'138****0000'",
      scene: "'login'",
      method: "'checkbox'",
      consented_at: NOW,
      ip: "'127.0.0.1'",
      device_snapshot: `'{}'`,
      request_id: "'grants-test'",
      created_at: NOW,
    },
  },
  param_value: {
    values: {
      key: "'grants.test'",
      value: "'1'",
      effective_at: "now() + interval '1 day'",
      created_by_staff_id: uuid(),
      created_at: NOW,
    },
  },
  analytics_event: {
    values: {
      occurred_at: NOW,
      event_id: `'srv-' || ${uuid()}`,
      name: "'app_launch'",
      source: "'direct'",
      ...SYSTEM,
    },
  },
  file_object: {
    values: {
      bucket: "'secure'",
      object_key: `'grants-test/' || ${uuid()}`,
      category: "'evidence'",
      scope_type: "'platform'",
      upload_actor_type: "'system'",
      status: "'pending'",
      declared_size: "1",
      declared_mime: "'text/plain'",
      ext: "'txt'",
      created_at: NOW,
      updated_at: NOW,
    },
  },
  staff: {
    needsFk: true,
    values: {
      name: "'权限测试'",
      phone_enc: "'enc'",
      phone_bidx: "decode(repeat('00', 32), 'hex')",
      phone_mask: "'138****0000'",
      phone_last4: "'0000'",
      staff_role_key: "'super_admin'",
      status: "'active'",
      created_at: NOW,
      updated_at: NOW,
    },
  },
};

// ===== 连接与小工具 =====

type Row = Record<string, unknown>;
const clients: Record<string, PrismaClient> = {};
const connect = (name: string, db: string, options?: string): PrismaClient =>
  (clients[name] = createPrismaClient({ connectionString: urlOf(db, options), max: 1 }));
let admin: PrismaClient;
let owner: PrismaClient;
let app: PrismaClient;
let seed: PrismaClient;
let readonly: PrismaClient;

/** 每张夹具表插进去的那一行（RETURNING * 的结果） */
const rows: Record<string, Row> = {};
/** 两遍迁移的输出，与每遍之后的授权快照 */
const deploys: Array<{ status: number | null; output: string; acl: string }> = [];

interface DriverError {
  meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } };
}
/** 跑一句，返回数据库的错误码（SQLSTATE）与报错原文；没报错返回 "ok" */
async function dbError(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
    return { code: "ok", message: "" };
  } catch (error) {
    const cause = (error as DriverError).meta?.driverAdapterError?.cause;
    return {
      code: cause?.originalCode ?? `没有错误码：${String(error)}`,
      message: cause?.originalMessage ?? String(error),
    };
  }
}
const sqlState = async (run: () => Promise<unknown>): Promise<string> => (await dbError(run)).code;
const exec = (client: PrismaClient, sql: string) => () => client.$executeRawUnsafe(sql);
const query = <T = Row>(client: PrismaClient, sql: string) => client.$queryRawUnsafe<T[]>(sql);
const idOf = (table: string): string => `'${String(rows[table]?.id)}'`;

async function insert(client: PrismaClient, table: string, values: Record<string, string>) {
  const all = { id: uuid(), ...values };
  const [row] = await query(
    client,
    `INSERT INTO ${table} (${Object.keys(all).join(", ")}) VALUES (${Object.values(all).join(", ")}) RETURNING *`,
  );
  if (!row) throw new Error(`${table}：插入没有返回行`);
  return row;
}

function deploy(): { status: number | null; output: string } {
  const result = spawnSync(join(pkg, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: pkg,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlOf(DB), CHECKPOINT_DISABLE: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 授权快照：public 里全部表、列、序列、函数的访问控制列表，缺省授权，模式的授权，两个角色的属性 */
const ACL_SNAPSHOT = `
  select string_agg(line, E'\\n' order by line) as acl from (
    select 'rel ' || c.relname || ' ' || coalesce(c.relacl::text, '-') as line
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'S')
    union all
    select 'col ' || c.relname || '.' || a.attname || ' ' || a.attacl::text
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and a.attacl is not null
    union all
    select 'fn ' || p.oid::regprocedure || ' ' || coalesce(p.proacl::text, '-')
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'lyx_%'
    union all
    select 'default ' || d.defaclobjtype::text || ' ' || d.defaclacl::text from pg_default_acl d
    union all
    select 'schema ' || coalesce(n.nspacl::text, '-') from pg_namespace n where n.nspname = 'public'
    union all
    select 'role ' || r.rolname || ' ' || concat_ws(',', r.rolcanlogin, r.rolsuper, r.rolcreatedb,
           r.rolcreaterole, r.rolreplication, r.rolbypassrls)
      from pg_roles r where r.rolname in ('lyx_app', 'lyx_readonly')
  ) s`;

beforeAll(async () => {
  admin = connect("admin", "postgres");
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${DB}`);
  owner = connect("owner", DB);
  for (let round = 0; round < 2; round += 1) {
    const result = deploy();
    const [snapshot] = await query<{ acl: string }>(owner, ACL_SNAPSHOT);
    deploys.push({ ...result, acl: snapshot?.acl ?? "" });
  }
  app = connect("app", DB, "-c role=lyx_app");
  seed = connect("seed", DB, "-c role=lyx_app -c session_replication_role=replica");
  readonly = connect("readonly", DB, "-c role=lyx_readonly");
  for (const [table, fixture] of Object.entries(FIXTURES)) {
    rows[table] = await insert(fixture.needsFk ? seed : app, table, fixture.values);
  }
});

afterAll(async () => {
  await Promise.all(Object.values(clients).map((client) => client.$disconnect()));
  const cleaner = createPrismaClient({ connectionString: urlOf("postgres"), max: 1 });
  try {
    await cleaner.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  } finally {
    await cleaner.$disconnect();
  }
});

describe("迁移（任务书 第 7 节第 1 条）", () => {
  it("空库上全部迁移跑通；再跑一次没有待执行的迁移，授权快照逐字相同", () => {
    expect(MIGRATIONS).toContain("20261005060000_grants");
    const [first, second] = deploys;
    expect(first?.status).toBe(0);
    for (const name of MIGRATIONS) expect(first?.output).toContain(name);
    expect(first?.output).toContain("All migrations have been successfully applied.");
    expect(second?.status).toBe(0);
    expect(second?.output).toContain("No pending migrations to apply.");
    expect(first?.acl).toContain("lyx_app=");
    expect(second?.acl).toBe(first?.acl);
  });

  it("四个连接各是谁；两个角色不可登录、没有任何特权属性、不是别的角色的成员", async () => {
    const who = (client: PrismaClient) =>
      query(
        client,
        "select current_user::text as role, current_setting('session_replication_role') as mode",
      );
    expect((await who(app))[0]).toEqual({ role: "lyx_app", mode: "origin" });
    expect((await who(seed))[0]).toEqual({ role: "lyx_app", mode: "replica" });
    expect((await who(readonly))[0]).toEqual({ role: "lyx_readonly", mode: "origin" });
    const [me] = await query(
      owner,
      "select current_user = session_user as same, (select tableowner from pg_tables where tablename = 'audit_log') = current_user::text as owns",
    );
    expect(me).toEqual({ same: true, owns: true });
    expect(deploys[1]?.acl).toContain("role lyx_app f,f,f,f,f,f");
    expect(deploys[1]?.acl).toContain("role lyx_readonly f,f,f,f,f,f");
    const members = await query(
      owner,
      "select 1 from pg_auth_members where member in ('lyx_app'::regrole, 'lyx_readonly'::regrole)",
    );
    expect(members).toEqual([]);
  });
});

describe("只增表：应用角色（任务书 第 7 节第 2、3 条）", () => {
  it.each(Object.keys(APPEND_ONLY))(
    "%s：INSERT、SELECT 成功；DELETE、TRUNCATE 与例外列之外的 UPDATE 被拒，都是 42501",
    async (table) => {
      // INSERT 在 beforeAll 里由 lyx_app 做了：这里读得回那一行
      const found = await query(app, `SELECT id FROM ${table} WHERE id = ${idOf(table)}`);
      expect(found).toHaveLength(1);
      expect(await sqlState(exec(app, `DELETE FROM ${table} WHERE id = ${idOf(table)}`))).toBe(
        DENIED,
      );
      expect(await sqlState(exec(app, `DELETE FROM ${table}`))).toBe(DENIED);
      expect(await sqlState(exec(app, `TRUNCATE ${table}`))).toBe(DENIED);
      // 逐列试：把这一列改成它自己。例外列放行（值没变，触发器也过），其余列在权限那一道就被拒
      const columns = await query<{ name: string }>(
        owner,
        `select attname::text as name from pg_attribute where attrelid = '${table}'::regclass and attnum > 0 and not attisdropped order by attnum`,
      );
      const outcome: Record<string, string> = {};
      for (const { name } of columns) {
        outcome[name] = await sqlState(
          exec(app, `UPDATE ${table} SET "${name}" = "${name}" WHERE id = ${idOf(table)}`),
        );
      }
      const allowed = APPEND_ONLY[table] ?? [];
      expect(outcome).toEqual(
        Object.fromEntries(
          columns.map(({ name }) => [name, allowed.includes(name) ? "ok" : DENIED]),
        ),
      );
      expect(Object.values(outcome).filter((state) => state === "ok")).toHaveLength(allowed.length);
      expect(await query(app, `SELECT id FROM ${table} WHERE id = ${idOf(table)}`)).toHaveLength(1);
    },
  );

  it("例外列真的写得进去，写第二次被触发器拒（23001）：两道各管各的", async () => {
    const write = (table: string, set: string) =>
      sqlState(exec(app, `UPDATE ${table} SET ${set} WHERE id = ${idOf(table)}`));
    // 出站事件：展开后写一次 published_at
    expect(await write("outbox_event", "published_at = now()")).toBe("ok");
    expect(await write("outbox_event", "published_at = now() + interval '1 hour'")).toBe(
      RESTRICTED,
    );
    // 下载日志：端上回执两列
    expect(
      await write("delivery_download_log", "client_ack = 'saved', client_ack_at = now()"),
    ).toBe("ok");
    expect(await write("delivery_download_log", "client_ack = 'failed'")).toBe(RESTRICTED);
    // 受控财务配置：批准时写一次生效时间
    expect(await write("finance_config_revision", "effective_at = now()")).toBe("ok");
    expect(await write("finance_config_revision", "effective_at = now() + interval '1 day'")).toBe(
      RESTRICTED,
    );
    // 参数值：生效前撤销
    expect(await write("param_value", "cancelled_at = now()")).toBe("ok");
    expect(await write("param_value", "cancelled_at = now() - interval '1 hour'")).toBe(RESTRICTED);
    // 改派记录：先重算联系截止时间，再标“已联系”（标记人是真实存在的员工行）；标完之后联系相关的列冻结
    expect(
      await write(
        "assignment_history",
        `contact_due_at = contact_due_at + interval '1 day', sla_snapshot = '{"v":2}', updated_at = now()`,
      ),
    ).toBe("ok");
    expect(
      await write(
        "assignment_history",
        `contacted_at = now(), contacted_by_staff_id = ${idOf("staff")}, updated_at = now()`,
      ),
    ).toBe("ok");
    expect(await write("assignment_history", "contact_voided_at = now()")).toBe(RESTRICTED);
  });
});

describe("触发器那一道还在：表的属主也改不了、删不了（任务书 第 7 节第 4 条）", () => {
  /** 属主跑一句：被触发器拒（23001），报错里点的是这张表（行级触发器在分区表上报的是行所在的子表） */
  async function expectTrigger(table: string, sql: string, what: string): Promise<void> {
    const named = what === "" && table === "analytics_event" ? `${table}_y\\d{4}m\\d{2}` : table;
    const { code, message } = await dbError(exec(owner, sql));
    expect({ code, message }).toEqual({
      code: RESTRICTED,
      message: expect.stringMatching(new RegExp(`^table ${named}[ :].*${what}`)),
    });
  }
  // 清空带 CASCADE：被外键引用的表不带它的话，数据库自己先拒（0A000），轮不到触发器。带上之后先触发的是这张表自己的触发器
  const truncate = (table: string) =>
    expectTrigger(table, `TRUNCATE ${table} CASCADE`, "TRUNCATE not allowed");

  it.each(Object.keys(APPEND_ONLY).filter((table) => table !== "auth_event"))(
    "%s：属主 UPDATE、DELETE、TRUNCATE 被触发器拒（23001）",
    async (table) => {
      const where = `WHERE id = ${idOf(table)}`;
      await expectTrigger(table, `UPDATE ${table} SET id = gen_random_uuid() ${where}`, "");
      await truncate(table);
      await expectTrigger(table, `DELETE FROM ${table} ${where}`, "");
      expect(await query(owner, `SELECT id FROM ${table} ${where}`)).toHaveLength(1);
    },
  );

  it("auth_event：属主 UPDATE、TRUNCATE 被触发器拒（23001）；DELETE 没有触发器，属主删得掉", async () => {
    const where = `WHERE id = ${idOf("auth_event")}`;
    await expectTrigger("auth_event", `UPDATE auth_event SET id = gen_random_uuid() ${where}`, "");
    await truncate("auth_event");
    // 事实：auth_event 的 DELETE 没有触发器（清理函数要用它删，03 分组 第 2.11 节）。拦应用的只有权限那一道
    // （上一组里 lyx_app 的 DELETE 报 42501）。这里以属主的身份在事务里删掉这一行再回滚，把这一点钉住
    const deleted = await sqlState(() =>
      owner.$transaction(async (tx) => {
        expect(await tx.$executeRawUnsafe(`DELETE FROM auth_event ${where}`)).toBe(1);
        throw new Error("回滚");
      }),
    );
    expect(deleted).toContain("回滚");
    expect(await query(owner, `SELECT id FROM auth_event ${where}`)).toHaveLength(1);
  });

  it("file_object：属主 DELETE、TRUNCATE 被触发器拒（23001）", async () => {
    const where = `WHERE id = ${idOf("file_object")}`;
    await expectTrigger("file_object", `DELETE FROM file_object ${where}`, "DELETE not allowed");
    await truncate("file_object");
    expect(await query(owner, `SELECT id FROM file_object ${where}`)).toHaveLength(1);
  });
});

describe("file_object（任务书 第 7 节第 5 条）", () => {
  it("lyx_app：INSERT、SELECT、UPDATE 可用，DELETE、TRUNCATE 被拒（42501）", async () => {
    const where = `WHERE id = ${idOf("file_object")}`;
    expect(await query(app, `SELECT id FROM file_object ${where}`)).toHaveLength(1);
    expect(
      await app.$executeRawUnsafe(`UPDATE file_object SET original_name = 'a.txt' ${where}`),
    ).toBe(1);
    expect(await sqlState(exec(app, `DELETE FROM file_object ${where}`))).toBe(DENIED);
    expect(await sqlState(exec(app, "TRUNCATE file_object"))).toBe(DENIED);
    expect(await sqlState(exec(app, "TRUNCATE file_object CASCADE"))).toBe(DENIED);
  });
});

describe("授权没有漏表（任务书 第 7 节第 6 条）", () => {
  it("期望清单自洽：166 张表；16 张只增表都只有 INSERT、SELECT；例外列所在的表没有表级 UPDATE", () => {
    expect(Object.keys(TABLE_PRIVILEGES)).toHaveLength(166);
    expect(EXPECTED.appendOnly).toHaveLength(16);
    expect(EXPECTED.appendOnly.map((table) => TABLE_PRIVILEGES[table])).toEqual(
      EXPECTED.appendOnly.map(() => "INSERT,SELECT"),
    );
    for (const table of Object.keys(EXPECTED.columnUpdate)) {
      expect(TABLE_PRIVILEGES[table], table).toBeDefined();
      expect(TABLE_PRIVILEGES[table], table).not.toContain("UPDATE");
    }
    // 权限集合的写法：四种权限按字母序、逗号连接，SELECT 与 INSERT 每张表都有
    for (const [table, privileges] of Object.entries(TABLE_PRIVILEGES)) {
      expect(privileges, table).toMatch(/^(DELETE,)?INSERT,SELECT(,UPDATE)?$/);
    }
  });

  it("166 张逻辑表逐张：lyx_app 的表级权限等于清单；分区子表与 _prisma_migrations 上没有", async () => {
    const actual = await query<{ name: string; part: boolean; privileges: string }>(
      owner,
      `select c.relname::text as name, c.relispartition as part,
              coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                          from aclexplode(c.relacl) a where a.grantee = 'lyx_app'::regrole), '') as privileges
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
    );
    const others = actual.filter((row) => row.part || row.name === "_prisma_migrations");
    expect(others.map((row) => row.name).sort()).toEqual(
      expect.arrayContaining(["_prisma_migrations", "analytics_event_default"]),
    );
    expect(others.filter((row) => row.privileges !== "")).toEqual([]);
    const logical = actual.filter((row) => !others.includes(row));
    // 库里多出一张表而清单里没有、清单里有而库里没有、权限集合不同：都在这一句红，并指到是哪张表
    expect(Object.fromEntries(logical.map((row) => [row.name, row.privileges]))).toEqual(
      TABLE_PRIVILEGES,
    );
  });

  it("列级授权只有清单里的 11 列 UPDATE；PUBLIC 在表、列、序列上什么都没有", async () => {
    const columns = await query<{ entry: string }>(
      owner,
      `select c.relname || '.' || a.attname || ' ' || x.grantee::regrole || ' ' || x.privilege_type as entry
         from pg_attribute a join pg_class c on c.oid = a.attrelid, aclexplode(a.attacl) x
        where c.relnamespace = 'public'::regnamespace order by 1`,
    );
    const expected = Object.entries(EXPECTED.columnUpdate)
      .flatMap(([table, list]) => list.map((column) => `${table}.${column} lyx_app UPDATE`))
      .sort();
    expect(expected).toHaveLength(11);
    expect(columns.map((row) => row.entry)).toEqual(expected);
    const toPublic = await query(
      owner,
      `select c.relname::text from pg_class c, aclexplode(c.relacl) x
        where c.relnamespace = 'public'::regnamespace and x.grantee = 0`,
    );
    expect(toPublic).toEqual([]);
  });

  it("14 个自增列都取到了号；序列上 lyx_app 只有 USAGE，恰是这 14 个加 audit_no_seq", async () => {
    const owned = await query<{ col: string; seq: string }>(
      owner,
      `select d.refobjid::regclass || '.' || a.attname as col, s.relname::text as seq
         from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
         join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
        where s.relnamespace = 'public'::regnamespace and s.relkind = 'S'`,
    );
    expect(owned.map((row) => row.col).sort()).toEqual(SERIAL_COLUMNS);
    for (const pair of SERIAL_COLUMNS) {
      const [table = "", column = ""] = pair.split(".");
      expect(Number(rows[table]?.[column]), pair).toBeGreaterThanOrEqual(1);
    }
    // 审计编号由插入触发器取 audit_no_seq 生成：夹具行是 lyx_app 在缺省模式下插的
    expect(rows.audit_log?.log_no).toMatch(/^RZ\d{8}\d{5,}$/);
    const granted = await query<{ seq: string; privileges: string }>(
      owner,
      `select c.relname::text as seq, string_agg(x.privilege_type, ',' order by x.privilege_type) as privileges
         from pg_class c, aclexplode(c.relacl) x
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and x.grantee = 'lyx_app'::regrole
        group by 1 order by 1`,
    );
    expect(granted).toEqual(
      [...owned.map((row) => row.seq), "audit_no_seq"]
        .sort()
        .map((seq) => ({ seq, privileges: "USAGE" })),
    );
    expect(await sqlState(exec(app, "select setval('audit_no_seq', 1)"))).toBe(DENIED);
  });

  it("模式与库：两个角色在 public 上只有 USAGE、没有 CREATE，库上没有 CREATE", async () => {
    // 授权里写明的：GRANT CREATE ON SCHEMA public TO lyx_app 之类在这一句红
    const granted = await query<{ role: string; privilege: string }>(
      owner,
      `select x.grantee::regrole::text as role, x.privilege_type::text as privilege
         from pg_namespace n, aclexplode(n.nspacl) x
        where n.nspname = 'public' and x.grantee in ('lyx_app'::regrole, 'lyx_readonly'::regrole)
        order by 1, 2`,
    );
    expect(granted).toEqual([
      { role: "lyx_app", privilege: "USAGE" },
      { role: "lyx_readonly", privilege: "USAGE" },
    ]);
    // 实际生效的（连同经 PUBLIC 得到的）
    const effective = await query(
      owner,
      `select r::text as role, has_schema_privilege(r, 'public', 'USAGE') as usage,
              has_schema_privilege(r, 'public', 'CREATE') as schema_create,
              has_database_privilege(r, current_database(), 'CREATE') as database_create
         from unnest(array['lyx_app', 'lyx_readonly']) r order by 1`,
    );
    expect(effective).toEqual(
      ["lyx_app", "lyx_readonly"].map((role) => ({
        role,
        usage: true,
        schema_create: false,
        database_create: false,
      })),
    );
    expect(await sqlState(exec(app, "CREATE TABLE lyx_grants_probe (id integer)"))).toBe(DENIED);
  });

  it("没有带转授权的授权（WITH GRANT OPTION）：表、列、序列、函数、模式、库上都没有", async () => {
    const grantable = await query<{ entry: string }>(
      owner,
      `select e.kind || ' ' || e.name || ' ' || e.grantee::regrole || ' ' || e.privilege_type as entry
         from (
           select 'relation' as kind, c.relname::text as name, x.grantee, x.privilege_type, x.is_grantable
             from pg_class c, aclexplode(c.relacl) x where c.relnamespace = 'public'::regnamespace
           union all
           select 'column', c.relname || '.' || a.attname, x.grantee, x.privilege_type, x.is_grantable
             from pg_attribute a join pg_class c on c.oid = a.attrelid, aclexplode(a.attacl) x
            where c.relnamespace = 'public'::regnamespace
           union all
           select 'function', p.oid::regprocedure::text, x.grantee, x.privilege_type, x.is_grantable
             from pg_proc p, aclexplode(p.proacl) x where p.pronamespace = 'public'::regnamespace
           union all
           select 'schema', n.nspname::text, x.grantee, x.privilege_type, x.is_grantable
             from pg_namespace n, aclexplode(n.nspacl) x where n.nspname = 'public'
           union all
           select 'database', d.datname::text, x.grantee, x.privilege_type, x.is_grantable
             from pg_database d, aclexplode(d.datacl) x where d.datname = current_database()
         ) e
        where e.is_grantable order by 1`,
    );
    expect(grantable).toEqual([]);
  });

  it("以属主身份执行的函数恰是清单里的几个：PUBLIC 不能执行，能执行的角色与清单相同", async () => {
    const definers = await query<{ name: string; who: string }>(
      owner,
      `select p.proname::text as name,
              (select coalesce(string_agg(g, ',' order by g), '')
                 from unnest(array['lyx_app', 'lyx_readonly', 'public']) g
                where has_function_privilege(g, p.oid, 'EXECUTE')) as who
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef order by 1`,
    );
    expect(definers).toEqual(
      Object.entries(EXPECTED.definerFunctions)
        .map(([name, roles]) => ({ name, who: [...roles].sort().join(",") }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
});

describe("清理函数 lyx_03_purge_auth_event（任务书 第 7 节第 7 条）", () => {
  it("lyx_app 能调用，只删得掉 12 个月以前的；传 12 个月以内的时间被拒；lyx_readonly 与 PUBLIC 不能调用", async () => {
    const old = await insert(app, "auth_event", {
      created_at: "now() - interval '13 months'",
      space: "'staff'",
      event: "'logout'",
    });
    const purge = (client: PrismaClient, before: string) => () =>
      query<{ n: bigint }>(client, `select lyx_03_purge_auth_event(${before}) as n`);
    expect(await sqlState(purge(app, "now() - interval '11 months'"))).toBe(RESTRICTED);
    expect(await sqlState(purge(app, "now()"))).toBe(RESTRICTED);
    expect(await sqlState(purge(readonly, "now() - interval '13 months'"))).toBe(DENIED);
    const [result] = await purge(app, "now() - interval '12 months 1 day'")();
    expect(result?.n).toBe(1n);
    const left = await query<{ id: string }>(app, "select id::text from auth_event");
    expect(left.map((row) => row.id)).toEqual([String(rows.auth_event?.id)]);
    expect(left.map((row) => row.id)).not.toContain(String(old.id));
    // 函数以属主身份执行（SECURITY DEFINER）：授权里只有属主与 lyx_app，没有 PUBLIC
    expect(deploys[1]?.acl).toMatch(
      /fn lyx_03_purge_auth_event\(timestamp with time zone\) \{[^=,}]+=X\/[^,}]+,lyx_app=X\/[^,}]+\}/,
    );
  });
});

describe("lyx_readonly 与分区（任务书 第 11 节第 5、7 项）", () => {
  it("全部表与序列只读，含分区子表与 _prisma_migrations；一句也写不进去", async () => {
    const relations = await query<{ name: string; kind: string; privileges: string }>(
      owner,
      `select c.relname::text as name, c.relkind::text as kind,
              coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                          from aclexplode(c.relacl) a where a.grantee = 'lyx_readonly'::regrole), '') as privileges
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'S')`,
    );
    expect(relations.filter((row) => row.kind !== "S")).toHaveLength(166 + 5 + 1);
    expect(relations.filter((row) => row.kind === "S")).toHaveLength(15);
    expect(relations.filter((row) => row.privileges !== "SELECT")).toEqual([]);
    expect(await query(readonly, "select count(*)::int as n from _prisma_migrations")).toEqual([
      { n: MIGRATIONS.length },
    ]);
    expect(await query(readonly, "select count(*)::int as n from analytics_event_default")).toEqual(
      [{ n: 0 }],
    );
    expect(await query(readonly, "select last_value from audit_no_seq")).toHaveLength(1);
    const audit = `WHERE id = ${idOf("audit_log")}`;
    expect(await query(readonly, `SELECT id FROM audit_log ${audit}`)).toHaveLength(1);
    expect(
      await sqlState(() => insert(readonly, "auth_event", FIXTURES.auth_event?.values ?? {})),
    ).toBe(DENIED);
    expect(await sqlState(exec(readonly, "UPDATE store SET id = id"))).toBe(DENIED);
    expect(await sqlState(exec(readonly, "DELETE FROM timer"))).toBe(DENIED);
    expect(await sqlState(exec(readonly, "select nextval('audit_no_seq')"))).toBe(DENIED);
  });

  it("属主新建一个月的分区：lyx_app 经父表写得进、不能直接碰子表；lyx_readonly 自动读得到；lyx_app 自己建不了分区", async () => {
    const [made] = await query<{ part: string }>(
      owner,
      "select lyx_14_analytics_event_ensure_partition('2031-03-01') as part",
    );
    expect(made?.part).toBe("analytics_event_y2031m03");
    const event = await insert(app, "analytics_event", {
      ...FIXTURES.analytics_event?.values,
      occurred_at: "'2031-03-15T00:00:00Z'",
    });
    expect(
      await query(
        app,
        `select tableoid::regclass::text as part from analytics_event where id = '${String(event.id)}'`,
      ),
    ).toEqual([{ part: "analytics_event_y2031m03" }]);
    expect(await sqlState(exec(app, "select 1 from analytics_event_y2031m03"))).toBe(DENIED);
    expect(
      await query(readonly, "select count(*)::int as n from analytics_event_y2031m03"),
    ).toEqual([{ n: 1 }]);
    // 14 分组 第 2.9 节的周期任务要建分区：应用角色不是父表的属主，建不了（见本包的 ADR）
    expect(
      await sqlState(exec(app, "select lyx_14_analytics_event_ensure_partition('2031-04-01')")),
    ).toBe(DENIED);
  });
});

describe("生成的客户端以 lyx_app 身份读写（本包 ADR 的实验，固化成用例）", () => {
  it("分区表（复合主键）：create、按复合主键 findUnique、count、createMany 去重都正常；改与删被拒", async () => {
    const key = { occurredAt: new Date("2031-03-20T08:00:00.000Z"), id: randomUUID() };
    const data = {
      ...key,
      eventId: `srv-${key.id}`,
      name: "app_launch",
      source: "direct",
      actorType: "system",
    };
    const created = await app.analyticsEvent.create({ data });
    expect(created).toMatchObject({ ...key, props: {} });
    expect(await app.analyticsEvent.findUnique({ where: { occurredAt_id: key } })).toMatchObject(
      key,
    );
    expect(
      await app.analyticsEvent.count({ where: { name: "app_launch" } }),
    ).toBeGreaterThanOrEqual(2);
    // skipDuplicates 生成 ON CONFLICT DO NOTHING：只要 INSERT 权限
    expect(await app.analyticsEvent.createMany({ data: [data], skipDuplicates: true })).toEqual({
      count: 0,
    });
    expect(await sqlState(() => app.analyticsEvent.create({ data }))).toBe("23505");
    const where = { occurredAt_id: key };
    expect(await sqlState(() => app.analyticsEvent.update({ where, data: { name: "x_y" } }))).toBe(
      DENIED,
    );
    expect(await sqlState(() => app.analyticsEvent.delete({ where }))).toBe(DENIED);
    // upsert 在只增表上用不了：冲突时要走 UPDATE
    expect(
      await sqlState(() =>
        app.analyticsEvent.upsert({ where, create: data, update: { name: "x_y" } }),
      ),
    ).toBe(DENIED);
  });

  it("部分唯一索引：撞上时 create 报 23505、createMany 去重跳过；按它做冲突目标要用原始语句", async () => {
    // uq_param_value_key_effective_at：(key, effective_at) WHERE cancelled_at IS NULL。schema.prisma 里没有它
    const at = new Date("2031-01-01T00:00:00.000Z");
    const row = () => ({
      id: randomUUID(),
      key: "grants.partial",
      value: 1,
      effectiveAt: at,
      createdByStaffId: randomUUID(),
      createdAt: new Date(),
    });
    await app.paramValue.create({ data: row() });
    expect(await sqlState(() => app.paramValue.create({ data: row() }))).toBe("23505");
    expect(await app.paramValue.createMany({ data: [row()], skipDuplicates: true })).toEqual({
      count: 0,
    });
    // 指明冲突目标（带谓词）只能写原始语句；客户端的 where 唯一条件里也没有这一组列，查找用 findFirst
    const again = row();
    const inserted = await app.$executeRaw`
      INSERT INTO param_value (id, key, value, effective_at, created_by_staff_id, created_at)
      VALUES (${again.id}::uuid, ${again.key}, '1'::jsonb, ${at}, ${again.createdByStaffId}::uuid, now())
      ON CONFLICT (key, effective_at) WHERE cancelled_at IS NULL DO NOTHING`;
    expect(inserted).toBe(0);
    const current = await app.paramValue.findFirst({
      where: { key: "grants.partial", effectiveAt: at, cancelledAt: null },
    });
    expect(current?.seq).toBeTypeOf("bigint");
  });

  it("例外列用 update 写：客户端只把 data 里给的列写进 SET，带上别的列就被拒", async () => {
    const created = await app.outboxEvent.create({
      data: {
        id: randomUUID(),
        eventType: "lyx.grants_test",
        payload: { v: 1 },
        actorType: "system",
        occurredAt: new Date(),
      },
    });
    const where = { id: created.id };
    const publishedAt = new Date("2031-01-01T00:00:00.000Z");
    expect(await app.outboxEvent.update({ where, data: { publishedAt } })).toMatchObject({
      id: created.id,
      publishedAt,
    });
    const both = { publishedAt, requestId: "r-1" };
    expect(await sqlState(() => app.outboxEvent.update({ where, data: both }))).toBe(DENIED);
  });
});
