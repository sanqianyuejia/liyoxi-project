// config 读侧共用的类型（W0-18）。
import type { PrismaClient } from "@liyoxi/db";

/**
 * 只读的库句柄：只用到六张配置表的查询。Prisma 客户端与事务句柄都满足它。
 * 读侧不开事务；应用层不直接拿它，由进程装配时传进来（CLAUDE.md 第 6 节规则 5）。
 */
export type ConfigDb = Pick<
  PrismaClient,
  | "dictType"
  | "dictItem"
  | "paramValue"
  | "siteConfigRevision"
  | "featureFlag"
  | "checklistTemplate"
>;

/** 读取时发现的问题：库里的数据与代码里的定义、登记、结构对不上，或 Redis 取不到版本号 */
export type ConfigProblemKind =
  /** 库里的参数键没有定义（config.N17） */
  | "param_unknown_key"
  /** 库里的参数值不合定义（config.N8）：读取时回退到代码默认值 */
  | "param_invalid_value"
  /** 库里的开关键没有登记（config.N19） */
  | "flag_unknown_key"
  /** 开关的值类型、默认值或规则与登记对不上（config.N19）：读取时回退到登记的默认值 */
  | "flag_invalid_row"
  /** 已发布的站点配置不合结构：读取时当作没有 */
  | "site_config_invalid"
  /** 清单模板的条目不合结构：读取时当作没有这个版本 */
  | "checklist_invalid"
  /** Redis 取不到版本号：旧值最多再用 60 秒，之后重读库 */
  | "version_unavailable";

export interface ConfigProblem {
  kind: ConfigProblemKind;
  /** 哪一个：参数键、开关键、配置键、清单编码与版本、命名空间 */
  subject: string;
  /** 说明。不带值：参数值里可能有敏感内容 */
  detail: string;
}

export type ConfigReport = (problem: ConfigProblem) => void;

/** 没有接上日志时的上报出口：一行 console.error（说明里不带参数值） */
export const reportToConsole: ConfigReport = (problem) => {
  console.error(`配置读取：${problem.kind} ${problem.subject}：${problem.detail}`);
};
