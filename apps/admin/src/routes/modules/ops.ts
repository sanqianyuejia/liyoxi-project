// 运营模块的路由清单。页面包把自己的路由文件放在 src/routes/ops/ 下，在这里加一行；
// 一个模块一个清单，别的模块不用动（计划 第 9.3 节）。写法见 apps/admin/README.md“加一个页面”。
import { agreementsRoute } from "../ops/agreements";
import { opsHomeRoute } from "../ops/home";
import { opsMallRoute } from "../ops/mall";
export const opsRoutes = [opsHomeRoute, opsMallRoute, agreementsRoute] as const;
