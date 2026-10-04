// 路由树。现在是手写装配：@tanstack/router-plugin（文件路由的生成器）装上会把已有依赖的解析版本带着变，
// 属“放松”类门禁改动，要等单独的依赖 PR（见 docs/plan/status/W0-28.md 偏差）。
// 约定照文件路由来：一个画板一个路由文件，放在 src/routes/<模块>/ 下；每个模块一个清单（modules/），
// 页面包只动自己模块的清单，这个文件不用改。
import { rootRoute } from "./__root";
import { devRoutes } from "./_dev";
import { forbiddenRoute } from "./forbidden";
import { billingRoutes } from "./modules/billing";
import { channelRoutes } from "./modules/channel";
import { deliveryRoutes } from "./modules/delivery";
import { dramaRoutes } from "./modules/drama";
import { financeRoutes } from "./modules/finance";
import { merchantRoutes } from "./modules/merchant";
import { opsRoutes } from "./modules/ops";
import { orderRoutes } from "./modules/order";
import { publishRoutes } from "./modules/publish";
import { reportRoutes } from "./modules/report";
import { serviceRoutes } from "./modules/service";
import { systemRoutes } from "./modules/system";
import { workbenchRoutes } from "./modules/workbench";
import { indexRoute, splatRoute } from "./registered";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  forbiddenRoute,
  ...workbenchRoutes,
  ...dramaRoutes,
  ...billingRoutes,
  ...merchantRoutes,
  ...orderRoutes,
  ...deliveryRoutes,
  ...publishRoutes,
  ...serviceRoutes,
  ...financeRoutes,
  ...reportRoutes,
  ...opsRoutes,
  ...systemRoutes,
  ...channelRoutes,
  // 样例路由：生产构建里没有内容，访问即“页面不存在”
  ...devRoutes,
  // 通配放最后：登记了但还没实现的页面都落到它
  splatRoute,
]);
