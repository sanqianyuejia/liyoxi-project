// 假 Provider 支架（W0-25）：在 W0-19 的十二个替身之上，一次装好，并把十二个替身的调用合成一条时间线。
//
//   const harness = createProviderHarness({ clock });
//   const deps = { tx, clock, providers: harness.providers };        // 要 Providers 的地方传 harness.providers
//   await someUseCase(deps, input);
//   harness.assertCalls(["wechat.checkText", "sms.sendActivationCode"]);   // 调了哪些、什么顺序
//   expect(harness.lastCall("sms.sendActivationCode")?.input).toMatchObject({ phone: "13800135678" });
//   harness.providers.sms.failNext("sendActivationCode");             // 各替身自己的编排入口照旧
//
// 比直接用 createFakeProviders 多两样：
//   1. 事务里外呼即抛错：每次外呼先过 kernel 的 assertNotInTransaction（硬性规则 9）。
//      （createFakeProviders 自己的外呼前钩子从 KF-1 起缺省也查这一条；这里关掉它的，由本支架在记时间线之前查。）
//   2. 一条时间线：十二个替身各记各的调用，时钟不拨时分不出先后；这里按发生的先后统一编号。
// 纯内存，很轻：每条用例建一个新的，替身里的状态（发出去的短信、存进去的对象）就不会串到下一条。
import { assertNotInTransaction } from "../../kernel/index.js";
import { PROVIDER_METHODS, PROVIDER_NAMES } from "../../providers/types.js";
import type { ProviderName } from "../../providers/types.js";
import { systemClock } from "../providers/base.js";
import type { FakeClock } from "../providers/base.js";
import { createFakeProviders, tickFakes } from "../providers/index.js";
import type { FakeProviders } from "../providers/index.js";

/** 一次外呼的名字：接口名.方法名，如 sms.sendActivationCode。写错编译不过 */
export type ProviderCallName = {
  [K in ProviderName]: `${K}.${(typeof PROVIDER_METHODS)[K][number]}`;
}[ProviderName];

export interface HarnessCall {
  /** 第几次外呼，从 1 起：十二个替身合在一起数 */
  readonly seq: number;
  readonly name: ProviderCallName;
  readonly provider: ProviderName;
  readonly method: string;
  /** 调用时传的第一个参数（十二个接口的方法都只收一个入参对象） */
  readonly input: unknown;
  /** 发起的时刻，取支架的时钟 */
  readonly at: Date;
}

/** 按接口筛（"sms"），或按方法筛（"sms.sendActivationCode"） */
export type HarnessCallFilter = ProviderName | ProviderCallName;

export interface ProviderHarnessOptions {
  /** 十二个替身与时间线共用的时钟：传可拨时钟 createClock()；不给用系统时间 */
  readonly clock?: FakeClock;
  /** 写 false 时不查“事务里外呼”（只有专门验别处的防线时才关） */
  readonly guardTransaction?: boolean;
}

export interface ProviderHarness {
  /** 十二个替身。它是一份 Providers；失败与延迟注入、预置数据等编排入口都在各替身上 */
  readonly providers: FakeProviders;
  /** 外呼记录，按发生的先后。被拦下的（事务里外呼）不记；注入了失败、延迟的照记 */
  calls(filter?: HarnessCallFilter): readonly HarnessCall[];
  /** 外呼的名字，按先后 */
  callNames(filter?: HarnessCallFilter): ProviderCallName[];
  /** 最后一次外呼 */
  lastCall(filter?: HarnessCallFilter): HarnessCall | undefined;
  /** 断言：发生过的外呼恰好是这些，顺序也相同。不符即抛错，说明里列出实际发生的 */
  assertCalls(expected: readonly ProviderCallName[]): void;
  /** 断言：一次外呼都没有 */
  assertNoCalls(): void;
  /** 放行十二个替身里到点的延迟应答（先拨时钟），返回放行了几个 */
  tick(): number;
  /** 清空时间线，连同十二个替身的调用记录与没用掉的失败、延迟。替身里别的状态不动 */
  reset(): void;
}

export function createProviderHarness(options: ProviderHarnessOptions = {}): ProviderHarness {
  const clock = options.clock ?? systemClock;
  const guard = options.guardTransaction !== false;
  // 替身自己的外呼前钩子关掉：事务里外呼由下面这一层查（要先于记时间线，guardTransaction 也要关得掉）
  const fakes = createFakeProviders({ clock: options.clock, beforeCall: () => {} });
  const timeline: HarnessCall[] = [];

  /** 给一个替身包一层：清单里的方法进入时先查事务、再记一笔，然后调原实现；其余属性原样透传 */
  function recording<K extends ProviderName>(provider: K): FakeProviders[K] {
    const methods: ReadonlySet<string> = new Set(PROVIDER_METHODS[provider]);
    return new Proxy(fakes[provider], {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof property !== "string" || !methods.has(property) || typeof value !== "function") {
          return value;
        }
        // async：事务里外呼的报错与方法自己的失败一样，都从返回的 Promise 里出来（同 W0-19 的外呼前钩子）
        return async (...args: unknown[]): Promise<unknown> => {
          const name = `${provider}.${property}` as ProviderCallName;
          if (guard) assertNotInTransaction(name);
          timeline.push({
            seq: timeline.length + 1,
            name,
            provider,
            method: property,
            input: args[0],
            at: clock.now(),
          });
          return Reflect.apply(value, target, args);
        };
      },
    });
  }

  const providers = { ...fakes };
  // 同一个对象的另一个名字：按接口名逐个换成包好的
  const slots: Record<ProviderName, unknown> = providers;
  for (const name of PROVIDER_NAMES) slots[name] = recording(name);

  const calls = (filter?: HarnessCallFilter): HarnessCall[] =>
    filter === undefined
      ? [...timeline]
      : timeline.filter((call) => call.name === filter || call.provider === filter);
  const callNames = (filter?: HarnessCallFilter): ProviderCallName[] =>
    calls(filter).map((call) => call.name);

  return {
    providers,
    calls,
    callNames,
    lastCall: (filter) => calls(filter).at(-1),
    assertCalls(expected) {
      const actual = callNames();
      if (actual.length === expected.length && actual.every((name, i) => name === expected[i])) {
        return;
      }
      throw new Error(
        `外呼对不上。\n  期望：${expected.join("、") || "（没有）"}\n  实际：${actual.join("、") || "（没有）"}`,
      );
    },
    assertNoCalls() {
      this.assertCalls([]);
    },
    tick: () => tickFakes(fakes),
    reset() {
      timeline.length = 0;
      for (const name of PROVIDER_NAMES) fakes[name].resetCalls();
    },
  };
}
