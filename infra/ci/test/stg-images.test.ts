import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./helpers.js";

const images = readFileSync(join(repoRoot, ".github/workflows/images.yml"), "utf8");
const deploy = readFileSync(join(repoRoot, ".github/workflows/deploy-stg.yml"), "utf8");
const job = (text: string, id: string) =>
  text.split(`  ${id}:\n`)[1]?.split(/^ {2}[\w-]+:\n/m)[0] ?? "";

describe("W2-25b 构建与外部写边界", () => {
  it("PR 构建 job 运行四镜像/SDK/原体积门禁，没有凭据或云写", () => {
    const body = job(images, "build-images");
    expect(body).toContain("server gateway");
    expect(body).toContain("mediatool weapp-uploader");
    expect(body).toContain("pnpm weapp:build");
    expect(body).toContain("pg_dump --version");
    expect(body).toContain("--check");
    expect(body).toContain("-m unittest -v test_adapter.py");
    expect(body.match(/org\.opencontainers\.image\.source=/g)).toHaveLength(2);
    expect(body.match(/org\.opencontainers\.image\.revision=/g)).toHaveLength(2);
    expect(body).toContain("${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}");
    expect(body).toContain("org.opencontainers.image.revision=${GITHUB_SHA}");
    expect(body).not.toMatch(/secrets\.|docker (push|login)|artifact\.put|orchestrate\.mjs/);
    expect(body).not.toContain("packages: write");
    expect(images).toContain("name: images-build-${{ github.sha }}");
  });

  it("发布只能在 main 的 push/manual 且明确启用，制品写另有配置；没有实际小程序上传", () => {
    const body = job(images, "publish-images");
    expect(body).toContain(
      "if: vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
    );
    expect(body).toContain("--password-stdin");
    expect(body).toContain("permissions:\n      contents: read\n      packages: write");
    expect(body).toContain(
      "REGISTRY_USER: ${{ vars.STG_REGISTRY == 'ghcr.io' && github.actor || secrets.STG_REGISTRY_USERNAME }}",
    );
    expect(body).toContain(
      "REGISTRY_PASSWORD: ${{ vars.STG_REGISTRY == 'ghcr.io' && secrets.GITHUB_TOKEN || secrets.STG_REGISTRY_PASSWORD }}",
    );
    expect(body).toContain("!/^wx[a-f0-9]{16}$/.test(process.env.WEAPP_APPID)");
    expect(body).toContain("s.appid!==process.env.WEAPP_APPID");
    expect(body).toContain("s.apiBaseUrl!==process.env.WEAPP_API_BASE_URL");
    expect(body.indexOf("s.source!==process.env.GITHUB_SHA")).toBeLessThan(
      body.indexOf("docker push"),
    );
    expect(body).not.toMatch(/--upload\b|\bweapp-upload\b/);
    expect(body).not.toMatch(/STG_COS_|artifact\.put|cos-tools|STG_ARTIFACT_UPLOAD_ENABLED/);
    expect(body).toContain("name: images-release-${{ github.sha }}");
    expect(body).toContain("if: always()");
    expect(body).toContain('docker logout "$REGISTRY"');
    expect(images).not.toContain("ghcr_only");
    const artifacts = job(images, "publish-artifacts");
    expect(artifacts).toContain(
      "if: vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && vars.STG_ARTIFACT_UPLOAD_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
    );
    expect(artifacts).toContain("needs: [build-images, publish-images]");
    expect(artifacts).toContain("name: images-build-${{ github.sha }}");
    expect(artifacts).toContain("name: images-release-${{ github.sha }}");
    expect(artifacts).toContain('test "$STG_ARTIFACT_UPLOAD_ENABLED" = true');
    expect(artifacts).toContain("LYX_COS_ARTIFACT_UPLOAD_ENABLED=true");
    expect(artifacts).toContain("validateRelease");
    expect(artifacts).toContain("v[k]!==s[k]");
    expect(artifacts.indexOf("s.source!==process.env.GITHUB_SHA")).toBeLessThan(
      artifacts.indexOf("artifact.put"),
    );
    expect(artifacts).toContain("python-version: 3.11.14");
    expect(artifacts).toContain("verify_lock.py");
    expect(artifacts.match(/--require-hashes --no-build-isolation/g)).toHaveLength(2);
    expect(artifacts).not.toMatch(/docker (push|login)|packages: write|orchestrate\.mjs/);
    expect(artifacts).not.toMatch(/--upload\b|\bweapp-upload\b/);
    expect(artifacts).toContain("if: always()");
  });

  it("PG/Redis 只手动且启用才转存多架构清单；不 pull/tag/push 单平台", () => {
    const body = job(images, "mirror-base");
    expect(body).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && inputs.mirror_base == true",
    );
    expect(body.match(/docker buildx imagetools create/g)).toHaveLength(2);
    expect(body).toContain("permissions:\n      contents: read\n      packages: write");
    expect(body).toContain(
      "REGISTRY_PASSWORD: ${{ vars.STG_REGISTRY == 'ghcr.io' && secrets.GITHUB_TOKEN || secrets.STG_REGISTRY_PASSWORD }}",
    );
    expect(body).toMatch(/postgres:17-trixie@sha256:[a-f0-9]{64}/);
    expect(body).toMatch(/redis:7\.4-alpine@sha256:[a-f0-9]{64}/);
    expect(body).not.toMatch(/docker (pull|tag|push) /);
  });

  it("MinIO 恢复仅手动与精确批准源码，固定摘要拉取验真后才登录推送", () => {
    const body = job(images, "mirror-minio");
    expect(body).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.mirror_minio == true",
    );
    expect(body).toContain("vars.MINIO_MIRROR_ENABLED == 'true'");
    expect(body).toContain("github.repository == 'sanqianyuejia/liyoxi-project'");
    expect(body).toContain("github.sha == vars.MINIO_MIRROR_APPROVED_SHA");
    expect(body).toContain("packages: write");
    expect(body).toContain(
      "sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2",
    );
    expect(body).toContain(
      "sha256:9966a92a734f9411e32f4f41d7d9d826fcdc0f68c4e20b70295bd4e7c11f8a2f",
    );
    expect(body).toContain('source="ghcr.linkos.org/ghcr.io/byfire-dev/minio@$digest"');
    expect(body).toContain('docker pull --platform "linux/$arch" "$source"');
    expect(body.indexOf("docker image inspect")).toBeLessThan(body.indexOf("docker login"));
    expect(body).toContain("for arch in amd64 arm64");
    expect(body).toContain('"$target-amd64" "$target-arm64"');
    expect(body).toContain('["linux/amd64", "linux/arm64"]');
    expect(body).toContain("if: always()");
    expect(body).not.toMatch(/docker run|STG_SSH|STG_COS|orchestrate|:latest/);
    expect(job(images, "build-images")).toContain(
      "if: github.event_name != 'workflow_dispatch' || inputs.mirror_minio != true",
    );
  });

  it("部署整个 job 默认关闭，同源 main 成功 push/runID/HEAD 绑定，先核摘要再编排", () => {
    const body = job(deploy, "deploy-stg");
    expect(body).toContain(
      "if: vars.STG_DEPLOY_ENABLED == 'true' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository",
    );
    expect(body).toContain("run-id: ${{ github.event.workflow_run.id }}");
    expect(body).toContain("repository: ${{ github.repository }}");
    expect(body).toContain("images-release-${{ github.event.workflow_run.head_sha }}");
    expect(body).toContain("v.source!==process.env.EXPECTED_SHA");
    expect(body.indexOf('channel("image-facts"')).toBeLessThan(
      body.indexOf("node infra/deploy/orchestrate.mjs"),
    );
    expect(body).toContain("mode:0o600");
    expect(body).toContain("if: always()");
    expect(deploy).toContain("cancel-in-progress: false");
    const upload =
      body.split("      - name: 成功部署后串行上传体验版\n")[1]?.split("      - name:")[0] ?? "";
    expect(body.match(/run: node infra\/deploy\/upload-release\.mjs/g)).toHaveLength(1);
    expect(body.indexOf("node infra/deploy/orchestrate.mjs")).toBeLessThan(
      body.indexOf("run: node infra/deploy/upload-release.mjs"),
    );
    expect(upload).toContain("if: success()");
    expect(upload).toContain("STG_WEAPP_UPLOAD_ENABLED: ${{ vars.STG_WEAPP_UPLOAD_ENABLED }}");
    expect(upload).toContain("EXPECTED_SHA: ${{ github.event.workflow_run.head_sha }}");
    expect(upload).not.toMatch(/continue-on-error|if: always\(\)|--upload\b|\bsecrets\./);
    expect(body).not.toMatch(/--upload\b|(?:ssh|channel\()[^\n]*weapp-upload/);
  });

  it.each(["--unknown", "--upload"])("真实 uploader 命令 %s 失败关闭且不回显账号输入", (arg) => {
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "infra/docker/weapp-uploader/upload.mjs"), arg],
      {
        env: { PATH: process.env.PATH },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).not.toMatch(/上传完成/);
    expect(result.stderr).toBe("小程序上传器：参数、SDK 或上传失败\n");
  });
});
