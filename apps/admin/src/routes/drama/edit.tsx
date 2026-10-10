import { createRoute } from "@tanstack/react-router";
import { DramaEditPage } from "../../features/drama/edit";
import { editSearch } from "../../features/drama/edit/model";
import { requireModule } from "../../lib/guard";
import { rootRoute } from "../__root";
export const dramaEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dramas/$id",
  validateSearch: editSearch,
  beforeLoad: ({ context }) => requireModule(context.access, "drama"),
  staticData: { pageKey: "drama.edit" },
  component: DramaEditPage,
});
