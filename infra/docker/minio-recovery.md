# MinIO 固定版本迁移

2026-10-15，业主同意将旧 MinIO 镜像迁入当前项目并公开。旧 GHCR 源拒绝 CI 拉取，恢复入口是 `images.yml` 的 `mirror_minio` 手动输入；应用发布仍要求 main 和原发布开关。

当前恢复版本为 `RELEASE.2025-09-07T16-13-09Z`，目标 `ghcr.io/sanqianyuejia/liyoxi/minio`。非官方缓存 `ghcr.linkos.org/ghcr.io/byfire-dev/minio` 仅提供传输，其 amd64、arm64 清单字节摘要已与本机既有镜像核对：

| 架构 | 固定子清单 SHA256 |
| --- | --- |
| linux/amd64 | `a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2` |
| linux/arm64 | `9966a92a734f9411e32f4f41d7d9d826fcdc0f68c4e20b70295bd4e7c11f8a2f` |

Docker 按固定摘要验证拉取内容，再检查架构与版本标签；不运行镜像。任务仅将这两个架构组合为新清单，不宣称保留旧索引中的其他架构，也不把缓存来源当成官方签名证明。

执行前完成独立审查，把 `MINIO_MIRROR_APPROVED_SHA` 设置为受审分支的完整提交 SHA，设置 `MINIO_MIRROR_ENABLED=true`，对该分支手动调度 `mirror_minio=true`。任务用本仓库 `GITHUB_TOKEN` 的 `packages:write` 登录 GHCR，不需要个人 PAT；拉取缓存的步骤不接收令牌。结束后关闭恢复开关并删除批准 SHA。

首次发布后按业主授权将包设为 Public，验证匿名访问、两个架构和新清单摘要，再把 Compose 引用改成版本加摘要。未经实际运行、可见性设置和匿名验证，不登记为迁移完成。此入口不部署服务器，不开启 COS 上传或小程序发布。

## 2026-10-15 实际恢复结果

[恢复运行](https://github.com/sanqianyuejia/liyoxi-project/actions/runs/38668977176)已成功。GitHub 包页面明确显示 Public，并关联本项目 `sanqianyuejia/liyoxi-project`。通过匿名令牌读取索引、两份子清单和配置均成功；两种架构各有 9 层，版本均为 `RELEASE.2025-09-07T16-13-09Z`。

本机 ARM64 已按新索引摘要完成匿名 `docker pull`。源、目标两架构的配置摘要（含全部解压层摘要）逐一相同；推送后的基础层压缩摘要有变化，因此子清单和索引采用上表之外的新输出摘要，不宣称压缩文件逐字复制。

| 输出 | 恢复后 SHA256 |
| --- | --- |
| 双架构索引 | `37a173a1c3042bdbbd9904bd3ab7c4c7b17f607b268220a607a685c14d94d1cb` |
| linux/amd64 子清单 | `52dfd5c0bbd38d3219f2058c7af216d9f9a27a994b7b5baad09bbd38866015ff` |
| linux/arm64 子清单 | `2f25127f784f002f1b98df5ae40cb1a67e0b8a877c90b6113c14b223a2ac65a5` |

恢复开关 `MINIO_MIRROR_ENABLED` 已设回 `false`，`MINIO_MIRROR_APPROVED_SHA` 已删除。Compose 现固定为 `ghcr.io/sanqianyuejia/liyoxi/minio:RELEASE.2025-09-07T16-13-09Z@sha256:37a173a1c3042bdbbd9904bd3ab7c4c7b17f607b268220a607a685c14d94d1cb`。本次完成镜像迁移、公开与匿名读取验证；服务器部署及业务验收另行记录，本次引用更新未启动或重启容器。
