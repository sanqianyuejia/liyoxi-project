// 运营模块的路由清单；协议与其他M7页面各由后续工作包追加。
import { opsHomeRoute } from "../ops/home";
import { opsMallRoute } from "../ops/mall";
export const opsRoutes = [opsHomeRoute, opsMallRoute] as const;
