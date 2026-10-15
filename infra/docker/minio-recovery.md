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
