import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BasicDialog } from "../../src/features/drama/edit/basic";
import { contentResult } from "../../src/features/drama/edit/api";
import type { DramaApi, DramaDetail } from "../../src/features/drama/edit/api";

const oldId = "019a1111-1111-7111-8111-000000000001";
const newId = "019a1111-1111-7111-8111-000000000002";
const drama = {
  dramaId: "019a1111-1111-7111-8111-000000000003",
  lockVersion: 4,
  title: "巷口那家店",
  posterFileId: oldId,
  totalEpisodes: 60,
  episodeDurationSec: 90,
  genres: [],
  sellingTags: [],
  producerName: null,
  castNames: null,
  synopsis: null,
  dramaClass: null,
  isAiGenerated: false,
} as unknown as DramaDetail;
function Fixture() {
  const [saved, setSaved] = useState("未保存");
  const [attempts, setAttempts] = useState(0);
  const [api] = useState(
    () =>
      ({
        file: async () => ({
          fileId: newId,
          mode: "post",
          status: "pending",
          expiresAt: "2099-01-01T00:00:00Z",
          uploadExpiresAt: "2099-01-01T00:00:00Z",
          post: { url: `${location.origin}/cover-upload-target`, fields: {} },
        }),
        complete: async () => ({ status: "stored" }),
        basic: async (_id: string, body: { posterFileId: string | null }) => {
          setAttempts((value) => value + 1);
          if (new URLSearchParams(location.search).has("listingBlocked")) {
            return contentResult({
              response: new Response(
                JSON.stringify({
                  code: 49202,
                  error: "LISTING_CHECK_FAILED",
                  message: "上架校验有未通过的项，请按提示处理后再试",
                  retryable: false,
                  requestId: "cover-listing-test",
                  details: { failed: [{ code: "L10", note: "剧集和原片齐全" }] },
                }),
                { status: 409 },
              ),
            });
          }
          setSaved(body.posterFileId ?? "已移除");
          return { lockVersion: 5 };
        },
      }) as unknown as DramaApi,
  );
  return (
    <>
      <output data-testid="saved">{saved}</output>
      <output data-testid="save-attempts">{attempts}</output>
      <BasicDialog api={api} drama={drama} dictionary={[]} onClose={() => {}} onSaved={() => {}} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
