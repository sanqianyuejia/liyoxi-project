// 五个端口的样例实现（W0-17）：把收到的调用记下来，用例据此断言“调了一次告警”“埋点记了什么”。只给测试用。
//
//   const ports = createRecordingPorts();
//   const assembly = assembleForTest({ entry: "worker", extra: [ports.registration] });
//   …… expect(ports.alerts).toHaveLength(1);
import {
  alertsPort,
  defineRegistration,
  implement,
  implementKeyed,
  invariantsPort,
  notifyReadPort,
  remindersPort,
  trackPort,
} from "../kernel/index.js";
import type {
  AlertInput,
  InvariantReport,
  ModuleRegistration,
  NotifyReader,
  ReminderRule,
  ReminderRuleKey,
  Track,
  TrackEvent,
} from "../kernel/index.js";

export interface RecordingPortsOptions {
  /** 样例模块名，缺省 lyxtest_ports */
  readonly module?: string;
  /** 换掉埋点的实现（如先写一行再抛错）；不给即只记下事件 */
  readonly track?: Track["record"];
  /** 要登记的通知场景解析函数：函数名 → 实现 */
  readonly notifyReaders?: Readonly<Record<string, NotifyReader>>;
  /** 要登记的提醒规则：规则键 → 实现 */
  readonly reminders?: Readonly<Partial<Record<ReminderRuleKey, ReminderRule>>>;
}

export interface RecordingPorts {
  /** 交给 assembleForTest 的 extra */
  readonly registration: ModuleRegistration;
  /** 收到的告警，按先后 */
  readonly alerts: AlertInput[];
  /** 收到的不变量上报 */
  readonly reports: InvariantReport[];
  /** 收到的埋点（换了实现时由换上的实现自己记） */
  readonly tracked: TrackEvent[];
}

export function createRecordingPorts(options: RecordingPortsOptions = {}): RecordingPorts {
  const alerts: AlertInput[] = [];
  const reports: InvariantReport[] = [];
  const tracked: TrackEvent[] = [];
  const record: Track["record"] =
    options.track ??
    (async (_tx, event) => {
      tracked.push(event);
    });
  const registration = defineRegistration(options.module ?? "lyxtest_ports", {
    portImplementations: [
      implement(alertsPort, { raise: async (input) => void alerts.push(input) }),
      implement(invariantsPort, { report: async (input) => void reports.push(input) }),
      implement(trackPort, { record }),
      ...Object.entries(options.notifyReaders ?? {}).map(([name, reader]) =>
        implementKeyed(notifyReadPort, name, reader),
      ),
      ...Object.entries(options.reminders ?? {}).map(([rule, impl]) =>
        implementKeyed(remindersPort, rule, impl),
      ),
    ],
  });
  return { registration, alerts, reports, tracked };
}
