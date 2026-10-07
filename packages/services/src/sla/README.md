# sla：工作日历与时限计算

读 `work_calendar_day` 组成日历，调 `@liyoxi/shared/workcal` 的纯函数算截止时刻，并给出时限快照（W0-17）。依据：[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.7、4 节；D3 第 22.2–22.4 节；[14 分组](../../../../docs/data-model/14-config-data.md) 第 4.2 节。

```ts
const sla = createSla({ assembly, clock }); // 进程启动时建一次

const { dueAt, snapshot } = await sla.dueAt(tx, {
  policy: "review.qualification", // 参数键去掉 sla. 前缀
  amount: 1,
  unit: "work_days",
  from: clock.now(),
  workHours: { start: "09:00", end: "18:00" }, // 参数 work.start、work.end
});
// snapshot = { policy, amount, unit, calendarVersion, computedAt }：存进单据的 sla_snapshot，时限类定时器的 payload 同此
```

- 策略值与工作时段由调用方传入：本模块不读 config。全部按北京时间。
- `calendarVersion` 是计算时全表最大的批次号（表为空记 0）；`computedAt` 取注入的时钟。
- 算的过程用到了库里没有的日期：按“周一至周五工作”兜底，并调一次告警端口（规则键 `sla.calendar_fallback`，P2）；用了兜底的日期在返回值的 `fallbackDates` 里。自然小时、自然日不看日历。
- `sla.workMinutesBetween(tx, { from, to, workHours })`：两个时刻之间的工作分钟数；工作时段由调用方传，日历缺行时告警。
- `flow` 的“工作分钟”端口由本模块实现（W0-30a）：`work-minutes.ts` 的 `calendarWorkMinutes`，在 `register.ts` 里登记，`flow.transition` 写 `elapsed_work_min` 时调它。端口的实现是静态登记的，手里只有迁移的事务句柄，所以与上一条有三处不同：工作时段自己读（`workHoursAt(tx, at)`：经句柄读参数 `work.start`、`work.end` 在那一刻生效的值，不走配置服务的缓存；库里配反了用代码默认值）；整段按写入那一刻的工作时段算；日历缺行照样按“周一至周五工作”兜底，但不告警（拿不到装配结果），缺行由 `sla.N8` 与日历覆盖检查报。用例在 `../flow/work-minutes.calendar.test.ts`。
- `register.ts` 登记了不变量 `sla.N8`：库里最早到最晚的年份之间，缺行的每一天报一条。调度在 W0-24。
- W2-05 经 `createCalendarAdmin` 导入日历并发 `calendar.imported`，approval 订阅后重算决定时限；其他领域的重算仍由所属模块接入。用例里铺日历用 `@liyoxi/services/testing` 的 `seedWorkCalendar`。

```sh
pnpm --filter @liyoxi/services exec vitest run src/sla/
```

## 年度导入与覆盖检查（W2-05）

`createCalendarAdmin({ tx, clock, events })` 提供 `list` 和 `import`，只读不补行。导入逐年铺满自然工作日/周末，再覆盖本批例外日，按日比较 kind；仅 kind 变化升全局 calendarVersion、同事务发 `calendar.imported:{calendarVersion}`。note/source-only 留真实审计而不发事件，相同重复没有日期写入、审计或事件。

内置纯数据仅支持 **2026**，依据 [国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)（国办发明电〔2025〕7号）：七个假期与六个周末调休日。公开官方索引全文已核对，版本不抓取网页、不伪造2027通知。缺内置年份须显式传 days（可以为空）和 source；跨年、重日、平日 adjusted_workday 拒绝。

`lockCalendarImport(tx, mode)` 是本域固定咨询锁：导入排他，SLA 计算/日历重算共享，确保期限和批次取自同一日历事实。预约工时仍按历史时刻读取。只铺 weekday/weekend 底不代表官方安排已导入；年度读侧 importedAt 与 coverage 依据真实导入审计或可证实例外日，故播种2027兜底读为 null，显式 custom days=[] 的真实导入则有时间。

`calendar.coverage_check` 每月一日北京时间10:00以 tx 模式运行；从业务 clock 检查当日起60天缺日，12月1日起再检查下一年实际导入。缺口调 P3 告警端口。`bindCalendarCoverage({ clock, alerts, detach })` 要求真实 kernel 公共 detach 隔离独立告警事务；未装配明确失败。它不放宽存活祖先事务的 Provider 外呼限制；默认 noop 告警只能证明端口调用，真实告警落库/投递由 W2-24 PR2 完成。

导入及覆盖事实用例在 `import.db.test.ts`。审批快照、真实 timer 派发、同态历史和并发用例由 approval/sla.db.test.ts 持有。
