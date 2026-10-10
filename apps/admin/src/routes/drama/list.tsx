import { createRoute } from "@tanstack/react-router";
import { DramaListPage } from "../../features/drama/list";
import { dramaSearch } from "../../features/drama/list/model";
import { requireModule } from "../../lib/guard";
import { writeTableSearch } from "../../lib/table-search";
import { rootRoute } from "../__root";
export const dramaListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dramas",
  validateSearch: (raw) => writeTableSearch(dramaSearch(raw)),
  beforeLoad: ({ context }) => requireModule(context.access, "drama"),
  staticData: { pageKey: "drama.list" },
  component: DramaListPage,
});
