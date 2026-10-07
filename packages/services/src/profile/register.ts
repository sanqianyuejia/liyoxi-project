import { profilePiiFields } from "./pii-fields.js";
import { approvalKindPort } from "../approval/index.js";
import {
  defineRegistration,
  fileRefTypePort,
  implementKeyed,
  implementMerchantFacts,
} from "../kernel/index.js";
import type { ExpectedFileRef } from "../kernel/index.js";
import { findViolations, PROFILE_INVARIANT_CODES } from "./invariants.js";
import { adminProfileFactsPort } from "./admin-ports.js";
import { deliveryManagerPort, orderManagerPort } from "./ports.js";
import { qualificationKind } from "./qualification-kind.js";
import { dictRef, snapshot } from "./repo.js";

export const registration = defineRegistration("profile", {
  ports: [orderManagerPort, deliveryManagerPort, adminProfileFactsPort],
  portImplementations: [
    implementKeyed(dictReferencesPort, "profile", profileDictReferences),
    ...profilePiiFields,
    implementKeyed(approvalKindPort, "qualification", qualificationKind),
    implementMerchantFacts("profile", async (tx, query) => {
      const stores: Record<
        string,
        {
          city: Awaited<ReturnType<typeof dictRef>>;
          category: Awaited<ReturnType<typeof dictRef>>;
          verifiedAt: Date | null;
          submittedAt: Date | null;
          expectedDecisionAt: Date | null;
          completenessPct: number;
        }
      > = {};
      for (const storeId of query.storeIds) {
        const s = await snapshot(tx, storeId);
        if (s.store.entityId !== query.entityId)
          throw new TypeError("profile 事实查询的门店不属于主体");
        stores[storeId] = {
          city: await dictRef(tx, "region", s.profile?.cityCode),
          category: await dictRef(tx, "industry", s.profile?.categoryCode),
          verifiedAt: s.profile?.firstVerifiedAt ?? null,
          submittedAt: s.open?.submittedAt ?? null,
          expectedDecisionAt: s.open?.approvalRequest?.dueAt ?? null,
          completenessPct: s.completeness.pct,
        };
      }
      return { stores };
    }),
    implementKeyed(fileRefTypePort, "store_profile", {
      roles: { logo: { categories: ["profile_image"], retentionDays: 30 } },
      readColumns: async (tx) =>
        (
          await tx.storeProfile.findMany({
            where: { logoFileId: { not: null } },
            select: { storeId: true, logoFileId: true },
          })
        ).map((row) => ({ fileId: row.logoFileId!, refId: row.storeId, role: "logo" })),
    }),
    implementKeyed(fileRefTypePort, "store_profile_media", {
      roles: {
        main: {
          categories: ["profile_image", "profile_video", "profile_promo"],
          retentionDays: 30,
        },
      },
      readColumns: async (tx) =>
        (
          await tx.storeProfileMedia.findMany({
            where: { removedAt: null },
            select: { id: true, fileId: true },
          })
        ).map((row) => ({ fileId: row.fileId, refId: row.id, role: "main" })),
    }),
    implementKeyed(fileRefTypePort, "store_service_item", {
      roles: { image: { categories: ["profile_image"], retentionDays: 30 } },
      readColumns: async (tx) =>
        (
          await tx.storeServiceItem.findMany({
            where: { removedAt: null, imageFileId: { not: null } },
            select: { id: true, imageFileId: true },
          })
        ).map((row) => ({ fileId: row.imageFileId!, refId: row.id, role: "image" })),
    }),
    implementKeyed(fileRefTypePort, "qualification_doc", {
      roles: {
        main: {
          categories: ["kyc_license", "kyc_permit"],
          retentionDays: 7,
          canRelease: async (tx, id) => {
            const doc = await tx.qualificationDoc.findUnique({
              where: { id },
              include: { entity: { select: { lifecycle: true } } },
            });
            return (
              !doc ||
              doc.removedAt !== null ||
              doc.supersededAt !== null ||
              doc.entity.lifecycle === "closed"
            );
          },
        },
      },
      readColumns: async (tx) =>
        (
          await tx.qualificationDoc.findMany({
            where: { removedAt: null, entity: { lifecycle: { not: "closed" } } },
            select: { id: true, fileId: true },
          })
        ).map((row): ExpectedFileRef => ({ fileId: row.fileId, refId: row.id, role: "main" })),
    }),
  ],
  invariants: PROFILE_INVARIANT_CODES.map((code) => ({
    code: `profile.${code}`,
    severity: "P2",
    modes: ["full"],
    heal: code === "I6" ? "heal_and_alert" : "none",
    run: (tx, scope, ctx) => findViolations(tx, code, scope, ctx),
  })),
});

import { dictReferencesPort } from "../kernel/index.js";
import { profileDictReferences } from "./dict-references.js";
