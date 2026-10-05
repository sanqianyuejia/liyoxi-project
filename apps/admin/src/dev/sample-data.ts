// 样例页的夹具数据：只为演示三种骨架，不对应任何真实接口的结构。内容照原型的“商家列表”“资质审核”“商家详情”。
// 手机号、信用代码只有脱敏后的样子（接口本身就返回脱敏值，D7 第 5.3 节）。

export type QualificationStatus = "pending" | "verified" | "rejected";

export interface SampleStore {
  id: string;
  name: string;
  entityName: string;
  region: string;
  category: string;
  qualificationStatus: QualificationStatus;
  source: "sales" | "organic";
  manager: string | null;
  planName: string;
  planExpireDay: string;
  availablePoints: number;
  paidFen: number;
  lastOrderAt: string;
  registeredDay: string;
  lockVersion: number;
}

const NAMES = [
  ["晴天洗衣", "成都晴天洗涤服务有限公司", "成华区", "生活服务 / 洗衣"],
  ["悦心瑜伽", "成都悦心健身服务有限公司", "武侯区", "运动健身 / 瑜伽"],
  ["胖哥冒菜", "金牛区胖哥冒菜店", "金牛区", "餐饮 / 冒菜"],
  ["小鹿亲子乐园", "成都小鹿文化传播有限公司", "龙泉驿区", "亲子 / 亲子乐园"],
  ["半岛茶楼", "成都半岛茶楼有限公司", "青羊区", "休闲娱乐 / 茶楼"],
  ["橙子宠物", "成华区橙子宠物用品店", "成华区", "宠物 / 宠物店"],
  ["老街烧烤", "武侯区老街烧烤店", "武侯区", "餐饮 / 烧烤"],
  ["云间民宿", "都江堰市云间民宿", "都江堰市", "酒店住宿 / 民宿"],
  ["拾光咖啡", "成都拾光咖啡有限公司", "高新区", "餐饮 / 咖啡"],
  ["青柠茶饮", "成都青柠餐饮管理有限公司", "锦江区", "餐饮 / 茶饮"],
] as const;

const PLANS = ["基础版", "专业版", "旗舰版"] as const;
const MANAGERS = ["林晓", "韩冬", "苏晴", null] as const;
const pad = (value: number): string => String(value).padStart(2, "0");

/** 46 家门店，顺序与内容固定：翻页、筛选、排序的断言都靠它稳定 */
export const SAMPLE_STORES: readonly SampleStore[] = Array.from({ length: 46 }, (_, index) => {
  const base = NAMES[index % NAMES.length] ?? NAMES[0];
  const round = Math.floor(index / NAMES.length);
  const status: QualificationStatus =
    index % 9 === 0 ? "pending" : index % 13 === 5 ? "rejected" : "verified";
  return {
    id: `st-${pad(index + 1)}`,
    name: round === 0 ? base[0] : `${base[0]}（${round + 1} 号店）`,
    entityName: base[1],
    region: base[2],
    category: base[3],
    qualificationStatus: status,
    source: index % 2 === 0 ? "sales" : "organic",
    manager: MANAGERS[index % MANAGERS.length] ?? null,
    planName: PLANS[index % PLANS.length] ?? PLANS[0],
    planExpireDay: `2026-10-${pad(10 + (index % 18))}`,
    availablePoints: 1200 + ((index * 370) % 5200),
    paidFen: (3000 + ((index * 1700) % 74000)) * 100,
    lastOrderAt: `2026-09-${pad(30 - (index % 20))}T0${index % 10}:${pad((index * 7) % 60)}:00+08:00`,
    registeredDay: `2026-0${6 + (index % 4)}-${pad(1 + (index % 27))}`,
    lockVersion: 1 + (index % 3),
  };
});

export interface SampleStoreDetail extends SampleStore {
  phoneMasked: string;
  /** 二次确认要操作人照着输入的关键值：手机号后 4 位 */
  phoneTail: string;
  contact: string;
  address: string;
  businessHours: string;
  avgSpendFen: number;
  disabled: boolean;
  // 不写 readonly：openapi-fetch 的类型变换认不出只读数组
  logs: { at: string; actor: string; text: string }[];
}

export interface SampleReview {
  id: string;
  storeName: string;
  category: string;
  region: string;
  entityName: string;
  contactMasked: string;
  kind: "首次提交" | "新增门店";
  submittedAt: string;
  deadlineAt: string;
  lockVersion: number;
  fields: { label: string; value: string; verdict: string; ok: boolean }[];
}

/**
 * 队列接口返回的一条：待审核的没有处理结果；已处理的带资质状态（库里的取值，色调与叫法由状态字典给，
 * 页面不自己判）与处理人（别人处理的才有）。
 */
export type SampleReviewItem = SampleReview & {
  qualificationStatus?: Exclude<QualificationStatus, "pending">;
  handledBy?: string;
};

export const SAMPLE_REVIEWS: readonly SampleReview[] = [
  [
    "rv-1",
    "青柠茶饮（春熙路店）",
    "餐饮 / 茶饮",
    "成都市锦江区",
    "成都青柠餐饮管理有限公司",
    "首次提交",
    "11:40",
  ],
  [
    "rv-2",
    "好运来便利店",
    "零售 / 便利店",
    "成都市新都区",
    "新都区好运来便利店",
    "首次提交",
    "15:10",
  ],
  [
    "rv-3",
    "晴天洗衣",
    "生活服务 / 洗衣",
    "成都市成华区",
    "成都晴天洗涤服务有限公司",
    "首次提交",
    "17:45",
  ],
  [
    "rv-4",
    "XX 火锅（春熙店）",
    "餐饮 / 火锅",
    "成都市锦江区",
    "XX 餐饮管理有限公司",
    "新增门店",
    "18:20",
  ],
].map(([id, storeName, category, region, entityName, kind, time], index) => ({
  id: id ?? "",
  storeName: storeName ?? "",
  category: category ?? "",
  region: region ?? "",
  entityName: entityName ?? "",
  contactMasked: `陈女士 139****20${40 + index}`,
  kind: kind === "新增门店" ? "新增门店" : "首次提交",
  submittedAt: `2026-09-29T${time}:00+08:00`,
  deadlineAt: `2026-09-30T${time}:00+08:00`,
  lockVersion: 1,
  fields: [
    { label: "名称", value: entityName ?? "", verdict: "与档案一致", ok: true },
    { label: "统一社会信用代码", value: "91510104MA6C****8K", verdict: "格式有效", ok: true },
    { label: "法定代表人", value: "陈**", verdict: "—", ok: true },
    { label: "营业期限", value: "长期", verdict: "在有效期内", ok: true },
    { label: "住所", value: `${region ?? ""}［详细地址］`, verdict: "与门店地址一致", ok: true },
  ],
}));

/** 审核清单：真实页面里来自数据字典（D7 第 5.3 节） */
export const SAMPLE_CHECKLIST = [
  { key: "name", label: "证照上的名称与档案里的主体名称一致" },
  { key: "term", label: "营业期限在有效期内" },
  { key: "address", label: "住所与门店地址一致，或已说明原因" },
] as const;
