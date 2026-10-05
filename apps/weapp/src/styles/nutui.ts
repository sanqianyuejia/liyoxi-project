// NutUI 组件样式按需引入，唯一入口（D7 第 4.2 节：只留 7 个组件）。
// 页面新用一个 NutUI 组件，就在这里加一行它的 style/css；组件的脚本由打包器按引用带进来。
// 主题色在 src/app.scss 里用 --nutui-* 变量覆盖。Popup、Dialog、ActionSheet 要遮罩层，overlay 一并引入。
import "@nutui/nutui-react-taro/dist/es/packages/button/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/switch/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/overlay/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/popup/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/actionsheet/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/dialog/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/textarea/style/css";
import "@nutui/nutui-react-taro/dist/es/packages/loading/style/css";
