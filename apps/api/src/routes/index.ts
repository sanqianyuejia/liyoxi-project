// 全部处理器的清单（W0-22）。各域的接口包：在本目录下建自己的文件（一条契约路由配一个 defineHandler），
// 在这里加一行展开。探活不在这里，在 ../probes.ts。
import type { HandlerEntry } from "../routing/define.js";

import { agreementHandlers } from "./agreements.js";
import { sessionHandlers } from "./sessions.js";

export const HANDLERS: readonly HandlerEntry[] = [
  // W1-03：协议清单与版本正文（两条公开路由）
  ...agreementHandlers,
  // W1-04：静默登录、手机号登录、退出、当前账号
  ...sessionHandlers,
];
