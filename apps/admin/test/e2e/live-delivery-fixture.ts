// Node 私有 helper：只读本轮 public-test context，窄 CLI 不接收生产服务配置或密钥路径。
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page, type Response } from "@playwright/test";
import {
  FILE_OBJECT_STATUS,
  MEDIA_CHECK_GATE,
  MEDIA_JOB_KIND,
  MEDIA_JOB_STATE,
  PLAYABLE_ASSET_STATE,
  PRODUCTION_RECORD_PIPELINE_STATE,
} from "@liyoxi/contract/enums";
import { liveContext } from "./live-context";
import { liveChildEnv, liveChildFailure } from "./live-child-env";
import { orderFixture, type OrderFixture } from "./live-order-fixture";
export type Artifact = "sample" | "unknown_sample" | "final_1" | "final_2";
interface Scope {
  runId: string;
  name: string;
  prefix: string;
  startedAt: string;
  entityId: string;
  storeId: string;
  orderId: string;
  itemId: string;
  ticketId: string;
  uploaderId: string;
  managerId: string;
}
export interface DeliveryFixture {
  scope: Scope;
  ticketNo: string;
  orderNo: string;
  planId: string;
  accountId: string;
  accountName: string;
  ownerHeaders: Record<string, string>;
  launchDate: string;
  deliveryDate: string;
}
export function deliveryFixture(): DeliveryFixture {
  const f = (liveContext().fixtures as { fixtures: Record<string, DeliveryFixture> }).fixtures[
    "zz-delivery-flow"
  ]!;
  if (
    !f ||
    !/^[0-9a-f]{16}$/.test(f.scope.runId) ||
    f.scope.name !== `lyx_test_admin_live_${f.scope.runId}` ||
    f.scope.prefix !== `lyx:test:admin_live_${f.scope.runId}:`
  )
    throw new Error("缺少本轮独立交付夹具");
  return f;
}
export function managerLogin() {
  const f = orderFixture() as OrderFixture & { managerRecoveryCodePR2?: string };
  if (!f.managerRecoveryCodePR2) throw new Error("缺少独立经理恢复码");
  return { ...f.manager, recoveryCode: f.managerRecoveryCodePR2 };
}
export function deliveryVideo() {
  const manifest = (
    liveContext().fixtures as {
      fixtures: {
        w302: {
          video: { path: string; size: number; sha256: string; probe: { durationMs: number } };
        };
      };
    }
  ).fixtures.w302.video;
  const bytes = readFileSync(manifest.path);
  if (
    bytes.length !== manifest.size ||
    createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
  )
    throw new Error("本轮真实视频输入证明不一致");
  return { manifest, bytes };
}
export function knownFile(artifact: Artifact) {
  return {
    name: `${deliveryFixture().scope.runId}-${artifact}.mp4`,
    mimeType: "video/mp4",
    buffer: deliveryVideo().bytes,
  };
}
interface Upload {
  fileId: string;
  clientToken: string;
  artifact: Artifact;
}
function bridgeDiagnostic(stderr: string) {
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const pick = (values: readonly string[], value: unknown) => values.find((v) => v === value);
  for (const line of stderr.split("\n")) {
    try {
      const data: unknown = JSON.parse(line);
      if (!record(data) || data.evt !== "w119.bridge.failed") continue;
      const phase = pick(
        ["environment", "context", "runtime", "input", "observe", "cleanup", "verify", "output"],
        data.phase,
      );
      if (!phase) continue;
      const facts = record(data.facts) ? data.facts : {};
      return {
        phase,
        category: pick(["observation_timeout", "guard_rejected", "error"], data.category),
        fileStatus: pick(FILE_OBJECT_STATUS.values, facts.fileStatus),
        pipelineState: pick(PRODUCTION_RECORD_PIPELINE_STATE.values, facts.pipelineState),
        checkGate: pick(MEDIA_CHECK_GATE.values, facts.checkGate),
        jobs: Array.isArray(facts.jobs)
          ? facts.jobs
              .slice(0, 20)
              .filter(record)
              .map((job) => ({
                kind: pick(MEDIA_JOB_KIND.values, job.kind),
                state: pick(MEDIA_JOB_STATE.values, job.state),
              }))
          : [],
        playables: Array.isArray(facts.playables)
          ? facts.playables.slice(0, 20).map((state) => pick(PLAYABLE_ASSET_STATE.values, state))
          : [],
      };
    } catch {
      // 不回显任意原始 stderr；仅接受固定阶段与正式状态枚举。
    }
  }
  return undefined;
}
function runBridge(file: Upload, cleanup = false) {
  const context = process.env.LYX_ADMIN_LIVE_CONTEXT;
  if (!context) throw new Error("缺少本轮 context");
  const env = liveChildEnv([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "CI",
    "PNPM_HOME",
  ]);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@liyoxi/services",
        "exec",
        "tsx",
        "scripts/admin-live-delivery-media.ts",
        "--context",
        context,
        "--file-id",
        file.fileId,
        "--client-token",
        file.clientToken,
        "--artifact",
        file.artifact,
        ...(cleanup ? ["--cleanup"] : []),
      ],
      {
        cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
        env: { ...env, APP_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      error = `${error}${data}`.slice(0, 4096);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const failure = liveChildFailure("本域文件窄桥失败", error);
        const diagnostic = bridgeDiagnostic(error);
        if (diagnostic) failure.message += ` ${JSON.stringify(diagnostic)}`;
        reject(failure);
        return;
      }
      try {
        const result = JSON.parse(output);
        if (
          cleanup
            ? result.cleaned !== file.fileId
            : result.fileId !== file.fileId ||
              result.status !== "stored" ||
              result.known !== (file.artifact !== "unknown_sample")
        )
          throw new Error("窄桥结果不一致");
        resolve();
      } catch {
        reject(new Error("窄桥没有返回明确本轮结果"));
      }
    });
  });
}
export function attachKnownMedia(page: Page) {
  const f = deliveryFixture(),
    files = new Map<string, Upload>(),
    registrations: Promise<void>[] = [],
    jobs: Promise<void>[] = [],
    failures: unknown[] = [];
  const capture = async (response: Response) => {
    const data = (await response.json()).data as { fileId: string; clientToken: string };
    const detail = await apiData(page.request, `/api/v1/admin/files/${data.fileId}`);
    const artifact = (["sample", "unknown_sample", "final_1", "final_2"] as const).find(
      (a) => detail.originalName === `${f.scope.runId}-${a}.mp4`,
    );
    if (!artifact) throw new Error("实际登记文件没有本轮制作文件名");
    files.set(data.fileId, { fileId: data.fileId, clientToken: data.clientToken, artifact });
    expect(data.clientToken).toMatch(/^[a-f0-9-]{36}$/);
    expect(detail).toMatchObject({
      fileId: data.fileId,
      storeId: f.scope.storeId,
      entityId: f.scope.entityId,
      category: artifact.startsWith("final_") ? "final_episode" : "sample_video",
      uploader: { actorType: "staff", actorId: f.scope.uploaderId, client: "admin" },
    });
    // Chrome 对 Request stream 不保证保留 postData。若可读则再核实际请求；完整制作归属仍由窄桥锁内复核。
    const body = response.request().postDataJSON() as null | {
      fileName: string;
      clientToken: string;
      category: string;
      storeId: string;
      production: { orderItemId: string; episodeNo: number; kind: string };
    };
    if (body) {
      const episode = artifact.startsWith("final_") ? Number(artifact.slice(-1)) : 1;
      expect(body).toMatchObject({
        storeId: f.scope.storeId,
        category: artifact.startsWith("final_") ? "final_episode" : "sample_video",
        production: {
          orderItemId: f.scope.itemId,
          episodeNo: episode,
          kind: artifact.startsWith("final_") ? "final" : "sample",
        },
      });
      expect(data.clientToken).toBe(body.clientToken);
    }
  };
  const listen = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() !== "POST" || response.status() !== 200) return;
    if (path === "/api/v1/admin/files") {
      registrations.push(
        capture(response).catch((error: unknown) => {
          failures.push(error);
        }),
      );
    } else {
      const id = /^\/api\/v1\/admin\/files\/([^/]+)\/complete$/.exec(path)?.[1];
      if (id) {
        const job = (async () => {
          await Promise.all(registrations);
          const file = files.get(id);
          if (!file) throw new Error("complete 未绑定到本轮真实登记");
          await runBridge(file);
        })().catch((error: unknown) => {
          failures.push(error);
        });
        jobs.push(job);
      }
    }
  };
  page.on("response", listen);
  return {
    async settled() {
      await Promise.all(registrations);
      await Promise.all(jobs);
      if (failures.length) throw failures[0];
    },
    async cleanup() {
      page.off("response", listen);
      await Promise.all(registrations);
      await Promise.all(jobs);
      const results = await Promise.allSettled([...files.values()].map((f) => runBridge(f, true)));
      const rejected = results.filter((result) => result.status === "rejected");
      if (rejected.length)
        throw new AggregateError(
          [...failures, ...rejected.map((result) => result.reason)],
          "本轮上传文件清理失败",
        );
    },
  };
}
export async function apiData(
  request: APIRequestContext,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response =
    body === undefined
      ? await request.get(path, { headers })
      : await request.post(path, {
          data: body,
          headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        });
  expect(response.status(), path).toBe(200);
  return (await response.json()).data;
}
