# D7 第 10 项 后台单测与构建配置共存

| 项 | 内容 |
| --- | --- |
| 编号 | D7 第 10 项 |
| 来源 | [计划](../../08-development-plan.md) 第 8.6 节表二；[D7](../../appendix/design/d7-platform.md) 第 10.6 节第 10 项 |
| 验证什么 | 后台单测（Vitest 4）与构建（Vite 8）的配置共存 |
| 通过标准 | 同一套配置都能跑，结论入库 |
| 依赖的业主事项 | 无 |
| 谁来做 | W0-28 |
| 最晚关闭点 | M0 退出 |
| 不通过的退路 | `apps/admin` 单独用 Vitest 5（D7 第 10.6 节第 10 项）。待核：计划 第 5.2 节把 Vitest 5 列为不能装的，与这条退路不一致；真要采用时先报业主定 |
| 状态 | 已关闭（通过） |
| 结论 | 能共存：后台的单测（Vitest 4.1.11）与构建（Vite 8.3.1）用同一份 `apps/admin/vite.config.ts`，两条命令都通过。不需要退路，`apps/admin` 不单独换 Vitest 版本。下载页照同样的写法。细节见下面“做法与限度” |
| 证据 | W0-28 的 PR 上 CI 运行的 `verify` 任务：“后台与下载页单测”（`pnpm --filter @liyoxi/admin --filter @liyoxi/portal test`）与“后台与下载页构建”（`pnpm admin:build && pnpm portal:build`）两步。PR 与运行的链接见 [状态文件](../status/W0-28.md) 的 PR 栏 |
| 关闭日期 | 2026-10-05 |

## 做法与限度

| 项 | 内容 |
| --- | --- |
| 同一份配置 | `apps/admin/vite.config.ts` 开头引 `vitest/config` 的类型，配置对象里多一个 `test` 段（项目名、Node 环境、`src/**/*.test.{ts,tsx}`）。`vite build` 不看这一段，`vitest run` 读同一个文件，插件（`@vitejs/plugin-react` 6.1.1、写构建号的插件）与 `define` 两边一样 |
| 只有一份 Vite | Vitest 4.1.11 把 `vite` 声明成 peer（`^6 \|\| ^7 \|\| ^8`）。锁文件里它解析到的就是后台装的 `vite@8.3.1`，全仓只有这一个版本，没有第二份 Vite 来读配置 |
| 两条命令 | 单测：`pnpm --filter @liyoxi/admin test`（即在 `apps/admin` 下 `vitest run`）。构建：`pnpm admin:build` |
| 与任务书写法的出入 | 任务书写的是在仓库根跑 `pnpm exec vitest run apps/admin`。根配置的项目清单只有 `packages/*`、`apps/{api,worker}`、`infra`，不含 `apps/admin`，那条命令一个用例都跑不到却以 0 退出。往根配置里加项目要改已有的一行，属“放松”类门禁改动，本包没做；后台的单测由它自己的脚本跑，CI 另有一步 |
| 没验的 | 单测都在 Node 环境里跑：结构用 `react-dom/server` 渲染后断言，交互留给 Playwright（任务书 第 11 节第 2 项，不新增 DOM 测试库）。“Vitest 4 + Vite 8 + jsdom 或 happy-dom”这一种组合没有验；以后要装 DOM 环境时另验 |

业主事项的状态见 [业主清单](../owner-checklist.md)。填写规则见 [README](README.md)。
