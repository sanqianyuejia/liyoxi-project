import { createRoute } from "@tanstack/react-router";
import { OpsHomePage } from "../../features/ops/home/page";
import { homeSearch } from "../../features/ops/home/model";
import { requireModule } from "../../lib/guard";
import { rootRoute } from "../__root";
export const opsHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ops/home",
  validateSearch: homeSearch,
  beforeLoad: ({ context }) => requireModule(context.access, "ops"),
  staticData: { pageKey: "ops.home" },
  component: OpsHomePage,
});
