import { createHash } from "node:crypto";

import { ACTOR_TYPE, AUDIT_LOG_CLIENT, CLIENT, MERCHANT_ROLE } from "@liyoxi/contract/enums";
import type { ActorType, Client, MerchantRole } from "@liyoxi/contract/enums";
import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../testing/index.js";
import { actorColumns, actorKey, createActor, createIdentityContext } from "./actor.js";
import type { Actor, ActorClient, ActorInput, MerchantActor, SystemActor } from "./actor.js";
import { uuidv7 } from "./ids.js";
import { createTxRunner } from "./tx.js";

// 验收第 9 条：取值集合等于契约枚举；actor_key 形如 <类型>:<id>；
// system 带操作人 id 或客户端来源、非 merchant 带角色快照，构造失败。

// 类型上的取值集合与契约一致：哪一个不相等，这一行就编译不过（pnpm typecheck）
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameAsContract: [
  Same<Actor["type"], ActorType>,
  Same<ActorClient, Client | "cli">,
  Same<NonNullable<MerchantActor["role"]>, MerchantRole>,
] = [true, true, true];

const id = uuidv7();
const merchant = (extra: Partial<ActorInput> = {}): ActorInput => ({
  type: "merchant",
  id,
  client: "weapp",
  ...extra,
});
const system = (extra: Partial<ActorInput> = {}): ActorInput => ({
  type: "system",
  job: "timers.scan",
  ...extra,
});

describe("createActor：取值集合等于契约枚举", () => {
  it("类型上一致（编译期）", () => {
    expect(sameAsContract).toEqual([true, true, true]);
  });

  it("操作人类型：契约里的每一个都构造得出来，之外的拒绝", () => {
    for (const type of ACTOR_TYPE.values) {
      const actor = createActor(type === "system" ? system() : { type, id, client: "admin" });
      expect(actor.type).toBe(type);
    }
    // portal 是客户端来源，不是操作人类型
    expect(() => createActor({ type: "portal" as ActorType, id, client: "portal" })).toThrow(
      /操作人类型只能是/,
    );
  });

  it("客户端来源：契约的 client 加审计日志的 cli，之外的拒绝", () => {
    expect([...CLIENT.values, "cli"]).toEqual([...AUDIT_LOG_CLIENT.values]);
    for (const client of AUDIT_LOG_CLIENT.values) {
      expect(createActor({ type: "staff", id, client }).client).toBe(client);
    }
    expect(() => createActor(merchant({ client: "h5" as ActorClient }))).toThrow(
      /客户端来源只能是/,
    );
  });

  it("角色快照：契约的 merchant_role，之外的拒绝", () => {
    for (const role of MERCHANT_ROLE.values)
      expect(createActor(merchant({ role })).role).toBe(role);
    expect(createActor(merchant()).role).toBeNull();
    expect(() => createActor(merchant({ role: "admin" as MerchantRole }))).toThrow(
      /角色快照只能是/,
    );
  });
});

describe("createActor：不合法的组合构造失败", () => {
  it.each([
    ["system 带操作人 id", system({ id })],
    ["system 带客户端来源", system({ client: "admin" })],
    ["system 带角色快照", system({ role: "owner" })],
    ["system 没有任务名", { type: "system" }],
    ["system 的任务名带空白", system({ job: "timers scan" })],
    ["staff 带角色快照", { type: "staff", id, client: "admin", role: "owner" }],
    ["partner 带角色快照", { type: "partner", id, client: "admin", role: "clerk" }],
    ["merchant 没有操作人 id", { type: "merchant", client: "weapp" }],
    ["staff 的操作人 id 不是 UUID", { type: "staff", id: "42", client: "admin" }],
    ["merchant 没有客户端来源", { type: "merchant", id }],
    ["staff 带任务名", { type: "staff", id, client: "admin", job: "timers.scan" }],
  ] as Array<[string, ActorInput]>)("%s", (_name, input) => {
    expect(() => createActor(input)).toThrow(TypeError);
  });

  it("构造出来的对象是冻结的", () => {
    const actor = createActor(merchant({ role: "owner" }));
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => Object.assign(actor, { type: "staff" })).toThrow(TypeError);
  });
});

describe("actor_key 与操作人三列", () => {
  const KEY = new RegExp(`^(${ACTOR_TYPE.values.join("|")}):.+$`);

  it("actor_key 形如 <类型>:<id>；系统动作的键段取任务名", () => {
    expect(actorKey(createActor(merchant()))).toBe(`merchant:${id}`);
    expect(actorKey(createActor({ type: "staff", id, client: "cli" }))).toBe(`staff:${id}`);
    expect(actorKey(createActor(system()))).toBe("system:timers.scan");
    for (const type of ACTOR_TYPE.values) {
      const actor = createActor(type === "system" ? system() : { type, id, client: "admin" });
      expect(actorKey(actor)).toMatch(KEY);
    }
  });

  it("三列：系统动作的 id 与来源为空；cli 只进审计日志，别的表写空", () => {
    expect(actorColumns(createActor(merchant({ client: "portal" })))).toEqual({
      actorType: "merchant",
      actorId: id,
      client: "portal",
    });
    expect(actorColumns(createActor({ type: "staff", id, client: "cli" }))).toEqual({
      actorType: "staff",
      actorId: id,
      client: null,
    });
    expect(actorColumns(createActor(system()))).toEqual({
      actorType: "system",
      actorId: null,
      client: null,
    });
  });
});

describe("createIdentityContext", () => {
  it("带上操作人、归属与请求元信息；没给的是空", () => {
    const entityId = uuidv7();
    const storeId = uuidv7();
    const context = createIdentityContext({
      actor: merchant({ role: "clerk" }),
      entityId,
      storeId,
      requestId: "req-1",
      ip: "203.0.113.7",
      userAgent: "wechat-devtools",
    });
    expect(context).toEqual({
      actor: { type: "merchant", id, client: "weapp", role: "clerk" },
      entityId,
      storeId,
      requestId: "req-1",
      ip: "203.0.113.7",
      userAgent: "wechat-devtools",
    });
    expect(Object.isFrozen(context)).toBe(true);
    const job = createIdentityContext({ actor: system() });
    expect((job.actor as SystemActor).job).toBe("timers.scan");
    expect(job).toMatchObject({ entityId: null, storeId: null, requestId: null, ip: null });
  });

  it("有门店必有主体；归属要是 UUID；操作人不合法同样拒绝", () => {
    expect(() => createIdentityContext({ actor: merchant(), storeId: uuidv7() })).toThrow(
      /有门店必有主体/,
    );
    expect(() => createIdentityContext({ actor: merchant(), entityId: "1" })).toThrow(TypeError);
    expect(() => createIdentityContext({ actor: system({ id }) })).toThrow(/系统动作没有操作人 id/);
  });
});

describe("构造出来的操作人，库里的 CHECK 都收", () => {
  const db = useTestDatabase("services");

  it("三列加角色快照写进 outbox_event，actor_key 写进 idempotency_record", async () => {
    const prisma = await db.prisma();
    const tx = createTxRunner({ prisma, appEnv: "test" });
    const actors = [
      createActor(merchant({ role: "owner" })),
      createActor(merchant({ client: "portal" })),
      createActor({ type: "staff", id, client: "admin" }),
      createActor({ type: "staff", id, client: "cli" }),
      createActor({ type: "partner", id, client: "admin" }),
      createActor(system()),
    ];
    const at = new Date("2026-01-05T04:00:00.000Z");
    await tx.run(async (handle) => {
      for (const actor of actors) {
        await handle.outboxEvent.create({
          data: {
            id: uuidv7(),
            eventType: "kernel.actor_probe",
            payload: { v: 1 },
            ...actorColumns(actor),
            actorRole: actor.role,
            occurredAt: at,
          },
        });
        await handle.idempotencyRecord.create({
          data: {
            scope: "kernel.actorProbe",
            actorKey: actorKey(actor),
            key: `probe:${uuidv7()}`,
            requestHash: createHash("sha256").update(actorKey(actor)).digest("hex"),
            state: "done",
            expiresAt: new Date(at.getTime() + 86_400_000),
            createdAt: at,
          },
        });
      }
    });
    expect(await prisma.outboxEvent.count()).toBe(actors.length);
  }, 120_000);
});
