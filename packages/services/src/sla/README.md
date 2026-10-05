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
- 日历的导入、`calendar.imported`、日历修正后的时限重算在 M2 及各域。用例里铺日历用 `@liyoxi/services/testing` 的 `seedWorkCalendar`。

```sh
pnpm --filter @liyoxi/services exec vitest run src/sla/
```
