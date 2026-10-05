// 操作反馈（规范 第 8 节；第 14 节第 1 项的默认）：浮层轻提示，纯文字，最多两行，约 2.5 秒后消失。
// 成功与失败用同一个样子，不另设红色款；失败的文案写原因与下一步。无网络时也用它，页面保留已加载的内容（规范 第 12 节）。
import Taro from "@tarojs/taro";

export const TOAST_DURATION_MS = 2500;

/** 文案由调用方给：操作结果用“已”字句，校验提示用“请……”开头（规范 第 7 节） */
export function toast(message: string): void {
  void Taro.showToast({ title: message, icon: "none", duration: TOAST_DURATION_MS });
}
