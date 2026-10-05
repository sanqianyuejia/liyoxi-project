// 时钟（W0-07）。业务时间只取注入的时钟（01 第 5 节调用规则 4；06 第 3.2 节），业务 SQL 里不写 now()；
// 列默认值、租约这类基础设施除外。测试里注入可拨时钟：@liyoxi/services/testing 的 createClock。

export interface Clock {
  /** 现在几点。每次返回一个新的 Date，改它不影响时钟 */
  now(): Date;
}

/** 系统时钟：生产装配用它 */
export const systemClock: Clock = { now: () => new Date() };
