/// <reference types="vite/client" />

/** 构建号：与 index.html 的 <meta name="lyx-build">、产物里的 build.json 同值（vite.config.ts） */
declare const __LYX_BUILD__: string;
/** 是否带样例页与夹具：生产构建为 false，相关代码整段被摇掉（scripts/check-build.mjs 有断言） */
declare const __LYX_DEV_FIXTURES__: boolean;

/** 仅本地 Vite 开发的存储代理源，其他构建为空。 */
declare const __LYX_LOCAL_STORAGE_ORIGIN__: string;
