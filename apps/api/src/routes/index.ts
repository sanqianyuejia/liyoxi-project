// 全部处理器的清单（W0-22）。各域的接口包：在本目录下建自己的文件（一条契约路由配一个 defineHandler），
// 在这里加一行展开。现在契约里还没有带结构的路由，清单是空的；探活不在这里，在 ../probes.ts。
import type { HandlerEntry } from "../routing/define.js";

export const HANDLERS: readonly HandlerEntry[] = [];
