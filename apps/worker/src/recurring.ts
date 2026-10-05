// 周期任务的汇总入口（W0-23）。依据：x01 第 4.2 节；D7 第 7.6 节；计划 第 5.1、9.3 节。
// 周期任务登记在各模块自己的 register.ts，由组合根收集；只属于别的环境的（envs）在装配时已经滤掉。
// 这里不登记任何任务，只把本进程、本环境生效的那些汇成一张表：启动日志打它，漏跑告警（G2-D）与用例读它。
import type { WorkerServices } from "@liyoxi/services";

type Job = WorkerServices["timers"]["registry"]["recurringJobs"][number];

export interface RecurringEntry {
  readonly kind: string;
  /** 登记它的模块 */
  readonly module: string;
  readonly schedule: Job["schedule"];
  /** tx：在一个事务里做完；job：认领后在事务外执行、按租期续租 */
  readonly mode: "tx" | "job";
  /** 完成期限（分钟）与漏跑级别：没写即不告警 */
  readonly deadlineMin: number | undefined;
  readonly missSeverity: Job["missSeverity"];
  readonly catchUp: boolean;
}

/** 本环境生效的周期任务，按 kind 排序；补登记循环每 60 秒照这张表补一轮 */
export function recurringTable(services: Pick<WorkerServices, "timers">): RecurringEntry[] {
  return services.timers.registry.recurringJobs.map((job) => ({
    kind: job.kind,
    module: job.module,
    schedule: job.schedule,
    mode: job.mode ?? "tx",
    deadlineMin: job.deadlineMin,
    missSeverity: job.missSeverity,
    catchUp: job.catchUp === true,
  }));
}
