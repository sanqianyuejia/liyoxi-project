// W2-04 固定对象类型的只读密文事实端口。范围由来源模块按现有 authz 谓词裁剪；缺失不是空明文。
import type { PiiRevealBody, PiiSubjectType } from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { defineKeyedPort, implementKeyed } from "../assembly/index.js";
import type { Assembly, PortImplementation } from "../assembly/index.js";
export type PiiFactDb = Omit<Prisma.TransactionClient, "$transaction">;
export interface PiiFieldQuery extends Pick<PiiRevealBody, "subjectType" | "subjectId" | "field"> {
  readonly scope: unknown;
}
export interface PiiFieldFact {
  readonly enc: string | null;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly label: string | null;
}
export type PiiFieldProvider = (
  db: PiiFactDb,
  query: PiiFieldQuery,
) => Promise<PiiFieldFact | null>;
export const piiFieldsPort = defineKeyedPort<PiiFieldProvider>("security.pii_fields");
export const implementPiiFields = (
  subject: PiiSubjectType,
  provider: PiiFieldProvider,
): PortImplementation => implementKeyed(piiFieldsPort, subject, provider);
export function piiFieldsOf(assembly: Pick<Assembly, "portEntries">) {
  const providers = assembly.portEntries(piiFieldsPort);
  return {
    read: async (db: PiiFactDb, query: PiiFieldQuery) =>
      providers.get(query.subjectType)?.(db, query) ?? null,
  };
}
