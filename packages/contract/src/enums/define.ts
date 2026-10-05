// 枚举的声明形态（06 第 3.2 节：枚举是 text + CHECK，取值的唯一来源在 packages/contract）。
// 纯常量：本目录下除 zod.ts 之外的文件不引任何包，小程序与 shared 经 ./enums 子路径拿到，带不进 Zod 运行时。
// Zod 枚举由这里的常量派生，写在 zod.ts，只从包入口给出。

/** 一个枚举：一组取值，以及库里哪些列用它 */
export interface EnumDef<V extends string = string> {
  /** 枚举名：小写蛇形，全仓唯一 */
  readonly name: string;
  /**
   * 绑定的库列，写成“表.列”。库里这些列各有一条“列取值集合”形态的 CHECK，
   * 它的取值集合须与 values 相等（pnpm enums:check）。
   */
  readonly columns: readonly string[];
  /** 取值。顺序照库里 CHECK 的写法，只用于展示，不表达先后 */
  readonly values: readonly [V, ...V[]];
}

/** 枚举的取值类型：EnumValue<typeof ACTOR_TYPE> 即 "merchant" | "staff" | "system" | "partner" */
export type EnumValue<E extends EnumDef> = E["values"][number];

/**
 * 声明一个枚举。新取值先在这里声明并让读的一方认得，下一版才写入（约定 C37；x01 第 6 节 V4）；
 * 库的 CHECK 随结构变更包同步，两边不一致时 pnpm enums:check 失败。
 */
export function defineEnum<const V extends readonly [string, ...string[]]>(
  name: string,
  columns: readonly string[],
  values: V,
): EnumDef<V[number]> {
  return { name, columns, values };
}
