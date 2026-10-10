import { createRoute } from "@tanstack/react-router";
import { AgreementsPage } from "../../features/ops/agreements/page";
import { agreementSearch } from "../../features/ops/agreements/model";
import { requireModule } from "../../lib/guard";
import { rootRoute } from "../__root";
export const agreementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ops/agreements",
  validateSearch: agreementSearch,
  beforeLoad: ({ context }) => requireModule(context.access, "ops"),
  staticData: { pageKey: "ops.agreements" },
  component: AgreementsPage,
});
