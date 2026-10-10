import { createRoute } from "@tanstack/react-router";
import { PricingPage } from "../../features/billing/pricing";
import { pricingSearch } from "../../features/billing/pricing/model";
import { requireModule } from "../../lib/guard";
import { writeTableSearch } from "../../lib/table-search";
import { rootRoute } from "../__root";
export const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing/pricing",
  validateSearch: (raw) => writeTableSearch(pricingSearch(raw)),
  beforeLoad: ({ context }) => requireModule(context.access, "billing"),
  staticData: { pageKey: "billing.pricing" },
  component: PricingPage,
});
