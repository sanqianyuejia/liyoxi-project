// authz 模块（L0）的出口。后台的判定与数据范围由 W1-01a 交；各包只在末尾加自己的导出行。
// W1-04 商家侧授权：能力点判定、门店与主体的数据范围（./merchant）
export * from "./merchant/index.js";
