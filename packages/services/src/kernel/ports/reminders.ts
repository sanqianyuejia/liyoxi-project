// 提醒规则的查询端口（W0-17）。kernel 定义，各领域按规则键 R1–R7 登记，notify.remind_scan（G2-C）调。
// 依据：13 分组 第 5.3 节；D6 第 2.7 节。没有登记的规则查到的是空列表。
import { defineKeyedPort } from "../assembly/index.js";
import type { Assembly } from "../assembly/index.js";
import type { Tx } from "../tx.js";
import { portLog } from "./log.js";

/** 13 分组 第 5.3 节的七条规则 */
export const REMINDER_RULE_KEYS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"] as const;
export type ReminderRuleKey = (typeof REMINDER_RULE_KEYS)[number];

/** 查询条件与提醒对象的形状由登记方按规则定（D6 第 2.7 节的规则契约表），框架只转手 */
export type ReminderQuery = Readonly<Record<string, unknown>>;
export type ReminderTarget = Readonly<Record<string, unknown>>;

export interface ReminderVerdict {
  readonly valid: boolean;
  /** 聚合类规则可给出按当前真相重渲文案用的变量 */
  readonly vars?: Readonly<Record<string, unknown>>;
}

export interface ReminderRule {
  /** 此刻该提醒的对象；只读，按当前真相取 */
  targets(tx: Tx, query: ReminderQuery): Promise<readonly ReminderTarget[]>;
  /** 发送前守卫；不给即一律有效（信息类规则） */
  revalidate?(tx: Tx, target: ReminderTarget): Promise<ReminderVerdict>;
}

/** 按规则键登记：implementKeyed(remindersPort, "R4", { targets, revalidate }) */
export const remindersPort = defineKeyedPort<ReminderRule>("notify.remind");

export interface Reminders {
  has(rule: ReminderRuleKey): boolean;
  /** 规则没有登记即空列表 */
  targets(tx: Tx, rule: ReminderRuleKey, query: ReminderQuery): Promise<readonly ReminderTarget[]>;
  /** 规则没有登记即无效（没人能确认）；登记了但没给守卫即有效 */
  revalidate(tx: Tx, rule: ReminderRuleKey, target: ReminderTarget): Promise<ReminderVerdict>;
}

/** 取提醒端口。登记的键不在 R1–R7 之内即抛错 */
export function remindersOf(assembly: Assembly): Reminders {
  const rules = assembly.portEntries(remindersPort);
  const known: readonly string[] = REMINDER_RULE_KEYS;
  const unknown = [...rules.keys()].filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new Error(`提醒端口登记了不认识的规则键 ${unknown.join("、")}：只有 R1–R7`);
  }
  return {
    has: (rule) => rules.has(rule),
    async targets(tx, rule, query) {
      const found = rules.get(rule);
      if (found !== undefined) return found.targets(tx, query);
      portLog.debug({ port: remindersPort.name, rule }, "提醒规则没有登记：返回空列表");
      return [];
    },
    async revalidate(tx, rule, target) {
      const found = rules.get(rule);
      if (found === undefined) return { valid: false };
      return found.revalidate === undefined ? { valid: true } : found.revalidate(tx, target);
    },
  };
}
