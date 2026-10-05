// 组件陈列（开发用）的登记：src/components/ 下每个组件一行，各有一页预览（src/sub/gallery/previews/<组件名>.tsx）。
// 三处从这里取：src/app.config.ts（陈列分包进不进构建）；陈列的目录页与预览页；截图命令（每个组件一张图）。
// 陈列页不是业务页面，不进 src/pages.ts 的 49 个路由，也不进 docs/plan/pages.md。
// 新加组件：建 src/components/<组件名>/，在下面加一行，写预览并登记进 src/sub/gallery/previews/index.ts；
// 少了哪一样，用例（src/gallery.test.ts）或类型检查会指出来。
// 本文件不得 import 任何东西：截图命令用 Node 直接读它，不经打包。

/** 陈列分包的根；两个页面：目录页与预览页（预览页用 ?name=<组件名> 指定看哪个） */
export const GALLERY_ROOT = "sub/gallery";
export const GALLERY_PAGES = ["index/index", "preview/index"] as const;
export const GALLERY_INDEX_ROUTE = `${GALLERY_ROOT}/index/index`;
export const GALLERY_PREVIEW_ROUTE = `${GALLERY_ROOT}/preview/index`;

/** 目录页的分组，顺序照规范 第 4.3 节 */
export const GALLERY_GROUPS = [
  "基础",
  "按钮",
  "标签与角标",
  "卡片与列表",
  "表单",
  "页签、分段与筛选",
  "提示与反馈",
  "步骤与进度",
  "上传与其他",
  "补充状态",
] as const;
export type GalleryGroup = (typeof GALLERY_GROUPS)[number];

const item = <const N extends string>(name: N, title: string, group: GalleryGroup) => ({
  name,
  title,
  group,
});

/** name 是 src/components/ 下的目录名 */
export const GALLERY_ITEMS = [
  item("Icon", "图标", "基础"),
  item("NavBar", "自绘导航", "基础"),
  item("Button", "按钮", "按钮"),
  item("PillButton", "胶囊小按钮", "按钮"),
  item("TextButton", "文字按钮", "按钮"),
  item("IconButton", "图标按钮", "按钮"),
  item("AddButton", "虚线添加按钮", "按钮"),
  item("StatusTag", "状态标签", "标签与角标"),
  item("InfoTag", "信息标签", "标签与角标"),
  item("Badge", "数字角标与红点", "标签与角标"),
  item("Card", "卡片", "卡片与列表"),
  item("Section", "分组", "卡片与列表"),
  item("List", "列表行", "卡片与列表"),
  item("DescList", "键值网格", "卡片与列表"),
] as const;

export type GalleryName = (typeof GALLERY_ITEMS)[number]["name"];

/**
 * 陈列分包进不进构建。生产的小程序包缺省不带；这几种情况带：
 * H5 构建（只给截图命令用）、开发构建（pnpm --filter @liyoxi/weapp dev）、看样时显式给 WEAPP_GALLERY=1。
 */
export function galleryEnabled(env: Record<string, string | undefined>): boolean {
  if (env.WEAPP_GALLERY === "1") return true;
  if (env.WEAPP_GALLERY === "0") return false;
  return env.TARO_ENV === "h5" || env.NODE_ENV === "development";
}
