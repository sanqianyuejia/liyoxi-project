// 用连续前进的业务时钟执行真实 CLI，防止“立即生效”的协议公告被写成负公告期。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  bindContent,
  createContent,
  createContentLicense,
  seedDemoContent,
} from "./content/index.js";
import { createDocs } from "./docs/index.js";
import { createEvents } from "./events/index.js";
import { createFlow } from "./flow/index.js";
import { createTxRunner, systemClock } from "./kernel/index.js";
import { createMedia } from "./media/index.js";
import {
  assembleForTest,
  createCodecDemoMasterPreparer,
  createFactories,
  createProviderHarness,
  fakeKeyEnv,
  useSeededDatabase,
} from "./testing/index.js";
import { createTimers } from "./timers/index.js";

const db = useSeededDatabase("services");
const loader = createRequire(import.meta.url).resolve("tsx");
const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

it("已有演示内容时真实 CLI 在时钟持续前进下播种成功，登录协议立即可读，重复执行新增 0 行", async () => {
  const prisma = await db.prisma();
  const tx = createTxRunner({ prisma, appEnv: "test" }),
    assembly = assembleForTest({ entry: "worker" }),
    events = createEvents({ tx, clock: systemClock, assembly }),
    flow = createFlow({ clock: systemClock, assembly, events }),
    providers = createProviderHarness({ clock: systemClock }).providers,
    media = createMedia({ tx, clock: systemClock, assembly, events, storage: providers.storage }),
    timers = createTimers({ assembly }),
    license = createContentLicense({ clock: systemClock, flow, timers }),
    content = createContent({ clock: systemClock, assembly, flow, media, events, license }),
    unbind = bindContent(assembly);
  // 本组只回归真实 CLI 的协议时钟。内容为既有 codec 夹具，不声称原片/媒体端到端验收。
  try {
    const staff = await createFactories({ db: prisma, clock: systemClock }).staff({
      staffRoleKey: "content_ops",
    });
    await seedDemoContent(
      {
        tx,
        clock: systemClock,
        content,
        media,
        appEnv: "test",
        prepareMasters: createCodecDemoMasterPreparer({
          appEnv: "test",
          tx,
          clock: systemClock,
          media,
          events,
        }),
      },
      staff.id,
    );
  } finally {
    unbind();
  }
  expect(await prisma.drama.count({ where: { status: "listed" } })).toBe(3);
  expect(await prisma.agreementVersion.count()).toBe(0);
  expect(await prisma.siteNotice.count()).toBe(0);
  expect(await prisma.outboxEvent.count({ where: { eventType: "site_notice.announced" } })).toBe(0);
  const temporary = mkdtempSync(join(tmpdir(), "lyx-demo-seed-cli-"));
  const keys = fakeKeyEnv();
  const dataKeysFile = join(temporary, "data-keys.json");
  const bidxKeysFile = join(temporary, "bidx-keys.json");
  writeFileSync(dataKeysFile, JSON.stringify(keys.DATA_KEYS), { mode: 0o600 });
  writeFileSync(bidxKeysFile, JSON.stringify(keys.BIDX_KEYS), { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    APP_ENV: "test",
    DATABASE_URL: await db.url(),
    REDIS_URL: process.env.REDIS_URL,
    DATA_KEYS_FILE: dataKeysFile,
    BIDX_KEYS_FILE: bidxKeysFile,
  };
  const source = `
    import { systemClock } from ${JSON.stringify(new URL("./kernel/clock.ts", import.meta.url).href)};
    let at = Date.now();
    systemClock.now = () => new Date(at++);
    await import(${JSON.stringify(new URL("../scripts/demo-seed.ts", import.meta.url).href)});
  `;
  const run = () =>
    spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval", source], {
      cwd: packageDirectory,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });

  try {
    const first = run();
    // CLI 输出含本测试现造员工的激活码；失败报告只给类型/退出码，不回显输出。
    expect(first.error, "演示种子 CLI 未启动或超时").toBeUndefined();
    expect(first.status, "连续前进时钟下演示种子的退出码").toBe(0);
    expect(first.stderr.includes("演示种子失败"), "首次执行没有播种错误").toBe(false);
    expect(first.stdout).toMatch(/演示种子完成：新增 [1-9]\d* 行/);

    const docs = createDocs({ tx: createTxRunner({ prisma, appEnv: "test" }), clock: systemClock });
    const agreements = await docs.listAgreements({ scene: "login", limit: 50 });
    expect(agreements.items.map((item) => item.agreementKey).sort()).toEqual(["privacy", "user"]);
    expect(agreements.items.every((item) => item.currentVersion !== null)).toBe(true);
    expect(await prisma.agreementVersion.count()).toBe(6);
    const notices = await prisma.siteNotice.findMany();
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice.leadDays).toBe(0);
      expect(notice.effectiveAt).toEqual(notice.announcedAt);
    }
    expect(await prisma.outboxEvent.count({ where: { eventType: "site_notice.announced" } })).toBe(
      2,
    );

    const again = run();
    expect(again.error, "重复演示种子 CLI 未启动或超时").toBeUndefined();
    expect(again.status, "重复演示种子的退出码").toBe(0);
    expect(again.stderr.includes("演示种子失败"), "重复执行没有播种错误").toBe(false);
    expect(again.stdout).toContain("演示种子完成：新增 0 行");
    expect(await prisma.agreementVersion.count()).toBe(6);
    expect(await prisma.siteNotice.count()).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { eventType: "site_notice.announced" } })).toBe(
      2,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 180_000);
