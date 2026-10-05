// W1-05 的门禁：文案约束（pnpm lint:copy；规范 第 11 节“登录相关文案不出现‘微信’二字”）。
// 在仓库外摆一个登录页：按钮写“微信手机号快捷登录”，另有一句“添加企业微信”（规范写明不受影响的说法）
// 与一行带“微信”的注释。检查必须失败，指到规则与文件的那一行，且不报另外两行。
// 规则被删掉或改了范围、登记的说法放宽到盖住这句话、检查脚本改成空转时，这一例会红。
import { copyTree, runCopyCheck } from "../lib/copy.mjs";

const PAGE = "apps/weapp/src/pages/login/index.tsx";
const SOURCE = [
  "// 登录按钮不写微信二字",
  "export default function Login() {",
  "  return (",
  "    <View>",
  "      <Button>微信手机号快捷登录</Button>",
  "      <Text>有问题可以添加企业微信</Text>",
  "    </View>",
  "  );",
  "}",
  "",
].join("\n");
const escaped = PAGE.replaceAll(".", "\\.");

export default {
  gate: "文案约束（lint:copy）",
  mutation: "登录页的按钮写“微信手机号快捷登录”，另有一句“添加企业微信”与一行带“微信”的注释",
  reason: new RegExp(
    `^(?![\\s\\S]*${escaped}:(?:1|6):)[\\s\\S]*文案约束检查未通过[\\s\\S]*${escaped}:5:15: 规则 login-no-wechat：出现“微信”`,
  ),
  run(ctx) {
    return runCopyCheck(ctx, copyTree(ctx, { [PAGE]: SOURCE }));
  },
};
