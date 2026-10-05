// ESLint 规则片段的出口：全仓、服务端、小程序三块（D7 第 2.2 节 D9），外加数据访问一块（D3）。
export { dataAccessFiles, dataAccessRestrictedImports, dataAccessRules } from "./data-access.js";
export { repoRestrictedImports, repoRules } from "./repo.js";
export { scriptFiles, scriptRules, serverFiles, serverRules } from "./server.js";
export { weappFiles, weappGlobals, weappRules } from "./weapp.js";
export { txEntryFiles, txEntryRestrictedSyntax, txEntryRules } from "./tx.js";
