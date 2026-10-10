import { DramaEpisodeUpdateBodySchema } from "@liyoxi/contract";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { useState } from "react";
import { FormField } from "../../../components/FormField";
import { SimplePager } from "../../../components/SimplePager";
import { DETAIL_QUERY } from "../../../lib/query";
import type { DramaApi, DramaDetail } from "./api";
import { ContentDialog } from "./form";
import { createContentIntent } from "./model";
import { MasterBatchDialog } from "./master-batch";
import { FileLinks } from "./media";

type Episode = Awaited<ReturnType<DramaApi["episodes"]>>["items"][number];
export function EpisodesPanel({
  api,
  drama,
  editable,
  mediaEditable,
  scope,
  refresh,
}: {
  api: DramaApi;
  drama: DramaDetail;
  editable: boolean;
  mediaEditable: boolean;
  scope: string;
  refresh(): void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<{ episode: Episode; version: number }>();
  const [batchDrama, setBatchDrama] = useState<DramaDetail>();
  const rows = useQuery({
    queryKey: ["drama", drama.dramaId, "episodes", scope, page, pageSize],
    queryFn: ({ signal }) => api.episodes(drama.dramaId, page, pageSize, signal),
    ...DETAIL_QUERY,
  });
  const ready = useQuery({
    queryKey: ["drama", drama.dramaId, "readiness", scope],
    queryFn: ({ signal }) => api.readiness(drama.dramaId, signal),
    ...DETAIL_QUERY,
  });
  const saved = () => {
    void rows.refetch();
    void ready.refetch();
    refresh();
  };
  return (
    <div>
      <div className="content-section-heading">
        <h2>原片与剧集</h2>
        {mediaEditable ? (
          <Button type="primary" onClick={() => setBatchDrama(drama)}>
            上传 / 替换原片
          </Button>
        ) : null}
      </div>
      <p>
        当前原片 {ready.data?.masters.withCurrentMaster ?? "—"} /{" "}
        {ready.data?.masters.totalEpisodes ?? "—"}{" "}
        集。只有服务器体检完成并提交批次后才成为当前原片。
      </p>
      {ready.isError ? (
        <Alert
          type="error"
          title={ready.error.message}
          action={<Button onClick={() => void ready.refetch()}>重试就绪检查</Button>}
        />
      ) : ready.data?.masters.missingEpisodeNos.length ? (
        <Alert
          type="warning"
          title={`缺少原片：第 ${ready.data.masters.missingEpisodeNos.join("、")} 集`}
        />
      ) : null}
      {rows.isPending ? (
        <p aria-busy="true">正在读取剧集…</p>
      ) : rows.isError ? (
        <Alert
          type="error"
          title={rows.error.message}
          action={<Button onClick={() => void rows.refetch()}>重试</Button>}
        />
      ) : (
        <>
          <div className="content-episodes">
            {rows.data.items.map((episode) => (
              <section className="content-episode" key={episode.dramaEpisodeId}>
                <div className="content-section-heading">
                  <h3>
                    第 {episode.episodeNo} 集 · {episode.title ?? "未填写标题"}
                  </h3>
                  {editable ? (
                    <Button onClick={() => setEditing({ episode, version: drama.lockVersion })}>
                      编辑标题
                    </Button>
                  ) : null}
                </div>
                <p>
                  {episode.masterState === "ready"
                    ? "已就绪"
                    : episode.masterState === "processing"
                      ? "处理中"
                      : episode.masterState === "missing"
                        ? "缺失"
                        : episode.masterState}{" "}
                  ·{" "}
                  {episode.durationMs == null
                    ? "时长待体检"
                    : `${(episode.durationMs / 1000).toFixed(1)} 秒`}
                </p>
                {episode.currentMaster ? (
                  <>
                    <p>
                      当前版本 {episode.currentMaster.revNo} ·{" "}
                      {episode.currentMaster.file.originalName ?? "原片"} ·{" "}
                      {episode.currentMaster.file.sizeBytes ?? "—"} 字节
                    </p>
                    <FileLinks api={api} files={[episode.currentMaster.file]} />
                  </>
                ) : null}
                {episode.openUploadBatchId ? (
                  <p>存在未结束批次，进入“上传 / 替换原片”恢复。</p>
                ) : null}
              </section>
            ))}
          </div>
          <SimplePager
            total={rows.data.total}
            page={rows.data.page}
            pageSize={rows.data.pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}
      {editing ? (
        <EpisodeDialog
          api={api}
          value={editing}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      ) : null}
      {batchDrama && ready.data ? (
        <MasterBatchDialog
          api={api}
          drama={batchDrama}
          openBatches={ready.data.openUploadBatches}
          onClose={() => setBatchDrama(undefined)}
          onRefresh={saved}
        />
      ) : null}
    </div>
  );
}
function EpisodeDialog({
  api,
  value,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  value: { episode: Episode; version: number };
  onClose(): void;
  onSaved(): void;
}) {
  const [title, setTitle] = useState(value.episode.title ?? "");
  const [intent] = useState(() => createContentIntent("episode-title"));
  return (
    <ContentDialog
      title={`编辑第 ${value.episode.episodeNo} 集标题`}
      intent={intent}
      onClose={onClose}
      submit={async () => {
        const body = DramaEpisodeUpdateBodySchema.parse({
          dramaLockVersion: value.version,
          title: title || null,
        });
        if (
          await intent.submit(body, (key, signal) =>
            api.episode(value.episode.dramaEpisodeId, body, key, signal),
          )
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <FormField label="剧集标题" value={title} maxLength={30}>
        {(field) => (
          <Input
            {...field}
            value={title}
            maxLength={30}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </FormField>
      <p>只更新标题；不会修改原片、集号或体检事实。</p>
    </ContentDialog>
  );
}
