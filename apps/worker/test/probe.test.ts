import { beforeAll, expect, it, vi } from "vitest";
import { useSeededDatabase, useTestRedis } from "@liyoxi/services/testing";
import { DOMAIN_LOOPS } from "../src/domain-loops.js";
import { createHarness, SLOW } from "./support/harness.js";
import type { Harness } from "./support/harness.js";
const db = useSeededDatabase("worker"),
  redis = useTestRedis();
let h: Harness;
beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);
it(
  "实际 worker 装配60s probe，仅primary完成轮次写probe_at，stop收ops连接一次",
  async () => {
    const worker = await h.instance({ lease: { name: "w224-probe" } });
    expect(DOMAIN_LOOPS.find((r) => r.name === "probe")?.intervalMs).toBe(60_000);
    const close = vi.spyOn(worker.services, "closeOps");
    await worker.lease!.renew();
    await worker.runtime.domainLoops["probe"]!.tick();
    const row = await h.prisma.workerLease.findUniqueOrThrow({ where: { name: "primary" } });
    expect(row.holder).toBe("lyxtest:w224-probe");
    expect(row.probeAt).toEqual(worker.clock.now());
    await worker.runtime.stop();
    await worker.runtime.stop();
    expect(close).toHaveBeenCalledTimes(1);
  },
  SLOW,
);
