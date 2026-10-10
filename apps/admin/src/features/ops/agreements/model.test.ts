import { describe, expect, it, vi } from "vitest";
import { createAdminApi } from "../../../lib/api";
import { createAgreementApi, type AgreementApi, type AgreementDetail, type Version } from "./api";
import { agreementSearch, createAgreementWorkspace, createWriteIntent, phaseLabel } from "./model";

const id = "01910000-0000-7000-8000-000000000001";
const other = "01910000-0000-7000-8000-000000000002";
const at = "2026-10-09T00:00:00.000Z";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function detail(key = "user"): AgreementDetail {
  return {
    agreementKey: key,
    name: "虚构用户协议",
    subjectKind: "user",
    consentMode: "checkbox",
    scenes: ["login"],
    signSceneLabel: "登录时签署",
    audienceLabel: "平台用户",
    sinceVersion: "V1.0",
    currentVersion: null,
    pendingVersion: null,
    draftVersion: null,
    versions: [],
    currentContentHtml: null,
    draftContentHtml: null,
    reconsentProgress: null,
  };
}
function version(status = "draft"): Version {
  return {
    agreementVersionId: id,
    agreementKey: "user",
    major: 1,
    minor: 1,
    versionLabel: "v1.1",
    status,
    displayStatus: status,
    effectiveAt: at,
    summary: "虚构变更",
    isReconsentRequired: true,
    isLegalApproved: false,
    sourceFile: null,
    pdfFile: null,
    hasContentHtml: false,
    contentSha256: null,
    siteNoticeId: null,
    shortNoticeReason: null,
    expectedConsents: null,
    activatedAt: null,
    createdBy: {
      staffId: id,
      name: "虚构员工",
      staffNo: 1001,
      roleKey: "super_admin",
      isLead: false,
      status: "active",
    },
    publishedBy: null,
    lockVersion: 0,
    createdAt: at,
    updatedAt: at,
    actions: ["edit"],
  };
}
function api() {
  return {
    list: vi.fn<AgreementApi["list"]>(async () => ({
      items: [detail()],
      page: 1,
      pageSize: 20,
      total: 1,
    })),
    get: vi.fn<AgreementApi["get"]>(async (key: string) => detail(key)),
    create: vi.fn<AgreementApi["create"]>(async () => ({
      version: version(),
      contentHtml: null,
      conversion: { state: "unchanged" as const, warnings: [] },
    })),
    update: vi.fn<AgreementApi["update"]>(async () => ({
      version: version(),
      contentHtml: null,
      conversion: { state: "unchanged" as const, warnings: [] },
    })),
    schedule: vi.fn<AgreementApi["schedule"]>(async () => ({
      version: version("pending"),
      siteNotice: null,
    })),
    withdraw: vi.fn<AgreementApi["withdraw"]>(async () => ({
      withdrawn: version("withdrawn"),
      newDraft: null,
      siteNotice: null,
    })),
    consents: vi.fn<AgreementApi["consents"]>(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })),
    consent: vi.fn<AgreementApi["consent"]>(),
    download: vi.fn<AgreementApi["download"]>(),
  } satisfies AgreementApi;
}

describe("W216 typed API与工作区", () => {
  it("八operation实际wire请求、原body/同key及中央step-up不改变意图", async () => {
    const requests: Request[] = [];
    let stepped = false;
    const central = createAdminApi({
      baseUrl: "http://localhost",
      build: "test",
      handlers: {
        redirectToLogin: vi.fn(),
        stepUp: vi.fn(async () => {
          stepped = true;
          return true;
        }),
        refreshAccess: vi.fn(),
        invalidateQueries: vi.fn(),
        notify: vi.fn(),
        showBlocked: vi.fn(),
        buildMismatch: vi.fn(),
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        if (request.url.endsWith("/schedule") && !stepped)
          return Response.json(
            { error: "STEP_UP_REQUIRED", message: "请再验证", code: 40301 },
            { status: 403 },
          );
        return Response.json({ data: {} });
      },
    });
    const client = createAgreementApi({ api: central });
    await client.list();
    await client.get("user");
    await client.create("user", { bumpMajor: false, isLegalApproved: false }, "create-intent");
    await client.update(id, { lockVersion: 2, sourceFileId: null }, "edit-intent");
    await client.schedule(
      id,
      { lockVersion: 3, shortNoticeReason: "虚构短期原因" },
      "schedule-intent",
    );
    await client.withdraw(id, {}, "withdraw-intent");
    await client.consents({ entityId: id, page: 2, pageSize: 20 });
    await client.consent(other);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/admin/agreements",
      "/api/v1/admin/agreements/user",
      "/api/v1/admin/agreements/user/agreement-versions",
      `/api/v1/admin/agreement-versions/${id}`,
      `/api/v1/admin/agreement-versions/${id}/schedule`,
      `/api/v1/admin/agreement-versions/${id}/schedule`,
      `/api/v1/admin/agreement-versions/${id}/withdraw`,
      "/api/v1/admin/agreement-consents",
      `/api/v1/admin/agreement-consents/${other}`,
    ]);
    expect(requests[4]!.headers.get("Idempotency-Key")).toBe("schedule-intent");
    expect(requests[5]!.headers.get("Idempotency-Key")).toBe("schedule-intent");
    expect(await requests[3]!.json()).toEqual({ lockVersion: 2, sourceFileId: null });
    expect(new URL(requests[7]!.url).searchParams.get("page")).toBe("2");
    expect(
      requests.filter((r) => r.method !== "GET").every((r) => r.headers.get("X-LYX-Admin") === "1"),
    ).toBe(true);
    expect(
      requests
        .filter((r) => r.method === "GET")
        .every((r) => r.headers.get("X-LYX-Admin") === null),
    ).toBe(true);
  });
  it("URL严格恢复正式查询、关联单据须有类型、六份之外不伪造列表", () => {
    expect(
      agreementSearch({
        agreementKey: "user",
        tab: "evidence",
        entityId: id,
        page: "2",
        secret: "DROP",
      }),
    ).toEqual({
      agreementKey: "user",
      tab: "evidence",
      entityId: id,
      page: "2",
      pageSize: "20",
      sort: "-consentedAt",
    });
    expect(
      agreementSearch({ agreementKey: "partner", bizId: id, consentNo: "NaN" }),
    ).not.toHaveProperty("agreementKey");
    expect(agreementSearch({ bizId: id })).not.toHaveProperty("bizId");
  });
  it("服务器displayStatus决定阶段，不凭本地时钟或簿记status挑当前", () => {
    expect(phaseLabel({ ...version("pending"), displayStatus: "active" })).toBe("生效中");
    expect(phaseLabel({ ...version(), displayStatus: "future" })).toBe("未知状态");
  });
  it("旧协议GET晚到与旧错误不覆盖新选择，close拒绝结果", async () => {
    const first = deferred<AgreementDetail>(),
      second = deferred<AgreementDetail>();
    const ports = api();
    ports.get.mockImplementation((key) => (key === "user" ? first.promise : second.promise));
    const model = createAgreementWorkspace(ports);
    const a = model.select("user"),
      b = model.select("privacy");
    second.resolve(detail("privacy"));
    await b;
    first.reject(new Error("旧错误不得显示"));
    await a;
    expect(model.snapshot().detail?.agreementKey).toBe("privacy");
    expect(model.snapshot().error).toBeUndefined();
    const late = deferred<AgreementDetail>();
    ports.get.mockImplementation(() => late.promise);
    const loading = model.select("user");
    model.close();
    late.resolve(detail());
    await loading;
    expect(model.snapshot().detail).toBeUndefined();
  });
  it("失败重试同意图key，真实改body另key且同步拒双击", async () => {
    let keys = 0;
    const intent = createWriteIntent(() => `intent-${++keys}`);
    expect(intent.key("update", id, { lockVersion: 1 })).toBe(
      intent.key("update", id, { lockVersion: 1 }),
    );
    expect(intent.key("update", id, { lockVersion: 2 })).not.toBe("intent-1");
    const ports = api(),
      wait = deferred<ReturnType<typeof version>>();
    const model = createAgreementWorkspace(ports);
    await model.select("user");
    let calls = 0;
    const a = model.write("saving", async () => {
      calls++;
      return wait.promise;
    });
    await expect(
      model.write("saving", async () => {
        calls++;
        return version();
      }),
    ).rejects.toThrow("正在处理");
    wait.resolve(version());
    await a;
    expect(calls).toBe(1);
  });
  it("旧操作finally不会清新范围的操作锁，旧成功不改变新协议", async () => {
    const ports = api(),
      a = deferred<string>(),
      b = deferred<string>();
    const model = createAgreementWorkspace(ports);
    await model.select("user");
    const first = model.write("saving", () => a.promise);
    await model.select("privacy");
    const second = model.write("saving", () => b.promise);
    a.resolve("旧成功");
    expect(await first).toBeUndefined();
    expect(model.snapshot().busy).toBe("saving");
    b.resolve("新成功");
    expect(await second).toBe("新成功");
    expect(model.snapshot().busy).toBeUndefined();
  });
  it("withdraw null不把原pending冒为draft，另id草稿才可继续编辑", async () => {
    const ports = api(),
      model = createAgreementWorkspace(ports);
    await model.select("user");
    expect(await model.withdraw(version("pending"), {})).toBeNull();
    ports.withdraw.mockImplementation(async () => ({
      withdrawn: version("withdrawn"),
      newDraft: { ...version(), agreementVersionId: other },
      siteNotice: null,
    }));
    expect((await model.withdraw(version("pending"), {}))?.agreementVersionId).toBe(other);
  });
  it("每次点击PDF都重新现签，返回URL不进workspace状态", async () => {
    const ports = api();
    ports.download.mockResolvedValue({ url: "https://fictional.invalid/pdf", expiresAt: at });
    const model = createAgreementWorkspace(ports);
    await model.select("user");
    await model.download(id);
    await model.download(id);
    expect(ports.download).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.snapshot())).not.toContain("fictional.invalid");
  });
});
