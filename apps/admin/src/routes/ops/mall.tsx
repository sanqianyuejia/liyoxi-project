import { createRoute } from "@tanstack/react-router";
import { OpsMallPage } from "../../features/ops/mall/page";
import { mallSearch } from "../../features/ops/mall/model";
import { requireModule } from "../../lib/guard";
import { rootRoute } from "../__root";
export const opsMallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ops/mall",
  validateSearch: mallSearch,
  beforeLoad: ({ context }) => requireModule(context.access, "ops"),
  staticData: { pageKey: "ops.mall" },
  component: OpsMallPage,
});
