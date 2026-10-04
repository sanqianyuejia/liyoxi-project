// 下载页的页面清单（D7 第 6 节；p01 第 1 节“对应画板”）。下载页没有原型，页面都在 M6 做（G6-B）。
// docs/plan/pages.md 的下载页部分由 infra/ci/pages/generate.mjs 从这里生成；页面包合并时把 implemented 改成 true。
// 本文件不得 import 任何东西：页面清单脚本用 Node 直接读它，不经打包。

export interface PortalPage {
  key: string;
  title: string;
  /** 前端路由；没有独立地址的为 null */
  path: string | null;
  /** routemap.json 的 screens 里“无画板：”后面的名字 */
  screen: string;
  /** V1.1 的页面只登记 */
  milestone: "M6" | "V1.1";
  workPackage: string;
  implemented: boolean;
  /** 要不要先有会话（扫码登录之后才能进） */
  needsSession: boolean;
  note?: string;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  {
    key: "portal.login",
    title: "扫码登录页",
    path: "/",
    screen: "下载页·扫码登录页",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: false,
    note: "二维码、配对数字、倒计时、手输代码",
  },
  {
    key: "portal.items",
    title: "可下载清单",
    path: "/items",
    screen: "下载页·可下载清单",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: true,
  },
  {
    key: "portal.item",
    title: "成片下载",
    path: "/items/$id",
    screen: "下载页·成片下载",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: true,
    note: "逐集下载、打包下载、发布清单",
  },
  {
    key: "portal.preview",
    title: "样片与广告只读预览",
    path: "/preview/$kind/$id",
    screen: "下载页·样片与广告只读预览",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: true,
  },
  {
    key: "portal.expired",
    title: "会话失效说明页",
    path: null,
    screen: "下载页·会话失效说明页",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: false,
    note: "当前会话接口返回 401 时进入，再回扫码页；没有独立地址",
  },
  {
    key: "portal.landing",
    title: "扫一扫落地页",
    path: "/a",
    screen: "下载页·扫一扫落地页",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: false,
    note: "用微信“扫一扫”而不是小程序里的按钮扫了码时的提示页",
  },
  {
    key: "portal.verify",
    title: "授权书验真页",
    path: "/v",
    screen: "下载页·授权书验真页",
    milestone: "M6",
    workPackage: "G6-B",
    implemented: false,
    needsSession: false,
    note: "地址 /v?code=<验真码>&rev=<版次>（p01 第 3.15 节）",
  },
  {
    key: "portal.upload",
    title: "电脑端上传",
    path: null,
    screen: "下载页·电脑端上传（V1.1）",
    milestone: "V1.1",
    workPackage: "—",
    implemented: false,
    needsSession: true,
    note: "V1.1，只登记",
  },
];
