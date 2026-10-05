// 事件目录（W0-15）：emit 与订阅者校验认的那一份。事件名、聚合、状态取自契约的登记（W0-09a），载荷 schema 取自契约的
// 事件载荷目录；两者之外，测试装配可以追加 lyxtest. 前缀的样例事件（任务书 第 11 节第 8 项），正式目录不受影响。
import { eventPayloadSchema } from "@liyoxi/contract";
import {
  AGGREGATE_TYPES,
  EVENT_NAME_MAX_LENGTH,
  EVENT_NAME_MAX_SEGMENTS,
  EVENT_NAME_MIN_SEGMENTS,
  EVENTS,
  matchesFormat,
  NAME_FORMATS,
} from "@liyoxi/contract/registry";
import type { EventStatus } from "@liyoxi/contract/registry";
import type { ZodType } from "zod";

/** 测试专用的事件名、订阅者名的前缀：只在给了样例事件的目录里认 */
export const TEST_NAME_PREFIX = "lyxtest.";

export interface EventDefinition {
  readonly name: string;
  /** 允许的聚合（最终表名）；空数组即不带聚合 */
  readonly aggregates: readonly string[];
  readonly status: EventStatus;
  /** 载荷 schema；还没交的事件没有，emit 不给发 */
  readonly schema: ZodType | undefined;
}

/** 测试追加的样例事件：名字必须是 lyxtest. 开头，聚合必须是契约登记过的表名 */
export interface TestEventDefinition {
  readonly name: string;
  readonly aggregates?: readonly string[];
  readonly status?: EventStatus;
  readonly schema?: ZodType;
}

export interface EventCatalog {
  get(name: string): EventDefinition | undefined;
  /** 这份目录带不带测试的样例事件：带了才认 lyxtest. 前缀的订阅者名 */
  readonly withTestEvents: boolean;
}

function assertTestEvent(event: TestEventDefinition, taken: ReadonlySet<string>): void {
  const refuse = (reason: string): never => {
    throw new TypeError(`样例事件 ${JSON.stringify(event.name)} 不合规：${reason}`);
  };
  const segments = event.name.split(".").length;
  if (!event.name.startsWith(TEST_NAME_PREFIX)) refuse(`名字要以 ${TEST_NAME_PREFIX} 开头`);
  if (
    !matchesFormat(NAME_FORMATS.eventType, event.name) ||
    event.name.length > EVENT_NAME_MAX_LENGTH ||
    segments < EVENT_NAME_MIN_SEGMENTS ||
    segments > EVENT_NAME_MAX_SEGMENTS
  ) {
    refuse("写法不对：小写点分 2–3 段，全长不超过 64（x01 第 2.1 节 N1）");
  }
  if (taken.has(event.name)) refuse("重名");
  const known: readonly string[] = AGGREGATE_TYPES;
  const unknown = (event.aggregates ?? []).filter((type) => !known.includes(type));
  if (unknown.length > 0) refuse(`聚合 ${unknown.join("、")} 不在契约的登记里`);
}

/** 建事件目录。生产装配不传参数；测试装配传样例事件 */
export function createEventCatalog(testEvents?: readonly TestEventDefinition[]): EventCatalog {
  const definitions = new Map<string, EventDefinition>(
    EVENTS.map((event) => [
      event.name,
      {
        name: event.name,
        aggregates: event.aggregates,
        status: event.status,
        schema: eventPayloadSchema(event.name),
      },
    ]),
  );
  for (const event of testEvents ?? []) {
    assertTestEvent(event, new Set(definitions.keys()));
    definitions.set(event.name, {
      name: event.name,
      aggregates: event.aggregates ?? [],
      status: event.status ?? "v1",
      schema: event.schema,
    });
  }
  return { get: (name) => definitions.get(name), withTestEvents: testEvents !== undefined };
}
