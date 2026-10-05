// 必过检查第二次提速的门禁：测试隔离的全量分成四片并行（CI 里的 pnpm test:isolation --scope connected --shard <i>/4）。
// 不分片时两个会话都要有 Redis 前缀、都要有“4 个 worker 同时在场”的记录；分片后这两项各只要求分到那份用例的
// 那一片有（脚本照这一片的文件名单定，交给核对的就是 --expect）。这里造两份只有库的记录，只跑核对部分（--check）：
// 按“两个文件都没分到的一片”核对应当通过；按“分到了 parallel.test.ts 与 redis-isolation.test.ts 的一片”核对必须失败。
// 分片之后这两项被整个拿掉（哪一片都不要求）时，这一例会红。
const usage = (session) =>
  [
    { kind: "database", value: `lyx_test_tpl_${session}` },
    { kind: "database", value: `lyx_test_services_${session}_1` },
  ]
    .map((record) => `${JSON.stringify(record)}\n`)
    .join("");

const SCRIPT = "packages/services/src/testing/isolation.mjs";

export default {
  gate: "测试隔离（test:isolation 分片）",
  mutation: "分到 parallel.test.ts 与 redis-isolation.test.ts 的那一片里，两边都没有对应的记录",
  reason:
    /不通过：甲的用量记录里没有 Redis 前缀：连 Redis 的用例没跑到\n[\s\S]*不通过：甲没有“4 个 worker 同时在场、4 个互不相同的库”的记录\n[\s\S]*不通过：乙没有“4 个 worker 同时在场、4 个互不相同的库”的记录/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "a.jsonl": usage("ia"), "b.jsonl": usage("ib") });
    const check = (expect) =>
      ctx.node(SCRIPT, ["--check", `${dir}/a.jsonl`, `${dir}/b.jsonl`, "--expect", expect]);
    const baseline = check("none");
    if (baseline.status !== 0) {
      throw new Error(`两个文件都没分到的一片，只有库的记录没通过核对：${baseline.output.trim()}`);
    }
    return check("parallel,redis");
  },
};
