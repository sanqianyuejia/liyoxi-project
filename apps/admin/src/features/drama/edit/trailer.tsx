import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { useEffect, useState } from "react";
import { FormField } from "../../../components/FormField";
import { DETAIL_QUERY } from "../../../lib/query";
import { Can } from "../../../lib/permissions";
import type { DramaApi, DramaDetail } from "./api";
import { contentError } from "./api";
import { ContentDialog } from "./form";
import { createContentIntent } from "./model";
import { ContentUpload, SourcePreview } from "./media";
export function TrailerPanel({
  api,
  drama,
  editable,
  scope,
  refresh,
}: {
  api: DramaApi;
  drama: DramaDetail;
  editable: boolean;
  scope: string;
  refresh(): void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const trailer = drama.trailer;
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [intent] = useState(() => createContentIntent("trailer-retry"));
  useEffect(() => {
    intent.activate();
    return () => intent.close();
  }, [intent]);
  const jobs = useQuery({
    queryKey: ["drama", drama.dramaId, "trailer-jobs", trailer?.targetPlayableId, scope],
    queryFn: ({ signal }) => api.trailerJobs(trailer!.targetPlayableId, signal),
    enabled: !!trailer && trailer.state === "failed",
    ...DETAIL_QUERY,
  });
  async function retry(id: string) {
    if (retrying) return;
    setRetrying(true);
    setError(undefined);
    try {
      if (await intent.submit({ id }, (key, signal) => api.retryJob(id, key, signal))) {
        await jobs.refetch();
        refresh();
      }
    } catch (failure) {
      if (!intent.signal.aborted) setError(contentError(failure));
    } finally {
      if (!intent.signal.aborted) setRetrying(false);
    }
  }
  return (
    <section>
      <div className="content-section-heading">
        <h3>预告片</h3>
        {editable ? (
          <Button onClick={() => setOpen(true)}>{trailer ? "替换目标预告片" : "上传预告片"}</Button>
        ) : null}
      </div>
      {trailer ? (
        <>
          <p>
            目标状态：
            {trailer.state === "ready"
              ? "就绪"
              : trailer.state === "processing"
                ? "处理中"
                : trailer.state === "failed"
                  ? "失败"
                  : trailer.state}{" "}
            · {trailer.sourceFile.originalName ?? "源文件"}
          </p>
          {trailer.currentPlayableId && trailer.currentPlayableId !== trailer.targetPlayableId ? (
            <Alert
              type="info"
              title="旧 current 仍在使用；新目标未就绪前不会替换。下方仅可预览新目标源文件。"
            />
          ) : null}
          {trailer.error ? <Alert type="error" title={trailer.error} /> : null}
          <Button onClick={() => setPreview((value) => !value)}>
            {preview ? "收起" : "预览目标源文件"}
          </Button>
          {preview ? (
            <SourcePreview
              key={trailer.sourceFile.fileId}
              api={api}
              fileId={trailer.sourceFile.fileId}
              label="目标预告片源文件预览"
            />
          ) : null}
          {trailer.state === "failed" ? (
            <Can module="drama" need="e" action="sys.media.retry">
              {jobs.data?.items
                .filter((job) => job.actions.includes("retry"))
                .map((job) => (
                  <Button
                    key={job.mediaJobId}
                    loading={retrying}
                    onClick={() => void retry(job.mediaJobId)}
                  >
                    重试该目标转换任务
                  </Button>
                ))}
            </Can>
          ) : null}
          {jobs.isError ? (
            <Alert
              type="error"
              title={jobs.error.message}
              action={<Button onClick={() => void jobs.refetch()}>重新读取失败任务</Button>}
            />
          ) : null}
        </>
      ) : (
        <p>尚未设置预告片。</p>
      )}
      {error ? <Alert type="error" title={error} /> : null}
      {open ? (
        <TrailerDialog
          api={api}
          onClose={() => setOpen(false)}
          onSaved={refresh}
          dramaId={drama.dramaId}
        />
      ) : null}
    </section>
  );
}
function TrailerDialog({
  api,
  dramaId,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  dramaId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const [fileId, setFileId] = useState<string | null>(null);
  const [intent] = useState(() => createContentIntent("trailer-target"));
  return (
    <ContentDialog
      title="上传目标预告片"
      intent={intent}
      submitText="设置并转换"
      onClose={onClose}
      disabled={!fileId}
      submit={async () => {
        if (
          fileId &&
          (await intent.submit({ sourceFileId: fileId }, (key, signal) =>
            api.trailer(dramaId, fileId, key, signal),
          ))
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <FormField label="预告片源文件">
        {() => <ContentUpload api={api} category="trailer_src" onChange={setFileId} />}
      </FormField>
      <p>
        MP4 / MOV；时长不得超过180秒，按服务器真实体检和转换状态判断可用性。新目标转换失败可重试，旧
        current 不被提前替换。
      </p>
    </ContentDialog>
  );
}
