import { maxUploadBytes } from "@liyoxi/shared/uploads";
import type { AppServices } from "../../../app/services";
import {
  createAdminMultipartUploadPorts,
  createMultipartUploadAdapter,
} from "../../../lib/upload-multipart";
import type { UploadRule } from "../../../lib/upload";
export const WORD_RULE: UploadRule = {
  accept: [".docx"],
  maxSizeMb: Number(maxUploadBytes("legal_doc", "docx", "admin")) / 1024 / 1024,
};
export const PDF_RULE: UploadRule = {
  accept: [".pdf"],
  maxSizeMb: Number(maxUploadBytes("legal_doc", "pdf", "admin")) / 1024 / 1024,
};
export function createAgreementUploader({ api }: Pick<AppServices, "api">) {
  return createMultipartUploadAdapter({
    ports: createAdminMultipartUploadPorts(api.client, { category: "legal_doc" }),
  });
}
