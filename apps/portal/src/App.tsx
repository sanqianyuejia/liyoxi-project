// 下载页的空壳：一个占位页。页面与扫码登录在 M6（G6-B）；不放价格、套餐、购买入口与任何付款引导（D7 第 6 节）。
import { antdTheme, fontFamilySerif } from "@liyoxi/shared/design/antd-theme";
import { ConfigProvider, theme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";

/** 主题取 W0-26 的生成物，与后台同一份全局主题；不写色值 */
const portalTheme: ThemeConfig = { token: { ...antdTheme.token } };

function Placeholder() {
  const { token } = theme.useToken();
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: token.marginXS,
        padding: token.paddingLG,
        background: token.colorBgLayout,
        color: token.colorText,
        fontFamily: token.fontFamily,
        textAlign: "center",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: fontFamilySerif,
          fontSize: token.fontSizeHeading3,
          fontWeight: 700,
        }}
      >
        狸有戏 · 电脑端下载
      </h1>
      <p style={{ margin: 0, fontSize: token.fontSize, color: token.colorTextSecondary }}>
        页面建设中。请在狸有戏小程序里查看与确认成片。
      </p>
    </main>
  );
}

export function App() {
  return (
    <ConfigProvider theme={portalTheme} locale={zhCN}>
      <Placeholder />
    </ConfigProvider>
  );
}
