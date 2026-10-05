// 狸有戏 · 全仓 ESLint 10 flat config。规则片段在 packages/config/eslint，这里只做装配。
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import {
  dataAccessFiles,
  dataAccessRules,
  prismaCtorOnlyFiles,
  prismaCtorOnlyRules,
  prismaCtorWithTxFiles,
  prismaCtorWithTxRules,
  repoRules,
  scriptFiles,
  scriptRules,
  serverFiles,
  serverRules,
  txEntryFiles,
  txEntryRules,
  weappFiles,
  weappGlobals,
  weappRules,
} from "./packages/config/eslint/index.js";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    // 依据文档、设计稿与校验工具：不 lint
    "docs/**",
    "design/**",
    "tools/**",
    // 智能体会话留下的 git worktree：是同一个仓库的另一份检出，不该被再扫一遍
    ".claude/worktrees/**",
    // 生成物：只认这三个路径模式，后面的包把生成物放进这里，不再加忽略项
    "**/generated/**",
    "packages/db/snapshot/**",
    "packages/contract/golden/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // 全仓
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: repoRules,
  },
  {
    // 应用层源码：不引数据包与数据库驱动（D3）。片段里已并入全仓的禁用项
    files: dataAccessFiles,
    rules: dataAccessRules,
  },
  {
    // 服务端：禁 console.log
    files: serverFiles,
    rules: serverRules,
  },
  {
    // 三个前端：hooks 规则。不装 eslint-plugin-react（peer 不含 ESLint 10）
    files: ["apps/{weapp,admin,portal}/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // 小程序：禁浏览器全局对象
    files: weappFiles,
    languageOptions: { globals: weappGlobals },
    rules: weappRules,
  },
  {
    // 脚本与配置文件放宽 console
    files: scriptFiles,
    rules: scriptRules,
  },
  {
    // 开事务只有 kernel 一个入口：kernel 之外不得出现 $transaction（W0-07）
    files: txEntryFiles,
    rules: txEntryRules,
  },
  {
    // Prisma 客户端只由 packages/db 的工厂构造：别处不得 new PrismaClient（W0-07b）。
    // 与上一条是同一条规则，后写的整条盖掉前面的：这里的条目已把事务入口那两条拼进去
    files: prismaCtorWithTxFiles,
    rules: prismaCtorWithTxRules,
  },
  {
    // 同上，管事务入口规则不管的 kernel 与 testing
    files: prismaCtorOnlyFiles,
    rules: prismaCtorOnlyRules,
  },
  prettier,
);
