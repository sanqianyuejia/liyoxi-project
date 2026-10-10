// 局部浏览器回归：真实 BannerEditor/UploadField/直传适配器；仅本地 HTTP 协议替身。
// 注册、对象存储 POST 和 complete 分别控制，不访问数据库、真实存储或外网。
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

type Registration = { fileId: string; body: Record<string, unknown>; key: string };
type Write = { body: Record<string, unknown>; key: string };
type Probe = {
  capture(): void;
  staleSubmit(): void;
  staleUpload(): Promise<string>;
  permission(level: "e" | "v"): void;
  open(): void;
  close(): void;
};
declare global {
  interface Window {
    bannerUpload: Probe;
  }
}
const root = resolve(import.meta.dirname, "../..");
const bannerId = "01910000-0000-7000-8000-000000000001";
const originalFileId = "01910000-0000-7000-8000-000000000010";
const original = {
  homeBannerId: bannerId,
  title: "上传状态回归 Banner",
  imageFileId: originalFileId,
  jumpKind: "none",
  jumpTarget: null,
  startAt: "2026-10-01T00:00:00.000Z",
  endAt: null,
  isEnabled: true,
  lockVersion: 4,
};
let server: ViteDevServer, origin: string;
let registrations: Registration[], writes: Write[], posts: ServerResponse[];
let completes: ServerResponse[], abortedPosts: number, unknown: string[];
const virtual = (name: string) => `/__banner_upload_${name}.tsx`;
const modules: Record<string, string> = {
  [virtual("entry")]: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AccessContext} from '/src/lib/permissions.ts';
import {BannerEditor} from '/src/features/ops/home/banner-editor.tsx';
import '/src/theme/global.css';
import {installCssVariables} from '/src/theme/css-vars.ts';
installCssVariables(document);
window.__bannerUploadCapture={current:{},old:{}};
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
const request=(url,body,key,signal)=>fetch(url,{
 method:'POST',body:JSON.stringify(body),signal,
 headers:{'Content-Type':'application/json','Idempotency-Key':key},
}).then(response=>response.json());
const api={
 dramas:async()=>({items:[]}),
 get:async()=>({published:{content:{categories:[]}}}),
 file:(body,key,signal)=>request('/__files',body,key,signal),
 complete:(id,key,signal)=>request('/__files/'+id+'/complete',{},key,signal),
 fileStatus:()=>{throw new Error('unexpected status poll')},
 createBanner:(body,key,signal)=>request('/__banners',body,key,signal),
 updateBanner:(id,body,key,signal)=>request('/__banners/'+id,body,key,signal),
};
const pageRoot=createRoot(document.getElementById('root'));
function App(){
 const [level,setLevel]=useState('e'),[open,setOpen]=useState(true);
 const access={staff:{id:'${bannerId}',name:'测试员工',roleKey:'super_admin',roleName:'超级管理员'},
  isLead:false,moduleLevels:{ops:level},actions:[],dataScope:'all',releases:{}};
 window.bannerUpload={
  capture(){window.__bannerUploadCapture.old={...window.__bannerUploadCapture.current}},
  staleSubmit(){window.__bannerUploadCapture.old.submit()},
  async staleUpload(){try{await window.__bannerUploadCapture.old.upload(new File(['old'],'old.png',{type:'image/png'}),{onProgress(){}});return 'resolved'}catch(error){return error.name}},
  permission(value){setOpen(false);setLevel(value)},
  open(){setOpen(true)},
  close(){pageRoot.unmount();queryClient.clear()},
 };
 return React.createElement(QueryClientProvider,{client:queryClient},
  React.createElement(AccessContext.Provider,{value:access},
   React.createElement('output',{'data-testid':'level'},level),
   open&&level==='e'?React.createElement(BannerEditor,{
    api,banner:location.search.includes('create')?undefined:${JSON.stringify(original)},
    close:()=>setOpen(false),saved:async()=>{},
   }):null));
}
pageRoot.render(React.createElement(React.StrictMode,null,React.createElement(App)));
`,
  [virtual("antd")]: `
import React from 'react';
import {Button as Actual} from 'antd';
export * from 'antd';
export function Button(props){if(props.children==='保存 Banner'||props.children==='新增 Banner')window.__bannerUploadCapture.current.submit=props.onClick;return React.createElement(Actual,props)}
`,
  [virtual("upload")]: `
import React from 'react';
import {UploadField as Actual} from '/src/components/UploadField.tsx';
export function UploadField(props){window.__bannerUploadCapture.current.upload=props.upload;return React.createElement(Actual,props)}
`,
};
function json(response: ServerResponse, value: unknown) {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}
test.beforeAll(async () => {
  server = await createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ["**/dist/**"] } },
    plugins: [
      {
        name: "banner-upload-regression",
        enforce: "pre",
        resolveId(source, importer) {
          if (source in modules) return "\0" + source;
          if (importer?.endsWith("/features/ops/home/banner-editor.tsx")) {
            if (source === "antd") return "\0" + virtual("antd");
            if (source.endsWith("/UploadField")) return "\0" + virtual("upload");
          }
        },
        load(id) {
          return modules[id.replace(/^\0/, "")];
        },
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            const path = new URL(request.url ?? "/", "http://localhost").pathname;
            if (path === "/__banner_upload_probe") {
              response.setHeader("Content-Type", "text/html");
              response.end(
                await vite.transformIndexHtml(
                  path,
                  `<!doctype html><div id="root"></div><script type="module" src="${virtual("entry")}"></script>`,
                ),
              );
              return;
            }
            if (!["/__files", "/__banners", "/__cos"].some((prefix) => path.startsWith(prefix)))
              return next();
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = Buffer.concat(chunks).toString("utf8");
            if (path === "/__files") {
              const fileId = `01910000-0000-7000-8000-${String(registrations.length + 2).padStart(12, "0")}`;
              registrations.push({
                fileId,
                body: JSON.parse(body),
                key: String(request.headers["idempotency-key"]),
              });
              json(response, {
                fileId,
                mode: "post",
                post: { url: `${origin}/__cos`, fields: {} },
              });
              return;
            }
            if (path === "/__cos") {
              posts.push(response);
              response.on("close", () => {
                if (!response.writableEnded) abortedPosts++;
              });
              return;
            }
            if (path.endsWith("/complete")) {
              completes.push(response);
              return;
            }
            if (path.startsWith("/__banners")) {
              writes.push({
                body: JSON.parse(body),
                key: String(request.headers["idempotency-key"]),
              });
              json(response, { ok: true });
              return;
            }
            unknown.push(`${request.method} ${path}`);
            response.statusCode = 500;
            json(response, { error: "TEST_UNKNOWN_ROUTE" });
          });
        },
      },
    ],
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.beforeEach(() => {
  registrations = [];
  writes = [];
  posts = [];
  completes = [];
  abortedPosts = 0;
  unknown = [];
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.bannerUpload?.close()).catch(() => {});
  for (const response of [...posts, ...completes]) response.destroy();
  expect(unknown).toEqual([]);
});
test.afterAll(async () => {
  await server?.close();
});
const dialog = (page: Page) => page.getByRole("dialog");
const save = (page: Page) => dialog(page).getByRole("button", { name: "保存 Banner", exact: true });
async function open(page: Page, create = false) {
  const errors: string[] = [],
    remote: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      remote.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  await page.goto(`${origin}/__banner_upload_probe${create ? "?create" : ""}`);
  await expect(dialog(page)).toBeVisible();
  return () => {
    expect(errors).toEqual([]);
    expect(remote).toEqual([]);
  };
}
async function choose(page: Page, name = "banner.png") {
  await dialog(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from("local-banner-fixture"),
    });
}
async function finishUpload(page: Page, index = 0) {
  await expect.poll(() => posts.length).toBe(index + 1);
  posts[index]!.writeHead(204).end();
  await expect.poll(() => completes.length).toBe(index + 1);
  await expect(save(page)).toBeDisabled();
  json(completes[index]!, { status: "stored" });
  await expect(
    dialog(page).getByRole("button", { name: "重新上传（替换）", exact: true }),
  ).toBeVisible();
  await expect(save(page)).toBeEnabled();
}
async function expectMissingImage(page: Page, create = false) {
  await dialog(page)
    .getByRole("button", { name: create ? "新增 Banner" : "保存 Banner", exact: true })
    .click();
  await expect(
    dialog(page).getByText("请先上传 Banner 图片", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog(page)).not.toContainText("UUID");
  expect(writes).toEqual([]);
}

test("未上传图片时提示操作方法，不暴露 UUID 校验", async ({ page }) => {
  const clean = await open(page, true);
  await expectMissingImage(page, true);
  expect(registrations).toEqual([]);
  clean();
});

test("直传及 complete 未完成时禁止保存，旧 submit 也不能提交原图片", async ({ page }) => {
  const clean = await open(page);
  await page.evaluate(() => window.bannerUpload.capture());
  await choose(page);
  await expect.poll(() => posts.length).toBe(1);
  await expect(save(page)).toBeDisabled();
  await page.evaluate(() => window.bannerUpload.staleSubmit());
  expect(writes).toEqual([]);
  expect(completes).toEqual([]);
  posts[0]!.writeHead(204).end();
  await expect.poll(() => completes.length).toBe(1);
  await expect(save(page)).toBeDisabled();
  await page.evaluate(() => window.bannerUpload.staleSubmit());
  expect(writes).toEqual([]);
  json(completes[0]!, { status: "stored" });
  await expect(
    dialog(page).getByRole("button", { name: "重新上传（替换）", exact: true }),
  ).toBeVisible();
  await save(page).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toMatchObject({ imageFileId: registrations[0]!.fileId, lockVersion: 4 });
  expect(writes[0]!.key).toBeTruthy();
  await expect(dialog(page)).toHaveCount(0);
  clean();
});

test("网络失败后缺图保存仍显示明确提示，重试入库后提交同一文件编号", async ({ page }) => {
  const clean = await open(page);
  let attempts = 0;
  await page.route(`${origin}/__cos`, async (route) => {
    attempts++;
    if (attempts === 1) await route.abort("failed");
    else await route.continue();
  });
  await choose(page);
  await expect(dialog(page).getByRole("alert")).toContainText("文件直传网络失败，请重试");
  await expect(save(page)).toBeEnabled();
  await expectMissingImage(page);
  await dialog(page).getByRole("button", { name: "重试", exact: true }).click();
  await expect(save(page)).toBeDisabled();
  await finishUpload(page);
  expect(attempts).toBe(2);
  expect(registrations).toHaveLength(1);
  expect(registrations[0]!.body).toMatchObject({ category: "banner", fileName: "banner.png" });
  await save(page).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body.imageFileId).toBe(registrations[0]!.fileId);
  clean();
});

test("替换中的图片不能提交，移除完成图片后须重新上传", async ({ page }) => {
  const clean = await open(page);
  await choose(page, "first.png");
  await finishUpload(page);
  await page.evaluate(() => window.bannerUpload.capture());
  await choose(page, "replacement.png");
  await expect(save(page)).toBeDisabled();
  await page.evaluate(() => window.bannerUpload.staleSubmit());
  expect(writes).toEqual([]);
  await finishUpload(page, 1);
  await dialog(page)
    .getByTitle(/Remove file|删除文件|移除文件/)
    .click();
  await expectMissingImage(page);
  await choose(page, "after-remove.png");
  await finishUpload(page, 2);
  await save(page).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(registrations).toHaveLength(3);
  expect(writes[0]!.body.imageFileId).toBe(registrations[2]!.fileId);
  clean();
});

test("权限变化取消直传，旧回调不能写入，重新打开的会话可独立保存", async ({ page }) => {
  const clean = await open(page);
  await page.evaluate(() => window.bannerUpload.capture());
  await choose(page);
  await expect.poll(() => posts.length).toBe(1);
  await page.evaluate(() => window.bannerUpload.permission("v"));
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => abortedPosts).toBe(1);
  expect(await page.evaluate(() => window.bannerUpload.staleUpload())).toBe("AbortError");
  await page.evaluate(() => window.bannerUpload.staleSubmit());
  expect(writes).toEqual([]);
  expect(completes).toEqual([]);
  await page.evaluate(() => window.bannerUpload.permission("e"));
  await page.evaluate(() => window.bannerUpload.open());
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body.imageFileId).toBe(originalFileId);
  clean();
});
