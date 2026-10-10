import { createHash } from "node:crypto";
import { expect, test, type Page, type Response } from "@playwright/test";
import type { components } from "@liyoxi/contract/types/admin";
import { createAdminApi } from "../../src/lib/api";
import { liveContext, noHorizontalScroll, recordErrors } from "./live-context";
import { api, shot, totp, write } from "./w206-helpers";

type Role = components["schemas"]["RoleDetail"];
const roleBody = (role: Role) => ({
  moduleLevels: role.moduleLevels,
  actions: role.actions,
  dataScope: role.dataScope,
  lockVersion: role.lockVersion,
});

// These fictional credentials travel through native fetch, outside Playwright traces/screenshots.
async function createIdentity(page: Page, roleKey: "publisher" | "editor", index: number) {
  const origin = liveContext().origin;
  // Same trusted-loopback source mechanism as W206; each owned identity keeps its own auth budget.
  const clientSource = `192.0.2.${216 + index}`;
  const administratorCookie = (await page.context().cookies(origin))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const cookies = new Map<string, string>();
  const client = (administrator = false) =>
    createAdminApi({
      baseUrl: origin,
      build: "w216-permissions",
      fetch: async (request) => {
        request.headers.set("Origin", origin);
        request.headers.set("X-Forwarded-For", clientSource);
        request.headers.set(
          "Cookie",
          administrator
            ? administratorCookie
            : [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        );
        const response = await fetch(request);
        if (!administrator)
          for (const value of response.headers.getSetCookie()) {
            const pair = value.split(";")[0]!,
              at = pair.indexOf("=");
            cookies.set(pair.slice(0, at), pair.slice(at + 1));
          }
        return response;
      },
      handlers: {
        redirectToLogin() {},
        stepUp: async () => false,
        refreshAccess() {},
        invalidateQueries() {},
        notify() {},
        showBlocked() {},
        buildMismatch() {},
      },
    }).client;
  const phone = `1880000216${index}`,
    password = "Liyoxi-2026-agreements";
  const created = await client(true).POST("/api/v1/admin/staff", {
    body: {
      name: `协议权限演练${index}`,
      phone,
      roleKey,
      isLead: false,
      activateNow: true,
      activationDelivery: "manual",
      inviteWecom: false,
    },
    headers: { "Idempotency-Key": `w216-permission-create-${index}` },
  });
  expect(created.response.status).toBe(200);
  const staffId = created.data!.data.staff.staffId,
    activationCode = created.data!.data.activation?.activationCode;
  expect(activationCode).toBeTruthy();
  const auth = client();
  const activated = await auth.POST("/api/v1/admin/auth/activate", {
    body: { phone, activationCode: activationCode! },
  });
  expect(activated.response.status).toBe(200);
  const passwordSet = await auth.POST("/api/v1/admin/auth/set-password", {
    body: { ticket: activated.data!.data.ticket!, newPassword: password },
  });
  expect(passwordSet.response.status).toBe(200);
  const enrolled = await auth.POST("/api/v1/admin/auth/enroll-totp", {
    body: { ticket: passwordSet.data!.data.ticket! },
  });
  expect(enrolled.response.status).toBe(200);
  const confirmed = await auth.POST("/api/v1/admin/auth/confirm-totp", {
    body: { ticket: enrolled.data!.data.ticket, code: totp(enrolled.data!.data.secret) },
  });
  expect(confirmed.response.status).toBe(200);
  return {
    staffId,
    clientSource,
    cookies: [...cookies].map(([name, value]) => ({
      name,
      value,
      domain: new URL(origin).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "Lax" as const,
    })),
  };
}

/** Register after every original staff count/assertion. No initial fixture adds employees. */
export function registerAgreementPermissionsTest() {
  test("W216 真实ops查看/无权限身份：页面只读及直接写403，finally恢复原角色", async ({
    browser,
    page: administrator,
  }) => {
    const original = await api<Role>(administrator, "/roles/publisher");
    try {
      await write(administrator, "/roles/publisher", "PUT", {
        ...roleBody(original),
        moduleLevels: { ...original.moduleLevels, ops: "v" },
      });
      for (const [roleKey, index] of [
        ["publisher", 1],
        ["editor", 2],
      ] as const) {
        const identity = await createIdentity(administrator, roleKey, index);
        const context = await browser.newContext({
          baseURL: liveContext().origin,
          viewport: { width: 1366, height: 768 },
          storageState: { cookies: identity.cookies, origins: [] },
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai",
          extraHTTPHeaders: { "X-Forwarded-For": identity.clientSource },
        });
        try {
          const page = await context.newPage(),
            errors = recordErrors(page);
          await page.goto("/ops/agreements?agreementKey=custom_license");
          if (roleKey === "publisher") {
            await expect(
              page.getByText("当前为只读权限，可查看协议与脱敏签署证据", { exact: true }),
            ).toBeVisible();
            for (const name of ["新建草稿", "编辑草稿", "编辑", "安排", "撤回"])
              await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
            await page.getByRole("tab", { name: "同意记录", exact: true }).click();
            await expect(
              page.getByRole("region", { name: "协议同意记录", exact: true }).getByRole("table"),
            ).toBeVisible();
            await shot(page, "agreements-09-readonly");
          } else
            await expect(
              page.getByRole("heading", { name: "没有访问权限", exact: true }),
            ).toBeVisible();
          const denied = await page.request.post(
            "/api/v1/admin/agreements/custom_license/agreement-versions",
            {
              headers: {
                Origin: liveContext().origin,
                "X-LYX-Admin": "1",
                "Idempotency-Key": `w216-denied-${index}`,
              },
              data: { bumpMajor: false, isLegalApproved: false },
            },
          );
          expect(denied.status()).toBe(403);
          expect((await denied.json()).error).toBe("PERMISSION_DENIED");
          await noHorizontalScroll(page, `协议权限${roleKey}`);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    } finally {
      const current = await api<Role>(administrator, "/roles/publisher");
      await write(administrator, "/roles/publisher", "PUT", {
        ...roleBody(original),
        lockVersion: current.lockVersion,
      });
      const restored = await api<Role>(administrator, "/roles/publisher");
      expect(roleBody(restored)).toEqual({
        ...roleBody(original),
        lockVersion: restored.lockVersion,
      });
    }
  });

  test("W216 真实编辑与超管短公告分权、当前再验证事实及同意图重放，完整恢复角色", async ({
    browser,
    page: administrator,
  }) => {
    const original = await api<Role>(administrator, "/roles/publisher");
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      await write(administrator, "/roles/publisher", "PUT", {
        ...roleBody(original),
        moduleLevels: { ...original.moduleLevels, ops: "e" },
      });
      const identity = await createIdentity(administrator, "publisher", 3);
      context = await browser.newContext({
        baseURL: liveContext().origin,
        viewport: { width: 1366, height: 768 },
        storageState: { cookies: identity.cookies, origins: [] },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        extraHTTPHeaders: { "X-Forwarded-For": identity.clientSource },
      });
      let page = await context.newPage();
      const errors: { message: string; url?: string }[] = [];
      const record = (target: Page) => {
        target.on("pageerror", (error) => errors.push({ message: error.message }));
        target.on("console", (message) => {
          if (message.type() === "error")
            errors.push({ message: message.text(), url: message.location().url });
        });
      };
      record(page);
      const data = (
        liveContext().fixtures as {
          fixtures: {
            "x-agreements-m2": {
              noticeAgreementKey: string;
              files: { name: string; mime: string; base64: string; size: number; sha256: string }[];
            };
          };
        }
      ).fixtures["x-agreements-m2"];
      await page.goto(`/ops/agreements?agreementKey=${data.noticeAgreementKey}`);
      await page.getByRole("button", { name: "新建草稿", exact: true }).click();
      let editor = page.getByRole("dialog", { name: "新建协议草稿", exact: true });
      await expect(
        editor.getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true }),
      ).not.toBeChecked();
      await expect(editor.getByRole("checkbox", { name: /升级主版本/ })).toHaveCount(0);
      await editor
        .getByRole("textbox", { name: "变更摘要", exact: true })
        .fill("虚构短公告权限演练");
      const date = editor.getByRole("textbox", { name: "生效日期（北京时间）", exact: true });
      await date.fill(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(Date.now() + 2 * 86400000)),
      );
      await date.press("Enter");
      await date.press("Tab");
      await editor.getByLabel("生效时刻（北京时间）", { exact: true }).fill("09:00");
      const uploadFiles = async (uploaderId: string) => {
        const ids: string[] = [];
        for (const [index, file] of data.files.entries()) {
          const bytes = Buffer.from(file.base64, "base64");
          expect(bytes.byteLength).toBe(file.size);
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
          const registered = page.waitForResponse(
            (r) =>
              r.request().method() === "POST" &&
              new URL(r.url()).pathname === "/api/v1/admin/files",
          );
          await editor.locator('input[type="file"]').nth(index).setInputFiles({
            name: file.name,
            mimeType: file.mime,
            buffer: bytes,
          });
          const registration = await registered;
          expect(registration.status()).toBe(200);
          ids.push((await registration.json()).data.fileId);
          expect(ids[index]).toEqual(expect.any(String));
          await expect(
            editor.getByRole("button", {
              name: index === 0 ? "清除 Word 引用" : "清除 PDF 引用",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            editor.locator(".lyx-upload").nth(index).locator(".ant-upload-list-item-done"),
          ).toBeVisible();
          const fileFact = await api<components["schemas"]["AdminFileView"]>(
            page,
            `/files/${ids[index]}`,
          );
          expect(fileFact).toMatchObject({
            fileId: ids[index],
            status: "stored",
            category: "legal_doc",
            declaredSizeBytes: String(file.size),
            sizeBytes: String(file.size),
            uploader: { actorType: "staff", actorId: uploaderId, client: "admin" },
          });
        }
        return ids;
      };
      await uploadFiles(identity.staffId);
      await editor
        .getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true })
        .check();
      const schedule = async () => {
        const result = page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/schedule"),
        );
        await editor.getByRole("button", { name: "保存并安排", exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: "安排协议生效", exact: true });
        await expect(confirmation).not.toHaveClass(/ant-zoom-(appear|enter)/);
        await confirmation
          .getByRole("checkbox", { name: "我已核对文件、法务记录与安排信息", exact: true })
          .check();
        await confirmation.getByRole("button", { name: "确认", exact: true }).click();
        return result;
      };
      const denied = await schedule();
      expect(denied.status()).toBe(409);
      expect(await denied.json()).toMatchObject({
        error: "AGREEMENT_SHORT_NOTICE",
        details: { canOverride: false },
      });
      await page
        .getByRole("dialog", { name: "安排协议生效", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await expect(
        editor.getByRole("textbox", { name: "公告不足期覆盖理由", exact: true }),
      ).toHaveCount(0);
      await context.close();
      context = undefined;
      // The formal permission is SUPER_ADMIN_ONLY, never a configurable publisher grant.
      page = administrator;
      record(page);
      const me = await api<components["schemas"]["StaffMe"]>(page, "/auth/me");
      expect(me.permissions).toContain("agreement.short_notice");
      expect(me.permissions).toContain("sys.super_admin");
      expect(Date.parse(me.session.stepUpValidUntil)).toBeGreaterThan(Date.parse(me.serverTime));
      const current = await api<components["schemas"]["AgreementDetail"]>(
        page,
        `/agreements/${data.noticeAgreementKey}`,
      );
      expect(current.draftVersion?.agreementVersionId).toEqual(expect.any(String));
      await page.goto(`/ops/agreements?agreementKey=${data.noticeAgreementKey}`);
      await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
      editor = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("button", { name: "保存草稿", exact: true }) });
      await expect(
        editor.getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true }),
      ).not.toBeChecked();
      await editor
        .getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true })
        .check();
      const ownFileIds = await uploadFiles(me.staff.staffId);
      const saved = page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          new URL(r.url()).pathname ===
            `/api/v1/admin/agreement-versions/${current.draftVersion?.agreementVersionId}`,
      );
      const needsReason = await schedule();
      const savedResponse = await saved;
      expect(savedResponse.status()).toBe(200);
      expect((await savedResponse.json()).data.version).toMatchObject({
        agreementVersionId: current.draftVersion?.agreementVersionId,
        sourceFile: { fileId: ownFileIds[0] },
        pdfFile: { fileId: ownFileIds[1] },
      });
      expect(needsReason.status()).toBe(409);
      expect(await needsReason.json()).toMatchObject({
        error: "AGREEMENT_SHORT_NOTICE",
        details: { canOverride: true },
      });
      await page
        .getByRole("dialog", { name: "安排协议生效", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await editor
        .getByRole("textbox", { name: "公告不足期覆盖理由", exact: true })
        .fill("虚构权限演练，已核对当前正文及公告影响");
      const beforeSchedule = await api<components["schemas"]["AgreementDetail"]>(
        page,
        `/agreements/${data.noticeAgreementKey}`,
      );
      const draft = beforeSchedule.versions.find(
        (version) => version.agreementVersionId === current.draftVersion?.agreementVersionId,
      );
      if (!draft) throw new Error("短公告演练缺少当前真实草稿");
      const replayBody: components["schemas"]["AgreementVersionScheduleBody"] = {
        lockVersion: draft.lockVersion,
        shortNoticeReason: await editor
          .getByRole("textbox", { name: "公告不足期覆盖理由", exact: true })
          .inputValue(),
      };
      const extraSaves: string[] = [];
      const observeSave = (response: Response) => {
        if (
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname.startsWith("/api/v1/admin/agreement-versions/")
        )
          extraSaves.push(response.url());
      };
      page.on("response", observeSave);
      const scheduled = await schedule().finally(() => {
        page.off("response", observeSave);
      });
      expect(extraSaves).toEqual([]);
      expect(scheduled.status()).toBe(200);
      const result = (await scheduled.json()).data;
      expect(result.version.displayStatus).toBe("pending");
      expect(result.siteNotice).toMatchObject({
        status: "announced",
        shortNoticeReason: "虚构权限演练，已核对当前正文及公告影响",
      });
      expect(result.siteNotice.leadDays).toBeLessThan(30);
      const request = scheduled.request();
      const capturedBody = request.postDataJSON();
      if (capturedBody) expect(capturedBody).toEqual(replayBody);
      const replay = await page.request.post(request.url(), {
        data: replayBody,
        headers: {
          Origin: liveContext().origin,
          "X-LYX-Admin": "1",
          "Idempotency-Key": request.headers()["idempotency-key"]!,
        },
      });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).data).toEqual(result);
      await shot(page, "agreements-11-short-notice");
      const expected = errors.filter(
        (error) =>
          error.url === denied.url() &&
          error.message ===
            "Failed to load resource: the server responded with a status of 409 (Conflict)",
      );
      expect(expected).toHaveLength(2);
      expect(errors.filter((error) => !expected.includes(error))).toEqual([]);
    } finally {
      try {
        await context?.close();
      } finally {
        const current = await api<Role>(administrator, "/roles/publisher");
        await write(administrator, "/roles/publisher", "PUT", {
          ...roleBody(original),
          lockVersion: current.lockVersion,
        });
        const restored = await api<Role>(administrator, "/roles/publisher");
        expect(roleBody(restored)).toEqual({
          ...roleBody(original),
          lockVersion: restored.lockVersion,
        });
      }
    }
  });
}
