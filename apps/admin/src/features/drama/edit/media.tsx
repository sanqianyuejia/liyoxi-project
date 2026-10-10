import { maxUploadBytes, UPLOAD_CATEGORIES } from "@liyoxi/shared/uploads";
import { Alert, Button } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadField } from "../../../components/UploadField";
import type { UploadFn, UploadRule } from "../../../lib/upload";
import { createProductionUpload } from "../../delivery/ticket-detail/upload";
import type { DramaApi, FileBody } from "./api";
import { contentError } from "./api";

type Category = Extract<FileBody["category"], "poster" | "trailer_src" | "drama_license_doc">;
/** 单个内容上传位沿用登记/直传/确认；原片只允许批次入口。 */
export function ContentUpload({
  api,
  category,
  onChange,
  disabled = false,
}: {
  api: DramaApi;
  category: Category;
  onChange(fileId: string | null): void;
  disabled?: boolean;
}) {
  const adapter = useRef<ReturnType<typeof createProductionUpload> | null>(null);
  const upload = useCallback<UploadFn>((file, options) => {
    if (!adapter.current) return Promise.reject(new DOMException("上传位已关闭", "AbortError"));
    return adapter.current.upload(file, options);
  }, []);
  const rule = useMemo<UploadRule>(() => {
    const extensions = UPLOAD_CATEGORIES[category].exts;
    return {
      accept: extensions.map((value) => `.${value}`),
      maxSizeMb:
        Number(
          maxUploadBytes(
            category,
            category === "trailer_src" ? "mp4" : category === "drama_license_doc" ? "pdf" : "jpg",
            "admin",
          ),
        ) /
        1024 /
        1024,
    };
  }, [category]);
  useEffect(() => {
    const current = createProductionUpload(api, { category });
    adapter.current = current;
    return () => {
      current.dispose();
      if (adapter.current === current) adapter.current = null;
    };
  }, [api, category]);
  return <UploadField rule={rule} upload={upload} disabled={disabled} onChange={onChange} />;
}
export function SourcePreview({
  api,
  fileId,
  label,
}: {
  api: DramaApi;
  fileId: string;
  label: string;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    api: DramaApi;
    fileId: string;
    revision: number;
    url?: string;
    error?: string;
  }>();
  const current =
    result?.api === api && result.fileId === fileId && result.revision === revision
      ? result
      : undefined;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const signed = await api.fileUrl(fileId, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ api, fileId, revision, url: signed.url });
        const wait = Date.parse(signed.expiresAt) - Date.now() - 30_000;
        if (wait > 0) timer = setTimeout(() => void refresh(), wait);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setResult({ api, fileId, revision, error: contentError(failure) });
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, fileId, revision]);
  return (
    <section className="content-source-preview">
      <h3>{label}</h3>
      <p>员工源文件核对；这里不代表转码成品或旧 current 预告片。</p>
      {current?.url ? (
        <video
          controls
          preload="metadata"
          src={current.url}
          onError={() => setResult({ ...current, error: "源文件播放失败，可重新获取签名后重试" })}
        />
      ) : null}
      {current?.error ? <Alert type="error" title={current.error} /> : null}
      <Button onClick={() => setRevision((v) => v + 1)}>刷新播放签名</Button>
    </section>
  );
}
export function FileLinks({
  api,
  files,
  remove,
}: {
  api: DramaApi;
  files: readonly { fileId: string; originalName?: string | null }[];
  remove?: (id: string) => void;
}) {
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => {
      controller.abort();
      if (active.current === controller) active.current = null;
    };
  }, []);
  async function open(id: string) {
    const controller = active.current;
    if (!controller) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const signed = await api.fileUrl(id, controller.signal);
      if (!controller.signal.aborted && tab) tab.location.href = signed.url;
      else tab?.close();
    } catch (failure) {
      tab?.close();
      if (!controller.signal.aborted) setError(contentError(failure));
    }
  }
  return (
    <>
      <ul className="content-files">
        {files.map((file) => (
          <li key={file.fileId}>
            <Button type="link" onClick={() => void open(file.fileId)}>
              {file.originalName ?? "查看已上传文件"}
            </Button>
            {remove ? (
              <Button type="link" danger onClick={() => remove(file.fileId)}>
                移除引用
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <Alert type="error" title={error} /> : null}
    </>
  );
}
