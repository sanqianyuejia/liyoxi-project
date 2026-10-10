import { createHash } from "node:crypto";
import { createIdentityContext, uuidv7 } from "../../kernel/index.js";
import { docx, pdf } from "../document-fixtures.js";
import type { AdminLiveFixture } from "./context.js";

/** Runs after qualification's real version inputs; normal seed contains only the agreement list.
 * Fictional signing inputs only. Browser versions/files still use the actual eight APIs. */
const fixture: AdminLiveFixture = async ({ runtime, make }) => {
  const versions = await runtime.tx.run((tx) => runtime.docs.currentVersions(tx));
  const userVersion = versions.get("user"),
    privacyVersion = versions.get("privacy");
  if (!userVersion || !privacyVersion) throw new Error("协议演练缺少现有用户级占位版本");
  const receipts = [];
  for (let index = 0; index < 12; index++) {
    const user = await make.merchantUser({ displayName: `协议虚构签署人${index + 1}` });
    if (!user.phoneEnc || !user.phoneMask) throw new Error("协议演练缺少虚构签署手机号事实");
    const identity = createIdentityContext({
      actor: { type: "merchant", id: user.id, client: "weapp" },
      requestId: uuidv7(),
      ip: "127.0.0.1",
      userAgent: "lyxtest W216 fictional consent",
    });
    const result = await runtime.tx.run((tx) =>
      runtime.docs.assertConsents(tx, identity, {
        scene: "reconsent",
        consents: [
          { agreementKey: "user", agreementVersionId: userVersion.id },
          { agreementKey: "privacy", agreementVersionId: privacyVersion.id },
        ],
        signer: {
          merchantUserId: user.id,
          phoneEnc: user.phoneEnc!,
          phoneMask: user.phoneMask!,
          operatorNameMask: "虚*",
          role: null,
          appid: null,
          openidHmac: null,
        },
        device: { model: "fictional-device", appVersion: "1.0.0" },
      }),
    );
    receipts.push(...result.consents.map((row) => ({ ...row, phoneMask: user.phoneMask })));
  }
  const text = "狸有戏虚构协议 测试门店 123";
  const files = (
    [
      ["docx", docx(text)],
      ["pdf", pdf(text)],
    ] as const
  ).map(([ext, bytes]) => ({
    name: `W216-fictional-agreement.${ext}`,
    mime:
      ext === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    base64: Buffer.from(bytes).toString("base64"),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  return {
    agreementKey: "custom_license",
    noticeAgreementKey: "points",
    files,
    receipts,
    current: { agreementVersionId: userVersion.id },
    // This is an external legal placeholder, never an assertion that E8 was supplied.
    legalStatus: "fictional_only",
  };
};
export default fixture;
