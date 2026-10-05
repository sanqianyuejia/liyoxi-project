// 枚举与库 CHECK 对账的逻辑自测（scripts/enums-check.ts）。这里不连库：喂给它照 pg_get_constraintdef 原文写的约束，
// 看它认不认得出、差异报不报得出。真库上的对账是 pnpm enums:check（CI 的“枚举与库 CHECK 一致”一步）。
import { describe, expect, it } from "vitest";

import { enumCheckOf, enumProblems, type DbCheck } from "../../scripts/enums-check.js";
import { NAME_FORMATS } from "../registry/index.js";

import { defineEnum } from "./index.js";

const check = (
  table: string,
  name: string,
  def: string,
  columns: [string, string][] = [],
): DbCheck => ({
  table,
  name,
  def,
  columns: columns.map(([column, type]) => ({ name: column, type })),
});

// 以下定义照迁移库里的原文抄
const STATE = check(
  "idempotency_record",
  "ck_idempotency_record_state",
  "CHECK ((state = ANY (ARRAY['done'::text, 'in_progress'::text])))",
  [["state", "text"]],
);
const AUDIT_CLIENT = check(
  "audit_log",
  "ck_audit_log_client",
  "CHECK (((client IS NULL) OR (client = ANY (ARRAY['weapp'::text, 'portal'::text, 'admin'::text, 'cli'::text]))))",
  [["client", "text"]],
);
const ROLE = check("invitation", "ck_invitation_role", "CHECK ((role = 'clerk'::text))", [
  ["role", "text"],
]);
const FOLLOW_UP_CLIENT = check(
  "follow_up",
  "ck_follow_up_client",
  "CHECK (((client IS NULL) OR (client = 'admin'::text)))",
  [["client", "text"]],
);
const ROTATION = check(
  "media_info",
  "ck_media_info_rotation",
  "CHECK ((rotation = ANY (ARRAY[0, 90, 180, 270])))",
  [["rotation", "integer"]],
);
const INTENT = check(
  "follow_up",
  "ck_follow_up_intent",
  "CHECK (((intent IS NULL) OR ((intent = ANY (ARRAY['confirmed'::text, 'considering'::text, 'declined'::text])) AND (subject_type = 'subscription_term'::text))))",
  [
    ["subject_type", "text"],
    ["intent", "text"],
  ],
);
const SNAPSHOT = check(
  "ad",
  "ck_ad_pricing_snapshot",
  "CHECK ((jsonb_typeof(pricing_snapshot) = 'object'::text))",
  [["pricing_snapshot", "jsonb"]],
);
const EVENT_TYPE = check(
  "outbox_event",
  "ck_outbox_event_event_type",
  "CHECK ((event_type ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'::text))",
  [["event_type", "text"]],
);
const PARAM_KEY = check(
  "param_value",
  "ck_param_value_key",
  "CHECK (((key ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,5}$'::text) AND (char_length(key) <= 64)))",
  [["key", "text"]],
);

const STATE_ENUM = defineEnum(
  "idempotency_record_state",
  ["idempotency_record.state"],
  ["done", "in_progress"],
);
const PARAM_KEY_FORMAT = {
  column: "param_value.key",
  pattern: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,5}$",
  maxLength: 64,
};

describe("认“列取值集合”形态的 CHECK", () => {
  it("四种写法都认：IN、可空的 IN、单个取值、可空的单个取值", () => {
    expect(enumCheckOf(STATE)).toEqual({
      column: "idempotency_record.state",
      constraint: "ck_idempotency_record_state",
      values: ["done", "in_progress"],
    });
    expect(enumCheckOf(AUDIT_CLIENT)?.values).toEqual(["weapp", "portal", "admin", "cli"]);
    expect(enumCheckOf(ROLE)).toMatchObject({ column: "invitation.role", values: ["clerk"] });
    expect(enumCheckOf(FOLLOW_UP_CLIENT)).toMatchObject({
      column: "follow_up.client",
      values: ["admin"],
    });
  });

  it("取值里的单引号按 SQL 的写法还原", () => {
    const quoted = check("t", "ck_t_c", "CHECK ((c = ANY (ARRAY['it''s'::text, 'b, c'::text])))");
    expect(enumCheckOf(quoted)?.values).toEqual(["it's", "b, c"]);
  });

  it("组合条件、整数集合、jsonb 类型判断、正则都不算", () => {
    for (const other of [INTENT, ROTATION, SNAPSHOT, EVENT_TYPE, PARAM_KEY]) {
      expect(enumCheckOf(other), other.name).toBeNull();
    }
  });
});

describe("对账", () => {
  it("一致：0 差异；不算枚举的只计数", () => {
    const result = enumProblems([STATE, ROTATION, INTENT, SNAPSHOT], [STATE_ENUM], []);
    expect(result.problems).toEqual([]);
    expect(result.dbEnumChecks).toHaveLength(1);
    expect(result.nonText).toEqual(["media_info.rotation（ck_media_info_rotation）"]);
    expect(result.compound).toBe(1);
  });

  it("契约给一个枚举多加一个取值", () => {
    const widened = defineEnum(STATE_ENUM.name, STATE_ENUM.columns, [
      ...STATE_ENUM.values,
      "failed",
    ]);
    expect(enumProblems([STATE], [widened], []).problems).toEqual([
      "idempotency_record.state：契约枚举 idempotency_record_state 有、库的 CHECK（ck_idempotency_record_state）没有的取值：'failed'",
    ]);
  });

  it("库多一个取值；库里有 CHECK 而契约没有枚举；契约绑定了库里没有的列", () => {
    const narrowed = defineEnum(STATE_ENUM.name, STATE_ENUM.columns, ["done"]);
    const orphan = defineEnum("no_such", ["no_such_table.kind"], ["a"]);
    expect(enumProblems([STATE, ROLE], [narrowed, orphan], []).problems).toEqual([
      "idempotency_record.state：库的 CHECK（ck_idempotency_record_state）有、契约枚举 idempotency_record_state 没有的取值：'in_progress'",
      "invitation.role：库里有取值集合 CHECK（ck_invitation_role：'clerk'），契约没有绑定它的枚举",
      "no_such_table.kind：契约枚举 no_such 绑定了它，库里没有这一列的取值集合 CHECK",
    ]);
  });

  it("一列绑了两个枚举；一列有两条取值集合 CHECK", () => {
    const twin = defineEnum("twin", ["idempotency_record.state"], ["done", "in_progress"]);
    const again = { ...STATE, name: "ck_idempotency_record_state_again" };
    expect(enumProblems([STATE, again], [STATE_ENUM, twin], []).problems).toEqual([
      "idempotency_record.state：库里有两条取值集合 CHECK（ck_idempotency_record_state、ck_idempotency_record_state_again），判不出以哪条为准",
      "idempotency_record.state：契约里有两个枚举绑定了它（idempotency_record_state、twin）",
    ]);
  });

  it("看着是取值集合、写法却认不出的：按差异报，不让它漏过去", () => {
    const odd = check(
      "t",
      "ck_t_kind",
      "CHECK ((lower(kind) = ANY (ARRAY['a'::text, 'b'::text])))",
      [["kind", "text"]],
    );
    const { problems } = enumProblems([odd], [], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^t\.kind：约束 ck_t_kind 看着是取值集合，但写法认不出，没有对账：/,
    );
  });
});

describe("名字写法的 CHECK 正则与契约逐字相同", () => {
  it("一致", () => {
    const formats = [NAME_FORMATS.eventType, PARAM_KEY_FORMAT];
    expect(enumProblems([EVENT_TYPE, PARAM_KEY], [], formats).problems).toEqual([]);
  });

  it("正则不同、长度上限不同、库里没有这条 CHECK", () => {
    const formats = [
      { ...NAME_FORMATS.eventType, pattern: "^[a-z]+$" },
      { ...PARAM_KEY_FORMAT, maxLength: 48 },
      NAME_FORMATS.subscriber,
    ];
    expect(enumProblems([EVENT_TYPE, PARAM_KEY], [], formats).problems).toEqual([
      "outbox_event.event_type：写法的正则不一致。库（ck_outbox_event_event_type）：^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$；契约：^[a-z]+$",
      "param_value.key：长度上限不一致。库（ck_param_value_key）：64；契约：48",
      "outbox_delivery.subscriber：库里应恰有一条“subscriber 匹配正则”的 CHECK，找到 0 条",
    ]);
  });
});
