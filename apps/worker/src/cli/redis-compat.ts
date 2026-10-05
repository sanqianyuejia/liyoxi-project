// 托管 Redis 与 BullMQ 的兼容脚本（W0-23；验证项 V1）：pnpm redis:compat [-- 参数]
// 依据：D7 第 7.3 节的 7 项验证清单；05 第 5 节 V1；任务书 第 11 节第 5 项。
// 逐项给出结论（通过、不通过、需人工），写一份 JSON 报告。有“不通过”时以 1 退出，其余以 0 退出。
//
//   连接串只从环境变量 REDIS_COMPAT_URL 读：不落盘、不打印，报错与报告里出现的主机、账号、口令一律抹掉。
//   只动自己的键：前缀 lyx:compat:<随机>:，跑完删掉；不用 FLUSHDB、FLUSHALL、CONFIG、HELLO。
//   参数：
//     --jobs <n>           第 1 项入队并消费多少条，缺省 10000
//     --idle-minutes <n>   第 2 项空闲多久，缺省 60；可以写小数
//     --no-prompt          不停下来等人工操作：第 3、5 项记“需人工”（不是终端时自动如此）
//     --allow-wipe         第 6 项在非本机的实例上也自动做（它只删本脚本自己前缀下的键）
//     --report <路径>      报告写到哪，缺省 apps/worker/dist/redis-compat-report.json
// 这里直接引 bullmq：验的就是它的延迟、退避、限速、优先级，这些 kernel/queue 的封装故意不用。
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

type Verdict = "通过" | "不通过" | "需人工";
interface Item {
  id: number;
  title: string;
  verdict: Verdict;
  detail: string;
}

const { values: args } = parseArgs({
  options: {
    jobs: { type: "string", default: "10000" },
    "idle-minutes": { type: "string", default: "60" },
    "no-prompt": { type: "boolean", default: false },
    "allow-wipe": { type: "boolean", default: false },
    report: { type: "string" },
  },
});
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const rawUrl = process.env.REDIS_COMPAT_URL;
if (!rawUrl) {
  console.error("REDIS_COMPAT_URL 未设置：把要验的 Redis 的连接串放进这个环境变量（不入库）");
  process.exit(2);
}
const target = new URL(rawUrl);
const secrets = [rawUrl, target.host, target.hostname, target.password, target.username]
  .map((one) => decodeURIComponent(one))
  .filter((one) => one.length > 2);
/** 抹掉连接串里的东西：报错文本会带上主机与端口 */
const scrub = (text: unknown): string =>
  secrets.reduce((out, secret) => out.split(secret).join("<已抹去>"), String(text));
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
const interactive = !args["no-prompt"] && process.stdin.isTTY === true;

const prefix = `lyx:compat:${randomBytes(4).toString("hex")}:`;
const bull = `${prefix}bull`;
const connect = (extra: Record<string, unknown> = {}): Redis => {
  const client = new Redis(rawUrl, { maxRetriesPerRequest: null, ...extra });
  client.on("error", () => undefined);
  return client;
};
const admin = connect({ maxRetriesPerRequest: 2 });
const connections: Redis[] = [admin];
const closers: Array<() => Promise<unknown>> = [];
const queueOf = (name: string): Queue => {
  const client = connect({ maxRetriesPerRequest: 2 });
  connections.push(client);
  const queue = new Queue(name, { connection: client, prefix: bull });
  queue.on("error", () => undefined);
  closers.push(() => queue.close());
  return queue;
};
const workerOf = (
  name: string,
  handler: (job: { id?: string; data: unknown; attemptsMade: number }) => Promise<void>,
  options: Record<string, unknown> = {},
): Worker & { redis: Redis } => {
  const redis = connect();
  connections.push(redis);
  const worker = new Worker(name, handler, { connection: redis, prefix: bull, ...options });
  worker.on("error", () => undefined);
  closers.push(() => worker.close(true));
  return Object.assign(worker, { redis });
};
async function until(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}
async function wipeOwnKeys(): Promise<number> {
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await admin.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
    cursor = next;
    const own = keys.filter((key) => key.startsWith(prefix));
    if (own.length > 0) removed += await admin.unlink(...own);
  } while (cursor !== "0");
  return removed;
}
async function ask(question: string): Promise<boolean> {
  if (!interactive) return false;
  const io = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await io.question(`${question}\n  做完后回车继续；输入 s 跳过（记“需人工”）：`);
  io.close();
  return answer.trim().toLowerCase() !== "s";
}

const items: Item[] = [];
async function item(
  id: number,
  title: string,
  run: () => Promise<[Verdict, string]>,
): Promise<void> {
  let verdict: Verdict;
  let detail: string;
  try {
    [verdict, detail] = await run();
  } catch (error) {
    [verdict, detail] = ["不通过", `出错：${scrub((error as Error)?.message ?? error)}`];
  }
  items.push({ id, title, verdict, detail: scrub(detail) });
  say(`[${id}] ${title}：${verdict}。${scrub(detail)}`);
}
const verdictOf = (failures: string[], ok: string): [Verdict, string] =>
  failures.length === 0 ? ["通过", ok] : ["不通过", failures.join("；")];

const total = Math.max(1, Number(args.jobs));
const idleMs = Math.max(0, Number(args["idle-minutes"])) * 60_000;
const startedAt = new Date();
say(`兼容脚本开始：第 1 项 ${total} 条，第 2 项空闲 ${idleMs / 60_000} 分钟，键前缀 ${prefix}`);

await item(1, "BullMQ 基本面", async () => {
  const failures: string[] = [];
  // 入队并消费 total 条
  const bulk = queueOf("bulk");
  let consumed = 0;
  workerOf("bulk", async () => void (consumed += 1), { concurrency: 50 });
  for (let from = 0; from < total; from += 1000) {
    const size = Math.min(1000, total - from);
    await bulk.addBulk(
      Array.from({ length: size }, (_, n) => ({
        name: "job",
        data: { n: from + n },
        opts: { removeOnComplete: true },
      })),
    );
  }
  if (!(await until(() => consumed >= total, 120_000 + total * 20))) {
    failures.push(`入队 ${total} 条只消费了 ${consumed} 条`);
  }
  // 延迟任务、按 jobId 查状态（任务号不能与队列自己的键重名，如 delayed、paused）
  const misc = queueOf("misc");
  const seen: string[] = [];
  let failedOnce = 0;
  const miscWorker = workerOf("misc", async (job) => {
    if (job.id === "job-retry" && job.attemptsMade === 0) {
      failedOnce += 1;
      throw new Error("第一次故意失败");
    }
    seen.push(String(job.id));
  });
  const delayedAt = Date.now();
  await misc.add("job", {}, { jobId: "job-delayed", delay: 1000 });
  const stateWhileDelayed = await (await misc.getJob("job-delayed"))?.getState();
  if (stateWhileDelayed !== "delayed") failures.push(`延迟任务的状态是 ${stateWhileDelayed}`);
  if (!(await until(() => seen.includes("job-delayed"), 15_000)))
    failures.push("延迟任务没有被消费");
  else if (Date.now() - delayedAt < 900) failures.push("延迟任务提前被消费");
  // 指数退避重试
  await misc.add(
    "job",
    {},
    { jobId: "job-retry", attempts: 2, backoff: { type: "exponential", delay: 200 } },
  );
  if (!(await until(() => seen.includes("job-retry"), 15_000)) || failedOnce !== 1) {
    failures.push("失败后的退避重试没有按预期发生");
  }
  if ((await (await misc.getJob("job-retry"))?.getState()) !== "completed") {
    failures.push("按 jobId 查不到已完成的状态");
  }
  // 暂停与恢复、优先级：暂停时入队三条，恢复后按优先级出队
  await miscWorker.close();
  const ordered = queueOf("ordered");
  await ordered.pause();
  await ordered.add("job", {}, { jobId: "p-low", priority: 10 });
  await ordered.add("job", {}, { jobId: "p-high", priority: 1 });
  await ordered.add("job", {}, { jobId: "p-mid", priority: 5 });
  const order: string[] = [];
  workerOf("ordered", async (job) => void order.push(String(job.id)), { concurrency: 1 });
  await sleep(500);
  if (order.length > 0) failures.push("队列暂停时仍有任务被消费");
  await ordered.resume();
  await until(() => order.length === 3, 15_000);
  if (order.join(",") !== "p-high,p-mid,p-low")
    failures.push(`优先级出队次序是 ${order.join(",")}`);
  // 队列级限速：每 500 毫秒至多 2 条，6 条至少要 1 秒
  const limited = queueOf("limited");
  let limitedDone = 0;
  workerOf("limited", async () => void (limitedDone += 1), {
    concurrency: 6,
    limiter: { max: 2, duration: 500 },
  });
  const limitedAt = Date.now();
  await limited.addBulk(Array.from({ length: 6 }, () => ({ name: "job", data: {} })));
  await until(() => limitedDone === 6, 30_000);
  if (limitedDone !== 6) failures.push("限速队列没有消费完");
  else if (Date.now() - limitedAt < 900) failures.push("队列级限速没有生效");
  return verdictOf(
    failures,
    `入队并消费 ${total} 条；延迟、退避重试、限速、优先级、暂停与恢复、按 jobId 查状态都正常`,
  );
});

await item(2, "长时间空闲的阻塞连接", async () => {
  const idle = queueOf("idle");
  let gotAt = 0;
  const worker = workerOf("idle", async () => void (gotAt = Date.now()));
  let closed = 0;
  worker.redis.on("close", () => (closed += 1));
  await worker.waitUntilReady();
  say(`    空转 ${idleMs / 60_000} 分钟……`);
  await sleep(idleMs);
  const sentAt = Date.now();
  await idle.add("job", {});
  const got = await until(() => gotAt > 0, 30_000);
  const failures: string[] = [];
  if (!got) failures.push("空闲之后入队的任务 30 秒内没有被消费");
  else if (gotAt - sentAt > 1000)
    failures.push(`空闲之后入队的任务过了 ${gotAt - sentAt} 毫秒才被消费`);
  if (closed > 0) failures.push(`空闲期间连接断开过 ${closed} 次`);
  return verdictOf(
    failures,
    `空闲 ${idleMs / 60_000} 分钟后入队，${gotAt - sentAt} 毫秒被消费，期间没有断连`,
  );
});

await item(3, "主从切换", async () => {
  const stream = queueOf("failover");
  let done = 0;
  workerOf("failover", async () => void (done += 1));
  const feed = async (count: number): Promise<void> => {
    for (let n = 0; n < count; n += 1) await stream.add("job", {}).catch(() => undefined);
  };
  await feed(20);
  if (!(await ask("第 3 项：请在控制台对这个实例触发一次主从切换。"))) {
    return ["需人工", "要在控制台触发主从切换后再跑：消费者应在 30 秒内自动恢复、没有卡死的任务"];
  }
  const before = done;
  const recovered = await until(async () => {
    await feed(1);
    return done > before;
  }, 30_000);
  await until(async () => (await stream.getActiveCount()) === 0, 30_000);
  const stuck = await stream.getActiveCount();
  const failures = [
    ...(recovered ? [] : ["切换后 30 秒内消费者没有恢复"]),
    ...(stuck === 0 ? [] : [`有 ${stuck} 条任务卡在处理中`]),
  ];
  return verdictOf(failures, "切换后 30 秒内恢复消费，没有卡死的任务");
});

await item(4, "参数与命令", async () => {
  const info = await admin.info();
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:(.*)$`, "m").exec(info)?.[1]?.trim();
  const policy = field("maxmemory_policy");
  const failures = policy === "noeviction" ? [] : [`maxmemory-policy 是 ${policy}，要 noeviction`];
  const facts = `Redis ${field("redis_version")}，${field("redis_mode")} 模式，maxmemory-policy ${policy}`;
  // 前几项没报错即 BullMQ 启动时的 INFO 检查通过；本脚本全程没有用 CONFIG、HELLO
  return verdictOf(failures, `${facts}；INFO 可用，没有用到 CONFIG、HELLO`);
});

await item(5, "写满", async () => {
  await admin.set(`${prefix}sentinel`, "1");
  if (!(await ask("第 5 项：请把这个实例写到内存上限（控制台或压测工具）。"))) {
    return ["需人工", "要把实例写到上限后再跑：写命令应报错而不是淘汰键"];
  }
  const failures: string[] = [];
  const written = await admin.set(`${prefix}probe`, "x".repeat(1024)).then(
    () => true,
    (error: Error) =>
      !/OOM/i.test(error.message) && failures.push(`写命令报的不是 OOM：${error.message}`) < 0,
  );
  if (written) failures.push("写满之后写命令仍然成功");
  if ((await admin.get(`${prefix}sentinel`)) !== "1") failures.push("写满之前写下的键被淘汰了");
  await ask("第 5 项做完了：请把刚才写入的数据清掉，让实例恢复可写。");
  return verdictOf(failures, "写满后写命令报 OOM，已有的键没有被淘汰");
});

await item(6, "数据全丢后的自愈（只删本脚本自己的键）", async () => {
  if (!isLocal && !args["allow-wipe"]) {
    return ["需人工", "不是本机的实例：确认可以做之后带 --allow-wipe 再跑（只删本脚本前缀下的键）"];
  }
  const heal = queueOf("heal");
  let done = 0;
  workerOf("heal", async () => void (done += 1));
  await heal.addBulk(
    Array.from({ length: 50 }, () => ({ name: "job", data: {}, opts: { delay: 60_000 } })),
  );
  const removed = await wipeOwnKeys();
  // 消费者不重启：键没了之后再入队，应当照常被消费
  const sentAt = Date.now();
  const healed = await until(async () => {
    await heal.add("job", {});
    return done > 0;
  }, 30_000);
  return healed
    ? ["通过", `删掉 ${removed} 个键后消费者没有重启，${Date.now() - sentAt} 毫秒内恢复消费`]
    : ["不通过", "删掉队列的键之后，消费者 30 秒内没有恢复"];
});

await item(7, "延迟", async () => {
  const latency = queueOf("latency");
  const samples: number[] = [];
  for (let n = 0; n < 500; n += 1) {
    const at = performance.now();
    await latency.add("job", { n }, { removeOnComplete: true });
    samples.push(performance.now() - at);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number): string => (samples[Math.floor(samples.length * q)] ?? 0).toFixed(1);
  const detail = `单次入队 P50 ${at(0.5)} 毫秒、P99 ${at(0.99)} 毫秒（500 次）`;
  // 标准是“VPC 内 P99 < 20 毫秒”：超了也可能只是这台机器不在 VPC 里，交给人判断
  return Number(at(0.99)) < 20
    ? ["通过", detail]
    : ["需人工", `${detail}；超过 20 毫秒，确认是否在 VPC 内跑的`];
});

await Promise.allSettled(closers.map((close) => close()));
await wipeOwnKeys().catch(() => undefined);
for (const client of connections) client.disconnect();

// 缺省写在产物旁边（apps/worker/dist，不入库），与从哪个目录调用无关
const reportPath = resolve(
  args.report ?? fileURLToPath(new URL("./redis-compat-report.json", import.meta.url)),
);
const counts = (verdict: Verdict): number => items.filter((one) => one.verdict === verdict).length;
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      check: "V1 托管 Redis 与队列库的兼容",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      parameters: { jobs: total, idleMinutes: idleMs / 60_000, interactive, local: isLocal },
      summary: { 通过: counts("通过"), 不通过: counts("不通过"), 需人工: counts("需人工") },
      items,
    },
    null,
    2,
  )}\n`,
);
say(
  `结论：通过 ${counts("通过")} 项，不通过 ${counts("不通过")} 项，需人工 ${counts("需人工")} 项。报告：${reportPath}`,
);
process.exit(counts("不通过") > 0 ? 1 : 0);
