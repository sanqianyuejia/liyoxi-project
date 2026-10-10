// 短剧库模块的路由清单（D7第5.2节）。静态列表和参数详情分别登记。
import { dramaListRoute } from "../drama/list";
import { dramaEditRoute } from "../drama/edit";
export const dramaRoutes = [dramaListRoute, dramaEditRoute] as const;
