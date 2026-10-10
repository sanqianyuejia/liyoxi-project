import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Alert, Button, Input, Modal, Progress, Space, Table, type TableColumnsType } from "antd";
import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ConfirmAction } from "../../../components/ConfirmAction";
import { EmphasisBlock } from "../../../components/EmphasisBlock";
import { MasterDetailPage } from "../../../components/MasterDetailPage";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StateBlock";
import { Tabs } from "../../../components/Tabs";
import {
  AccessContext,
  canAction,
  hasModuleLevel,
  type AccessSnapshot,
} from "../../../lib/permissions";
import { LIST_QUERY } from "../../../lib/query";
import { createAgreementApi, type AgreementApi, type AgreementDetail, type Version } from "./api";
import { AgreementConsents } from "./consents";
import { AgreementEditor, HtmlPreview } from "./editor";
import {
  AGREEMENT_KEYS,
  agreementSearch,
  createAgreementWorkspace,
  failureText,
  phaseLabel,
} from "./model";
import "./agreements.css";

const route = getRouteApi("/ops/agreements");
const at = (value: string | null) =>
  value ? appDateTimeFormat.dateTime(new Date(value)) : "未设置";
export function agreementActor(access: AccessSnapshot | null) {
  return JSON.stringify([access?.staff.id, access?.moduleLevels.ops, access?.actions]);
}
export function AgreementsPage() {
  const access = useContext(AccessContext);
  return <AgreementContent key={agreementActor(access)} access={access} />;
}
function AgreementContent({ access }: { access: AccessSnapshot | null }) {
  const { services } = useRouteContext({ from: "__root__" });
  const navigate = route.useNavigate(),
    search = agreementSearch(route.useSearch());
  const api = useMemo(() => createAgreementApi(services), [services]);
  const workspace = useMemo(() => createAgreementWorkspace(api), [api]);
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const actor = agreementActor(access),
    selected = search.agreementKey,
    evidence = search.tab === "evidence";
  const [editing, setEditing] = useState<{ key: string; version?: Version }>(),
    [withdrawing, setWithdrawing] = useState<Version>();
  const [notice, setNotice] = useState<string>();
  const list = useQuery({
    queryKey: ["admin", "agreements", actor],
    queryFn: ({ signal }) => api.list(signal),
    ...LIST_QUERY,
  });
  useEffect(() => {
    void workspace.select(selected);
    return () => {
      void workspace.select(undefined);
    };
  }, [workspace, selected]);
  const agreements =
    list.data?.items.filter((item) => AGREEMENT_KEYS.some((key) => key === item.agreementKey)) ??
    [];
  const change = (value: Record<string, string>) => {
    void navigate({ search: agreementSearch(value) });
  };
  const select = (key?: string) => {
    setEditing(undefined);
    setWithdrawing(undefined);
    setNotice(undefined);
    change({ ...search, agreementKey: key ?? "" });
  };
  const refresh = () => {
    void list.refetch();
    void workspace.select(selected);
  };
  const editAllowed = hasModuleLevel(access, "ops", "e");
  const detail = state.detail?.agreementKey === selected ? state.detail : undefined;
  const openUrl = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };
  async function download(fileId: string) {
    try {
      const signed = await workspace.download(fileId);
      if (signed) openUrl(signed.url);
    } catch (error) {
      setNotice(failureText(error));
    }
  }
  return (
    <>
      <PageHeader
        title="协议管理"
        subtitle="六份正式协议 · 版本与公示状态以服务器事实为准"
        extra={<Button onClick={refresh}>刷新</Button>}
      />
      <Tabs
        label="协议管理内容"
        activeKey={evidence ? "evidence" : "versions"}
        items={[
          { key: "versions", label: "协议与版本" },
          { key: "evidence", label: "同意记录" },
        ]}
        onChange={(tab) => {
          setEditing(undefined);
          setWithdrawing(undefined);
          change({ ...search, tab: tab === "evidence" ? tab : "" });
        }}
      />
      {notice ? (
        <Alert type="info" title={notice} closable onClose={() => setNotice(undefined)} />
      ) : null}
      {evidence ? (
        <AgreementConsents
          key={JSON.stringify([actor, search])}
          api={api}
          actor={actor}
          search={search}
          agreements={agreements}
          onChange={change}
          openUrl={openUrl}
        />
      ) : (
        <MasterDetailPage
          label="协议清单与版本"
          selectedKey={selected}
          onSelect={select}
          detailTitle="协议详情"
          onRetry={() => void workspace.select(selected)}
          list={({ onSelect }) =>
            list.isPending ? (
              <div className="lyx-agreement-loading" aria-busy="true">
                协议加载中…
              </div>
            ) : list.isError ? (
              <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
            ) : agreements.length === 0 ? (
              <EmptyState title="暂无协议" description="请联系管理员核对正式协议初始化" />
            ) : (
              <div className="lyx-agreement-cards">
                {agreements.map((item) => (
                  <button
                    type="button"
                    key={item.agreementKey}
                    className="lyx-card lyx-agreement-card lyx-focusable"
                    aria-pressed={selected === item.agreementKey}
                    onClick={() => onSelect(item.agreementKey)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.signSceneLabel}</span>
                    <span>{item.audienceLabel}</span>
                    <small>
                      当前 {item.currentVersion?.versionLabel ?? "暂无生效版本"}
                      {item.pendingVersion ? ` · 待生效 ${item.pendingVersion.versionLabel}` : ""}
                    </small>
                  </button>
                ))}
              </div>
            )
          }
          detail={
            !selected
              ? undefined
              : state.loading
                ? { key: selected, status: "loading" }
                : state.error
                  ? { key: selected, status: "error", message: state.error }
                  : detail
                    ? {
                        key: selected,
                        status: "ready",
                        content: (
                          <AgreementDetailPanel
                            detail={detail}
                            api={api}
                            editAllowed={editAllowed}
                            busy={Boolean(state.busy)}
                            edit={(version) => setEditing({ key: detail.agreementKey, version })}
                            withdraw={setWithdrawing}
                            download={(fileId) => void download(fileId)}
                          />
                        ),
                      }
                    : { key: selected, status: "empty" }
          }
        />
      )}
      {editing && editing.key === selected && editAllowed ? (
        <AgreementEditor
          key={`${editing.key}:${editing.version?.agreementVersionId ?? "new"}`}
          services={services}
          api={api}
          workspace={workspace}
          agreementKey={editing.key}
          version={editing.version}
          canBumpMajor={canAction(access, "sys.super_admin")}
          canShortNotice={canAction(access, "agreement.short_notice")}
          onClose={() => setEditing(undefined)}
          onSaved={(warnings) => {
            refresh();
            if (warnings?.length) setNotice(warnings.join("；"));
          }}
        />
      ) : null}
      {withdrawing && withdrawing.agreementKey === selected && editAllowed ? (
        <WithdrawDialog
          api={api}
          version={withdrawing}
          onClose={() => setWithdrawing(undefined)}
          onDone={(draft) => {
            setWithdrawing(undefined);
            refresh();
            setNotice(
              draft
                ? "已撤回，并另建草稿；请在版本表中核对新草稿后编辑"
                : "已撤回；已有草稿保留，请刷新后选择实际草稿",
            );
          }}
        />
      ) : null}
    </>
  );
}
function AgreementDetailPanel({
  detail,
  editAllowed,
  busy,
  edit,
  withdraw,
  download,
}: {
  detail: AgreementDetail;
  api: AgreementApi;
  editAllowed: boolean;
  busy: boolean;
  edit: (version?: Version) => void;
  withdraw: (version: Version) => void;
  download: (fileId: string) => void;
}) {
  const current = detail.versions.find(
    (version) => version.agreementVersionId === detail.currentVersion?.agreementVersionId,
  );
  const draft = detail.versions.find(
    (version) => version.agreementVersionId === detail.draftVersion?.agreementVersionId,
  );
  const columns: TableColumnsType<Version> = [
    { title: "版本", key: "label", width: 80, render: (_v, row) => row.versionLabel },
    { title: "阶段", key: "phase", width: 95, render: (_v, row) => phaseLabel(row) },
    { title: "生效时间", key: "effectiveAt", render: (_v, row) => at(row.effectiveAt) },
    { title: "变更摘要", key: "summary", render: (_v, row) => row.summary ?? "—" },
    {
      title: "操作",
      key: "actions",
      width: 155,
      render: (_v, row) => (
        <Space wrap>
          {row.pdfFile ? (
            <Button type="link" onClick={() => download(row.pdfFile!.fileId)}>
              PDF
            </Button>
          ) : null}
          {editAllowed && row.actions.includes("edit") ? (
            <Button type="link" disabled={busy} onClick={() => edit(row)}>
              编辑
            </Button>
          ) : null}
          {editAllowed && row.actions.includes("schedule") ? (
            <Button type="link" disabled={busy} onClick={() => edit(row)}>
              安排
            </Button>
          ) : null}
          {editAllowed && row.actions.includes("withdraw") ? (
            <Button type="link" danger disabled={busy} onClick={() => withdraw(row)}>
              撤回
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];
  return (
    <div className="lyx-agreement-detail">
      <div className="lyx-agreement-title">
        <div>
          <h2>{detail.name}</h2>
          <p>
            {detail.signSceneLabel} · {detail.audienceLabel}
          </p>
        </div>
        <Space>
          {current?.pdfFile ? (
            <Button onClick={() => download(current.pdfFile!.fileId)}>下载当前PDF</Button>
          ) : null}
          {editAllowed ? (
            <Button
              type="primary"
              disabled={busy || Boolean(detail.draftVersion && !draft?.actions.includes("edit"))}
              onClick={() => edit(draft)}
            >
              {draft ? "编辑草稿" : "新建草稿"}
            </Button>
          ) : null}
        </Space>
      </div>
      {!editAllowed ? <Alert type="info" title="当前为只读权限，可查看协议与脱敏签署证据" /> : null}
      {detail.pendingVersion ? (
        <Alert
          type="info"
          title={`待生效 ${detail.pendingVersion.versionLabel}`}
          description={`生效时间：${at(detail.pendingVersion.effectiveAt)}；阶段与可用动作由服务器决定。`}
        />
      ) : null}
      {detail.reconsentProgress ? (
        <EmphasisBlock title={`${detail.reconsentProgress.versionLabel} 重新同意进度`}>
          <span>
            {detail.reconsentProgress.consentedCount} / {detail.reconsentProgress.expectedCount}
          </span>
          <Progress percent={detail.reconsentProgress.ratioBp / 100} />
        </EmphasisBlock>
      ) : null}
      <section>
        <h3>当前生效正文 {detail.currentVersion?.versionLabel ?? ""}</h3>
        <HtmlPreview html={detail.currentContentHtml} />
      </section>
      {draft ? (
        <section>
          <h3>草稿 {draft.versionLabel}</h3>
          <p>
            {draft.summary ?? "尚未填写变更摘要"} · 法务审核：
            {draft.isLegalApproved ? "已记录" : "未完成"}
          </p>
          <HtmlPreview html={detail.draftContentHtml} title="草稿正文预览" />
        </section>
      ) : null}
      <section aria-label="版本历史">
        <h3>版本历史</h3>
        <Table<Version>
          size="small"
          rowKey="agreementVersionId"
          columns={columns}
          dataSource={detail.versions}
          pagination={false}
          scroll={{ x: 660 }}
          locale={{ emptyText: "暂无版本" }}
        />
      </section>
    </div>
  );
}
function WithdrawDialog({
  api,
  version,
  onClose,
  onDone,
}: {
  api: AgreementApi;
  version: Version;
  onClose: () => void;
  onDone: (draft: Version | null) => void;
}) {
  const [reason, setReason] = useState(""),
    [confirming, setConfirming] = useState(false);
  return confirming ? (
    <ConfirmAction
      open
      action="agreement-withdraw"
      spec={{
        title: "撤回待生效协议",
        echo: [
          { label: "版本", value: version.versionLabel },
          { label: "生效时间", value: at(version.effectiveAt) },
          { label: "撤回原因", value: reason || "未填写" },
        ],
        description: "服务器重新核对撤回资格；另建草稿或保留已有草稿，以实际返回为准。",
        checkLabel: "我已核对版本与撤回影响",
        danger: true,
      }}
      onCancel={() => setConfirming(false)}
      onConfirm={async ({ idempotencyKey }) => {
        try {
          const result = await api.withdraw(
            version.agreementVersionId,
            reason.trim() ? { reason: reason.trim() } : {},
            idempotencyKey,
          );
          onDone(result.newDraft);
          return { outcome: "done" };
        } catch (error) {
          return { outcome: "failed", message: failureText(error) };
        }
      }}
      onDone={onClose}
    />
  ) : (
    <Modal
      open
      title={`撤回 ${version.versionLabel}`}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button danger onClick={() => setConfirming(true)}>
            继续核对
          </Button>
        </Space>
      }
    >
      <label htmlFor="agreement-withdraw-reason">原因（选填，最多100字）</label>
      <Input.TextArea
        id="agreement-withdraw-reason"
        value={reason}
        maxLength={100}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
