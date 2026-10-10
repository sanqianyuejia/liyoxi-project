import { useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { Alert, Button, Input, Modal } from "antd";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { SiteConfigView } from "@liyoxi/contract";
import { ConfigPage } from "../../../components/ConfigPage";
import { FormField } from "../../../components/FormField";
import { SimplePager } from "../../../components/SimplePager";
import { EmptyState, ErrorState } from "../../../components/StateBlock";
import { useModuleLevel } from "../../../lib/permissions";
import { siteError, type ConfigKey, type SiteApi } from "./api";
import { createSiteModel, type SiteContent } from "./model";
import "./site.css";

export function SiteErrors({ errors }: { errors: Record<string, string> }) {
  return Object.keys(errors).length ? (
    <ul className="lyx-site-errors" role="alert">
      {Object.entries(errors).map(([path, message]) => (
        <li key={path}>
          <button
            type="button"
            className="lyx-link lyx-link--danger"
            onClick={(event) => {
              const key = path.replace(/^content\./, "");
              const fields = [
                ...(
                  event.currentTarget.closest("form,fieldset") ?? document
                ).querySelectorAll<HTMLElement>("[data-site-path]"),
              ];
              const target =
                fields.find((element) => element.dataset.sitePath === key) ??
                fields.find((element) => key.startsWith(`${element.dataset.sitePath}.`));
              target?.scrollIntoView({ block: "center", behavior: "smooth" });
              (target?.matches("input,button,textarea")
                ? target
                : target?.querySelector<HTMLElement>("input,button,textarea")
              )?.focus();
            }}
          >
            <strong>{path || "配置"}</strong>：{message}
          </button>
        </li>
      ))}
    </ul>
  ) : null;
}
export function errorAt(errors: Record<string, string>, path: string) {
  return Object.entries(errors).find(
    ([key]) =>
      key.replace(/^content\./, "") === path ||
      key.replace(/^content\./, "").startsWith(`${path}.`),
  )?.[1];
}
function LeaveGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  return (
    <Modal
      open={blocker.status === "blocked"}
      title="离开未保存的配置？"
      footer={null}
      onCancel={() => blocker.reset?.()}
    >
      <p>本页更改尚未保存为草稿。</p>
      <div className="lyx-confirm__footer">
        <Button size="large" onClick={() => blocker.reset?.()}>
          继续编辑
        </Button>
        <Button size="large" danger onClick={() => blocker.proceed?.()}>
          放弃更改并离开
        </Button>
      </div>
    </Modal>
  );
}
export function SiteConfigEditor({
  api,
  kind,
  label,
  historyPage,
  onHistoryPage,
  children,
  aside,
}: {
  api: SiteApi;
  kind: ConfigKey;
  label: string;
  historyPage: number;
  onHistoryPage(page: number): void;
  children(
    content: SiteContent,
    change: (content: SiteContent) => void,
    view: SiteConfigView,
    errors: Record<string, string>,
  ): ReactNode;
  aside?(content: SiteContent, view: SiteConfigView): ReactNode;
}) {
  const canEdit = useModuleLevel("ops") === "e";
  const model = useMemo(() => createSiteModel(api, kind), [api, kind]);
  const attachedModel = useRef<ReturnType<typeof createSiteModel> | undefined>(undefined);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [historyOpen, setHistoryOpen] = useState(false),
    [reloadOpen, setReloadOpen] = useState(false);
  const history = useQuery({
    queryKey: ["ops", kind, "history", historyPage],
    enabled: historyOpen,
    queryFn: ({ signal }) => api.revisions(kind, historyPage, signal),
    staleTime: 0,
  });
  useEffect(() => {
    attachedModel.current = model;
    model.resume();
    void model.load();
    return () => {
      if (attachedModel.current === model) attachedModel.current = undefined;
      model.suspend();
      // StrictMode 的同步 cleanup/setup 保留同一意图；真正离开时先暂停，再销毁请求。
      queueMicrotask(() => {
        if (attachedModel.current !== model) model.dispose();
      });
    };
  }, [model]);
  if (!state.view || !state.content)
    return state.pending ? (
      <section className="lyx-card lyx-site-section" aria-busy="true">
        正在读取{label}…
      </section>
    ) : (
      <ErrorState message={state.message} onRetry={() => void model.load()} />
    );
  const view = state.view;
  return (
    <>
      <LeaveGuard dirty={state.dirty} />
      <section className="lyx-site-section-heading">
        <div>
          <h2>{label}</h2>
          <p>
            当前发布版本 {view.published.revNo} · {view.published.publishedBy?.name ?? "系统"} ·{" "}
            {view.published.publishedAt}
          </p>
          {view.draft ? (
            <p>
              草稿版本锁 {view.draft.lockVersion} · 基于版本 {view.draft.baseRevNo ?? "未指定"}
            </p>
          ) : null}
        </div>
        <div className="lyx-site-actions">
          <Button onClick={() => setHistoryOpen(true)}>版本记录</Button>
          <Button
            disabled={state.pending}
            onClick={() => (state.dirty ? setReloadOpen(true) : void model.load())}
          >
            重新读取
          </Button>
          {canEdit ? (
            <Button
              disabled={state.pending || state.conflict}
              onClick={() => void model.submit(false)}
            >
              保存草稿
            </Button>
          ) : null}
          {canEdit && state.saved ? (
            <Button
              disabled={state.pending || state.conflict}
              onClick={() => void model.retryPublish()}
            >
              仅发布已存草稿
            </Button>
          ) : null}
        </div>
      </section>
      <ConfigPage
        label={label}
        readOnly={!canEdit}
        pending={state.pending}
        canSubmit={!state.conflict}
        submitLabel="保存并发布"
        error={state.message}
        onSubmit={() => model.submit(true)}
        aside={aside?.(state.content, view)}
      >
        {state.conflict ? (
          <Alert
            type="warning"
            title="版本冲突，编辑内容已保留"
            description="当前快照不能再次提交。请保留所需内容，重新读取并核对当前版本后再编辑。"
          />
        ) : null}
        {children(state.content, canEdit ? model.edit : () => {}, view, state.errors)}
        <FormField label="版本说明（选填）" error={state.errors.note}>
          {(props) => (
            <Input
              {...props}
              data-site-path="note"
              value={state.note}
              maxLength={100}
              onChange={(event) => model.note(event.target.value)}
            />
          )}
        </FormField>
        <SiteErrors errors={state.errors} />
        {view.refs.invalidRefs.length ? (
          <Alert
            type="error"
            title="存在失效引用"
            description={
              <ul>
                {view.refs.invalidRefs.map((ref, index) => (
                  <li key={`${ref.path}:${index}`}>
                    {ref.path} · {ref.code} · {ref.reason}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        {view.refs.affectedBanners.length ? (
          <Alert
            type="warning"
            title="关联 Banner 提示"
            description={`以下 Banner 引用了分类，请核对跳转：${view.refs.affectedBanners.map((row) => `${row.title}（${row.categoryKey}）`).join("、")}。此提示不阻止发布。`}
          />
        ) : null}
      </ConfigPage>
      <Modal
        open={reloadOpen}
        title="重新读取当前配置？"
        footer={null}
        onCancel={() => setReloadOpen(false)}
      >
        <p>重新读取会替换本页编辑内容，请先保留需要合并的更改。</p>
        <div className="lyx-confirm__footer">
          <Button size="large" onClick={() => setReloadOpen(false)}>
            继续编辑
          </Button>
          <Button
            size="large"
            danger
            onClick={() => {
              setReloadOpen(false);
              void model.load();
            }}
          >
            重新读取
          </Button>
        </div>
      </Modal>
      <Modal
        open={historyOpen}
        title={`${label}版本记录`}
        width={760}
        footer={null}
        onCancel={() => setHistoryOpen(false)}
      >
        <p className="lyx-confirm__desc">复制历史内容到编辑区后，保存草稿并发布为新版本。</p>
        {history.isError ? (
          <ErrorState message={siteError(history.error)} onRetry={() => void history.refetch()} />
        ) : history.isPending ? (
          <p aria-busy="true">正在读取版本…</p>
        ) : history.data.items.length ? (
          <>
            <div className="lyx-site-table-scroll">
              <table className="lyx-table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>发布时间 / 发布人</th>
                    <th>说明</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((revision) => (
                    <tr key={revision.siteConfigRevisionId}>
                      <td>
                        {revision.revNo} · {revision.status === "published" ? "当前发布" : "已归档"}
                      </td>
                      <td>
                        {revision.publishedAt}
                        <br />
                        {revision.publishedBy?.name ?? "系统"}
                      </td>
                      <td>{revision.note ?? "—"}</td>
                      <td>
                        {canEdit ? (
                          <Button
                            size="small"
                            disabled={state.pending}
                            onClick={() => {
                              model.restore(revision.content, revision.revNo);
                              setHistoryOpen(false);
                            }}
                          >
                            复制到编辑区
                          </Button>
                        ) : (
                          "只读"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SimplePager
              total={history.data.total}
              page={historyPage}
              pageSize={20}
              onPageChange={onHistoryPage}
              onPageSizeChange={() => {}}
            />
          </>
        ) : (
          <EmptyState title="暂无发布记录" />
        )}
        <div className="lyx-confirm__footer">
          <Button size="large" onClick={() => setHistoryOpen(false)}>
            关闭
          </Button>
        </div>
      </Modal>
    </>
  );
}
