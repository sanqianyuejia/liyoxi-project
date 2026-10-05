// 订阅者表（W0-15）：装配结果里登记了处理器的订阅者，对照契约的订阅者登记校验后，按事件名索引。
// 依据：x01 第 2.5 节；计划 第 5.1、9.3 节。名字、所属模块、关键类的唯一来源是契约（W0-09a）；处理器由各模块的 register.ts 登记（W0-07b）。
// 展开只按这份表：契约里有名字、当前装配里还没有处理器的订阅者不建投递行（任务书 第 11 节第 3 项）。
import { SUBSCRIBERS } from "@liyoxi/contract/registry";

import type { Assembly, Collected, SubscriberRegistration } from "../kernel/index.js";
import { TEST_NAME_PREFIX } from "./catalog.js";
import type { EventCatalog } from "./catalog.js";

export interface SubscriberEntry {
  /** 订阅者名，即 outbox_delivery.subscriber */
  readonly name: string;
  readonly module: string;
  /** 关键类：Redis 不可用时由派发循环在进程内直接执行（W0-23 用） */
  readonly critical: boolean;
  readonly events: readonly string[];
  readonly handle: SubscriberRegistration["handle"];
}

export interface SubscriberTable {
  /** 全部订阅者，按名字排序 */
  readonly all: readonly SubscriberEntry[];
  /** 订阅了这个事件的订阅者，按名字排序；没有即空数组 */
  forEvent(eventType: string): readonly SubscriberEntry[];
  get(name: string): SubscriberEntry | undefined;
}

/** 订阅者的登记与契约对不上：进程启动失败，issues 是全部问题 */
export class SubscriberRegistryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `订阅者登记与契约对不上，共 ${issues.length} 处：\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "SubscriberRegistryError";
    this.issues = issues;
  }
}

export function createSubscriberTable(
  subscribers: readonly Collected<SubscriberRegistration>[],
  catalog: EventCatalog,
): SubscriberTable {
  const issues: string[] = [];
  const entries = new Map<string, SubscriberEntry>();
  for (const item of subscribers) {
    const at = `${item.name}（模块 ${item.module}）`;
    if (entries.has(item.name)) issues.push(`${at}：同名重复`);
    const registered = SUBSCRIBERS.find((one) => one.name === item.name);
    if (registered === undefined) {
      if (!(catalog.withTestEvents && item.name.startsWith(TEST_NAME_PREFIX))) {
        issues.push(`${at}：名字不在契约的订阅者登记里（新订阅者先登记，x01 第 6 节 V4）`);
      }
    } else {
      if (registered.module !== item.module) {
        issues.push(`${at}：契约里它属于模块 ${registered.module}`);
      }
      if (item.critical !== undefined && item.critical !== registered.critical) {
        issues.push(`${at}：critical 与契约不一致，契约里是 ${String(registered.critical)}`);
      }
    }
    const unknown = item.events.filter((event) => catalog.get(event) === undefined);
    if (unknown.length > 0) issues.push(`${at}：订阅了事件目录里没有的事件 ${unknown.join("、")}`);
    entries.set(item.name, {
      name: item.name,
      module: item.module,
      critical: registered?.critical ?? item.critical ?? false,
      events: [...item.events],
      handle: item.handle,
    });
  }
  if (issues.length > 0) throw new SubscriberRegistryError(issues);

  const all = [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const byEvent = new Map<string, SubscriberEntry[]>();
  for (const entry of all) {
    for (const event of entry.events) byEvent.set(event, [...(byEvent.get(event) ?? []), entry]);
  }
  return {
    all,
    forEvent: (eventType) => byEvent.get(eventType) ?? [],
    get: (name) => entries.get(name),
  };
}

/** 从装配结果建订阅者表 */
export const subscriberTableOf = (
  assembly: Pick<Assembly, "subscribers">,
  catalog: EventCatalog,
): SubscriberTable => createSubscriberTable(assembly.subscribers, catalog);
