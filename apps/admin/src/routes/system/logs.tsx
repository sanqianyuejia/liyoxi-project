import { createRoute } from "@tanstack/react-router";
import { AuditLogsPage } from "../../features/system/logs/page";
import { auditSearch } from "../../features/system/logs/model";
import { requireModule } from "../../lib/guard";
import { rootRoute } from "../__root";
export const auditLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sys/logs",
  validateSearch: auditSearch,
  beforeLoad: ({ context }) => requireModule(context.access, "system"),
  staticData: { pageKey: "system.logs" },
  component: AuditLogsPage,
});
