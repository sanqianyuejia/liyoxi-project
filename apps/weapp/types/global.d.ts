/// <reference types="@tarojs/taro" />

declare module "*.png";
declare module "*.jpg";
declare module "*.svg";
declare module "*.css";
declare module "*.scss";
declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/** 接口基址（不含 /api/v1），构建时由 WEAPP_API_BASE_URL 注入；没给时是空串，请求层据此空转 */
declare const __LYX_API_BASE_URL__: string;
/** 小程序版本号，构建时由 WEAPP_VERSION 注入 */
declare const __LYX_APP_VERSION__: string;
/** 错误上报的 DSN（公开部分），构建时由 WEAPP_SENTRY_DSN 注入；没给时是空串，错误上报不发请求 */
declare const __LYX_SENTRY_DSN__: string;

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production";
    /** 当前构建平台：本仓库只用 weapp；h5 只给截图命令用 */
    TARO_ENV: "weapp" | "h5";
    /** 组件陈列分包进不进构建："1" 带，"0" 不带；不给时 H5 与开发构建带，生产的小程序包不带 */
    WEAPP_GALLERY?: string;
  }
}
