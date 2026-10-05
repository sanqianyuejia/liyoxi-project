// 进程内循环（W0-23）：按间隔一轮一轮地跑，上一轮没完不起下一轮。依据：x01 第 4.3 节；D7 第 7.6 节。
// 循环只依赖 PostgreSQL，Redis 不可用时照跑。它自己不判断“是不是主”：由租约那边 start、stop。
// lastBeat 是最近一次有进展的时刻（本机单调时钟）：一轮跑完算，处理完一行也算（循环体调 beat）。看门狗只读它。

export interface LoopOptions {
  /** 循环名，取契约的登记 */
  readonly name: string;
  readonly intervalMs: number;
  /** 一轮要做的事；beat 交给循环体，每处理完一行调一次 */
  readonly run: (beat: () => void) => Promise<unknown>;
  /** 一轮抛错时调；不给即丢弃。抛错不停循环，下一轮照常 */
  readonly onError?: (name: string, error: unknown) => void;
  readonly monotonic?: () => number;
}

export interface Loop {
  readonly name: string;
  readonly intervalMs: number;
  /** 在跑没有 */
  readonly running: boolean;
  readonly lastBeat: number;
  /** 立刻跑一轮，之后每隔 intervalMs 一轮 */
  start(): void;
  /** 不再起新的一轮；返回的 Promise 等在途的那一轮结束 */
  stop(): Promise<void>;
  /** 跑一轮；已有一轮在途时等的就是它。用例拿它一步一步推 */
  tick(): Promise<void>;
}

export function createLoop(options: LoopOptions): Loop {
  const { name, intervalMs } = options;
  const monotonic = options.monotonic ?? (() => performance.now());
  let running = false;
  let lastBeat = monotonic();
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  const beat = (): void => void (lastBeat = monotonic());

  const tick = (): Promise<void> => {
    inFlight ??= options
      .run(beat)
      .then(
        () => undefined,
        (error: unknown) => options.onError?.(name, error),
      )
      .finally(() => {
        beat();
        inFlight = undefined;
      });
    return inFlight;
  };
  const cycle = (): void => {
    void tick().then(() => {
      if (running) timer = setTimeout(cycle, intervalMs);
    });
  };

  return {
    name,
    intervalMs,
    get running() {
      return running;
    },
    get lastBeat() {
      return lastBeat;
    },
    start() {
      if (running) return;
      running = true;
      beat();
      cycle();
    },
    async stop() {
      running = false;
      clearTimeout(timer);
      await inFlight;
    },
    tick,
  };
}
