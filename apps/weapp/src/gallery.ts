// 组件陈列（开发用，看样也用它）的登记：src/components/ 下每个组件一行，各有一页预览（src/sub/gallery/previews/<组件名>.tsx）；
// 另有几张不属于哪个组件的基础样张（颜色、文字、间距与圆角、状态取色表），预览在 src/sub/gallery/sheets/。
// 分组照规范（design/design-spec.md）的章节先后，每组带规范的节号与看样时对照的要点（W0-29）。
// 三处从这里取：src/app.config.ts（陈列分包进不进构建）；陈列的目录页与预览页；截图命令（每个组件、每张样张一张图）。
// 陈列页不是业务页面，不进 src/pages.ts 的 49 个路由，也不进 docs/plan/pages.md。
// 新加组件：建 src/components/<组件名>/，在下面加一行，写预览并登记进 src/sub/gallery/previews/index.ts；
// 少了哪一样，用例（src/gallery.test.ts）或类型检查会指出来。
// 本文件不得 import 任何东西：截图命令用 Node 直接读它，不经打包。

/** 陈列分包的根；两个页面：目录页与预览页（预览页用 ?name=<组件名> 指定看哪个） */
export const GALLERY_ROOT = "sub/gallery";
export const GALLERY_PAGES = ["index/index", "preview/index"] as const;
export const GALLERY_INDEX_ROUTE = `${GALLERY_ROOT}/index/index`;
export const GALLERY_PREVIEW_ROUTE = `${GALLERY_ROOT}/preview/index`;

/** 目录页的分组，顺序照规范的章节先后 */
export const GALLERY_GROUPS = [
  "颜色、文字与间距",
  "页面骨架",
  "按钮",
  "标签与角标",
  "卡片与列表",
  "表单",
  "页签、分段与筛选",
  "提示与反馈",
  "步骤与进度",
  "上传与其他",
  "状态取色",
  "图标与短剧封面",
  "补充状态",
] as const;
export type GalleryGroup = (typeof GALLERY_GROUPS)[number];

/** 每组对着规范的哪一节看、看什么。spec 写“第 N 节”，可以带小标题；points 是看样时对照的要点 */
export const GALLERY_GROUP_SPEC: Record<GalleryGroup, { spec: string; points: string }> = {
  "颜色、文字与间距": {
    spec: "第 1–3 节",
    points:
      "色板与规范 第 1 节的表逐个对得上；橙色文字用的是 primary-text，不是 primary；字号十一档、字重四档；间距只取十个值；卡片圆角 14、输入框 10、标签 4。",
  },
  页面骨架: {
    spec: "第 4.2 节",
    points:
      "内容区左右边距 16、卡片间距 12；底部操作栏白底、内容高 64、按钮高 46；自绘导航只用在首页与登录页，避开右上角胶囊。",
  },
  按钮: {
    spec: "第 4.3 节“按钮”",
    points:
      "除虚线添加按钮外都是胶囊形；四档高度 48、46、40、32；禁用是灰底深字，文字就是原因；提交中显示加载图标、文字不变。",
  },
  标签与角标: {
    spec: "第 4.3 节“标签与角标”",
    points: "状态标签 12px / 600、圆角 4，五种色调；数字角标高 18、主色底；未读红点带白色外环。",
  },
  卡片与列表: {
    spec: "第 4.3 节“卡片与列表”",
    points:
      "卡片白底、圆角 14、无描边无阴影；菜单行最小高 52、末行无分隔线；键值网格的键宽 64 或 96。",
  },
  表单: {
    spec: "第 4.3 节“表单”",
    points:
      "标签在上、控件在下，间距 6；单行输入高 44、圆角 10；出错时描边变红、下方红字；表单里取值用橙色选中。",
  },
  "页签、分段与筛选": {
    spec: "第 4.3 节“页签、分段与筛选”",
    points: "筛选与切换视图用深色选中，表单里取值用橙色选中；页签选中是 2px 主色下划线。",
  },
  提示与反馈: {
    spec: "第 4.3 节“提示与反馈”；第 8 节",
    points:
      "提示条无图标、无关闭，四种色调加中性款；底部弹层上两角圆角 16、最高为屏高的 90%、正文内部滚动；空状态不放插图。",
  },
  步骤与进度: {
    spec: "第 4.3 节“步骤与进度”",
    points: "时间轴的三种节点除了颜色，形状也不同（对勾、内点、空环）；进度到 100% 变绿。",
  },
  上传与其他: {
    spec: "第 4.3 节“上传、播放与其他”",
    points:
      "上传网格三列、格子圆角 10；删除钮视觉 28、点击区 44；头像是衬线单字，门店为圆角方形、人物为圆形。",
  },
  状态取色: {
    spec: "第 6 节",
    points:
      "逐个业务对象对规范 第 6.2 节的表：橙是轮到商家动手，蓝是进行中或在等对方，绿是完成，红是要补救，灰是已结束；叫法照第 6.3 节。",
  },
  图标与短剧封面: {
    spec: "第 9 节",
    points:
      "图标是线性的，颜色跟随文字色；封面一律 3:4，占位是纯色底加白色细框与竖排剧名；失效态去色并降到 0.45。",
  },
  补充状态: {
    spec: "第 12 节“商家端”",
    points:
      "首次加载用骨架屏、不转圈；加载失败是一行说明加“重新加载”；触底是一行 12px 的文字。按钮提交中、按下态、上传中与失败在各自组件的预览里。",
  },
};

const item = <const N extends string>(name: N, title: string, group: GalleryGroup) => ({
  name,
  title,
  group,
});

/** name 是 src/components/ 下的目录名 */
export const GALLERY_ITEMS = [
  item("NavBar", "自绘导航", "页面骨架"),
  item("PageBody", "内容区", "页面骨架"),
  item("FooterBar", "底部操作栏", "页面骨架"),
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
  item("Field", "表单字段", "表单"),
  item("Input", "单行输入", "表单"),
  item("TextArea", "多行输入", "表单"),
  item("SelectEntry", "选择器入口", "表单"),
  item("SearchBar", "搜索框", "表单"),
  item("Checkbox", "复选框与单选框", "表单"),
  item("Switch", "开关", "表单"),
  item("Chip", "选项胶囊", "表单"),
  item("OptionCard", "选项卡片", "表单"),
  item("Tabs", "下划线页签", "页签、分段与筛选"),
  item("Segmented", "分段控件", "页签、分段与筛选"),
  item("FilterChips", "筛选胶囊", "页签、分段与筛选"),
  item("Note", "提示条", "提示与反馈"),
  item("Sheet", "底部弹层", "提示与反馈"),
  item("Empty", "空状态", "提示与反馈"),
  item("StepBar", "分段步骤条", "步骤与进度"),
  item("Timeline", "时间轴", "步骤与进度"),
  item("ProgressBar", "线性进度条", "步骤与进度"),
  item("UploadGrid", "上传网格", "上传与其他"),
  item("Avatar", "字形头像", "上传与其他"),
  item("IconTile", "图标块", "上传与其他"),
  item("Icon", "图标", "图标与短剧封面"),
  item("Cover", "短剧封面", "图标与短剧封面"),
  item("Skeleton", "骨架屏", "补充状态"),
  item("LoadError", "加载失败", "补充状态"),
  item("ListFooter", "触底加载", "补充状态"),
] as const;

export type GalleryName = (typeof GALLERY_ITEMS)[number]["name"];

/**
 * 基础样张：不属于哪个组件、看样时要对着规范看的几张（预览在 src/sub/gallery/sheets/）。
 * 预览页用 ?sheet=<名字> 打开；截图的文件名是 gallery__sheet-<名字>.png。
 */
export const GALLERY_SHEETS = [
  item("colors", "颜色", "颜色、文字与间距"),
  item("typography", "文字", "颜色、文字与间距"),
  item("spacing", "间距、圆角与描边", "颜色、文字与间距"),
  item("status-tone", "状态取色表", "状态取色"),
] as const;

export type GallerySheetName = (typeof GALLERY_SHEETS)[number]["name"];

/**
 * 陈列分包进不进构建。生产的小程序包缺省不带；这几种情况带：
 * H5 构建（只给截图命令用）、开发构建（pnpm --filter @liyoxi/weapp dev）、看样时显式给 WEAPP_GALLERY=1。
 */
export function galleryEnabled(env: Record<string, string | undefined>): boolean {
  if (env.WEAPP_GALLERY === "1") return true;
  if (env.WEAPP_GALLERY === "0") return false;
  return env.TARO_ENV === "h5" || env.NODE_ENV === "development";
}
