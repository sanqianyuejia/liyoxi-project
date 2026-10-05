// W0-06b 的门禁：迁移规范检查（pnpm db:migration-lint；D7 第 8.3 节第 5 条）。新迁移里一条不带标记的
// DROP COLUMN，检查必须失败，并指到那一行。Prisma 出的迁移草稿里会夹带不是本次要做的 DROP（ADR-045），漏删就靠它拦。
// 不动本仓库的文件：在仓库外的临时 git 仓库里放一个“已经合并的”迁移并提交，再在工作区加一个新迁移。
// 检查不再认 DROP、或不带标记也放过时，这一例会红。
const MIGRATIONS = "packages/db/prisma/migrations";
const NEXT = `${MIGRATIONS}/20260201000000_drop_legacy/migration.sql`;

export default {
  gate: "迁移规范检查（db:migration-lint）",
  mutation: "新迁移里一条不带标记的 ALTER TABLE … DROP COLUMN",
  reason:
    /20260201000000_drop_legacy\/migration\.sql 第 2 行：DROP 没有带 “-- lyx:allow <理由>”：ALTER TABLE "store" DROP COLUMN "legacy_code";[\s\S]*迁移规范检查未通过：1 处/,
  run(ctx) {
    const dir = ctx.gitRepo({
      [`${MIGRATIONS}/20260101000000_init/migration.sql`]:
        'CREATE TABLE "store" ("id" UUID NOT NULL, "legacy_code" TEXT);\n',
    });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.writeFiles(dir, {
      [NEXT]: '-- 删掉不用的列\nALTER TABLE "store" DROP COLUMN "legacy_code";\n',
    });
    return ctx.node("infra/ci/migration-lint.mjs", ["--root", dir, "--base", "HEAD"]);
  },
};
