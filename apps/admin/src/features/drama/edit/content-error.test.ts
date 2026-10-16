import { expect, it } from "vitest";
import { ContentFailure, contentError, contentListingFailures, contentResult } from "./api";

async function failure(details: unknown, error = "LISTING_CHECK_FAILED") {
  try {
    await contentResult({
      response: new Response(
        JSON.stringify({
          code: 49202,
          error,
          message: "上架校验有未通过的项，请按提示处理后再试",
          retryable: false,
          requestId: "listing-test",
          details,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    });
  } catch (result) {
    return result;
  }
  throw new Error("expected failure");
}
it("保留真实错误响应中的所有阻断项，显示具体校验编号和原因", async () => {
  const error = await failure({
    failed: [
      { code: "L10", note: "剧集和原片齐全" },
      { code: "L9", note: "基础信息齐全且封面可用" },
    ],
  });
  expect(error).toBeInstanceOf(ContentFailure);
  expect(contentError(error)).toBe(
    "上架校验未通过：L10：剧集和原片齐全；L9：基础信息齐全且封面可用",
  );
  expect(contentListingFailures(error)).toHaveLength(2);
});
it("缺失或不合法的 details 保留通用错误，不把其他错误误认为上架失败", async () => {
  for (const details of [undefined, null, { failed: [{ code: "L10" }] }]) {
    expect(contentError(await failure(details))).toBe("上架校验有未通过的项，请按提示处理后再试");
  }
  expect(
    contentListingFailures(
      await failure({ failed: [{ code: "L10", note: "原片缺失" }] }, "VERSION_CONFLICT"),
    ),
  ).toEqual([]);
});
