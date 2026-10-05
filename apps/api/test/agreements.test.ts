// 协议两条公开路由的接口层用例（任务书 W1-03 第 7 节验收 10；m01 第 3.12、3.13 节）。
// operationId 以字符串字面量写在这里：“已落地”的判定按它认“有接口层测试”。
//   "m.agreement.list"、"m.agreementVersion.get"
// 整个应用建起来，处理器是生产的那份清单，不带任何鉴权的顶替件：不带令牌就该读得到。
import { runSeed, SEED_MODULES } from "@liyoxi/services";
import { createFactories } from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 90_000 };
const HOUR = 3_600_000;

let api: TestApi;
const ids = { user: "", privacyUpcoming: "", licenseDraft: "" };

interface Envelope<T> {
  code: number;
  data: T;
  error?: string;
}
interface AgreementRow {
  agreementKey: string;
  currentVersion: { agreementVersionId: string; versionLabel: string } | null;
  upcomingVersion: { agreementVersionId: string } | null;
}

const get = async <T>(
  path: string,
): Promise<{ status: number; headers: Headers; body: Envelope<T> }> => {
  const response = await api.request(path);
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Envelope<T>,
  };
};

beforeAll(async () => {
  api = await testApi.start();
  // 协议清单（6 份）与员工的角色来自种子；版本用工厂造
  const modules = SEED_MODULES.filter((seed) => ["staff", "docs"].includes(seed.module));
  await runSeed({ tx: api.runtime.tx, clock: api.clock, modules });
  const make = createFactories({ db: await testApi.db.prisma(), clock: api.clock });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const file = await make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
  const shared = { createdByStaffId: staff.id, pdfFileId: file.id };
  ids.user = (await make.agreementVersion({ agreementKey: "user", ...shared })).id;
  ids.privacyUpcoming = (
    await make.agreementVersion({
      agreementKey: "privacy",
      status: "pending",
      effectiveAt: new Date(api.clock.now().getTime() + HOUR),
      ...shared,
    })
  ).id;
  ids.licenseDraft = (
    await make.agreementVersion({ agreementKey: "custom_license", status: "draft", ...shared })
  ).id;
}, 120_000);

describe("m.agreement.list", () => {
  it("不带令牌回 200：六份协议按 sort_no，当前版本与待生效版本按时间现算", TIMEOUT, async () => {
    const { status, body } = await get<{
      items: AgreementRow[];
      nextCursor: string | null;
      hasMore: boolean;
    }>("/api/v1/m/agreements");
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 0, data: { nextCursor: null, hasMore: false } });
    expect(body.data.items.map((item) => item.agreementKey)).toEqual([
      "user",
      "privacy",
      "member",
      "points",
      "custom_license",
      "ad_service",
    ]);
    const byKey = new Map(body.data.items.map((item) => [item.agreementKey, item]));
    expect(byKey.get("user")).toMatchObject({
      name: "《用户服务协议》",
      subjectKind: "user",
      consentMode: "checkbox",
      scenes: ["login", "reconsent", "member_join"],
      currentVersion: { agreementVersionId: ids.user, versionLabel: "v1.0" },
      upcomingVersion: null,
    });
    // 待生效的版本不是当前版本；草稿哪儿都不出现
    expect(byKey.get("privacy")).toMatchObject({
      currentVersion: null,
      upcomingVersion: { agreementVersionId: ids.privacyUpcoming },
    });
    expect(byKey.get("custom_license")).toMatchObject({
      currentVersion: null,
      upcomingVersion: null,
    });
  });

  it("筛选：按场景、按协议键（多值逗号分隔）；取值不合法回 400", TIMEOUT, async () => {
    const keysOf = async (query: string) =>
      (await get<{ items: AgreementRow[] }>(`/api/v1/m/agreements?${query}`)).body.data.items.map(
        (item) => item.agreementKey,
      );
    expect(await keysOf("scene=plan_purchase")).toEqual(["member", "points"]);
    expect(await keysOf("scene=login")).toEqual(["user", "privacy"]);
    expect(await keysOf("agreementKey=ad_service,user")).toEqual(["user", "ad_service"]);
    expect(await keysOf("agreementKey=points&scene=topup&limit=1")).toEqual(["points"]);

    for (const query of ["scene=bogus", "limit=0", "agreementKey=User"]) {
      const bad = await get(`/api/v1/m/agreements?${query}`);
      expect(bad.status, query).toBe(400);
      expect(bad.body.error, query).toBe("VALIDATION_FAILED");
    }
  });
});

describe("m.agreementVersion.get", () => {
  it("不带令牌回 200：正文、阶段现算、不缓存；到点后待生效的版本变成当前", TIMEOUT, async () => {
    const current = await get<Record<string, unknown>>(`/api/v1/m/agreement-versions/${ids.user}`);
    expect(current.status).toBe(200);
    expect(current.headers.get("Cache-Control")).toBe("no-store");
    expect(current.body.data).toMatchObject({
      agreementVersionId: ids.user,
      agreementKey: "user",
      name: "《用户服务协议》",
      versionLabel: "v1.0",
      major: 1,
      minor: 0,
      phase: "current",
      isReconsentRequired: true,
      pdf: { url: "" },
    });
    expect(current.body.data.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    const path = `/api/v1/m/agreement-versions/${ids.privacyUpcoming}`;
    expect((await get<{ phase: string }>(path)).body.data.phase).toBe("upcoming");
    api.clock.advance(HOUR);
    expect((await get<{ phase: string }>(path)).body.data.phase).toBe("current");
  });

  it("草稿、不存在的版本回 404；id 不是 UUID 回 400", TIMEOUT, async () => {
    for (const id of [ids.licenseDraft, "01890000-0000-7000-8000-0000000000ee"]) {
      const missing = await get(`/api/v1/m/agreement-versions/${id}`);
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("NOT_FOUND");
    }
    const bad = await get("/api/v1/m/agreement-versions/not-a-uuid");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("VALIDATION_FAILED");
  });
});
