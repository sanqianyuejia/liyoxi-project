/**
 * 夹具与样例页的标记：只出现在 src/dev/ 下的模块里。生产构建不含夹具，
 * scripts/check-build.mjs 断言产物里找不到这个字符串。
 */
export const DEV_FIXTURE_MARK = "lyx-dev-fixture";
