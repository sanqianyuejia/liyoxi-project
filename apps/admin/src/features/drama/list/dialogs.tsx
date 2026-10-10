import { Alert, Checkbox, Input, Select } from "antd";
import { useEffect, useState } from "react";
import { FormField } from "../../../components/FormField";
import { ContentDialog } from "../edit/form";
import { createContentIntent, statusLabel } from "../edit/model";
import { contentError } from "../edit/api";
import type { DramaListApi } from "./api";

export function NewDramaDialog({
  api,
  onClose,
  onCreated,
}: {
  api: DramaListApi;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [intent] = useState(() => createContentIntent("drama-create"));
  return (
    <ContentDialog
      title="新建短剧"
      intent={intent}
      onClose={onClose}
      disabled={!title.trim()}
      submitText="创建草稿"
      submit={async () => {
        const result = await intent.submit({ title }, (key, signal) =>
          api.create(title.trim(), key, signal),
        );
        if (result) onCreated(result.dramaId);
      }}
    >
      <FormField label="剧名" value={title} maxLength={20}>
        {(props) => (
          <Input
            {...props}
            value={title}
            maxLength={20}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </FormField>
      <p>创建后进入编辑页补充资料；上架仍须通过服务端校验。</p>
    </ContentDialog>
  );
}
export function ListingDialog({
  api,
  id,
  action,
  onClose,
  onSaved,
}: {
  api: DramaListApi;
  id: string;
  action: "shelve" | "delist";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [intent] = useState(() => createContentIntent(`drama-${action}`));
  const [facts, setFacts] = useState<{
    drama: Awaited<ReturnType<DramaListApi["detail"]>>;
    checks: Awaited<ReturnType<DramaListApi["checks"]>>;
    readiness: Awaited<ReturnType<DramaListApi["readiness"]>>;
  }>();
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [reasonCode, setReason] = useState<
    "ops_strategy" | "rights_issue" | "content_revision" | "other"
  >("ops_strategy");
  const [note, setNote] = useState("");
  useEffect(() => {
    const signal = intent.signal;
    void Promise.all([api.detail(id, signal), api.checks(id, signal), api.readiness(id, signal)])
      .then(([drama, checks, readiness]) => {
        if (!signal.aborted) setFacts({ drama, checks, readiness });
      })
      .catch((failure: unknown) => {
        if (!signal.aborted) setError(contentError(failure));
      });
  }, [api, id, intent]);
  const allowed =
    facts?.drama.actions.includes(action) && (action !== "shelve" || facts.checks.isShelvable);
  return (
    <ContentDialog
      title={action === "shelve" ? "核对并上架" : "下架短剧"}
      intent={intent}
      onClose={onClose}
      submitText={action === "shelve" ? "确认上架" : "确认下架"}
      disabled={!checked || !allowed || !!error}
      submit={async () => {
        const result = await intent.submit({ id, action, reasonCode, note }, (key, signal) =>
          action === "shelve"
            ? api.shelve(id, key, signal)
            : api.delist(id, { reasonCode, note: note.trim() || null }, key, signal),
        );
        if (result) {
          onSaved();
          onClose();
        }
      }}
    >
      {error ? (
        <Alert type="error" title={error} />
      ) : !facts ? (
        <p aria-busy="true">正在读取最新上架资料…</p>
      ) : (
        <>
          <p>
            <strong>{facts.drama.title}</strong> · {statusLabel(facts.drama.status)}
          </p>
          {action === "shelve" ? (
            <>
              <ul className="content-checks">
                {facts.checks.items.map((item) => (
                  <li key={item.code} data-ok={item.isOk}>
                    <strong>
                      {item.code} {item.label}
                    </strong>
                    <span>
                      {item.isOk ? "通过" : item.severity === "block" ? "阻断" : "提示"} ·{" "}
                      {item.note}
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                原片缺集：{facts.readiness.masters.missingEpisodeNos.join("、") || "无"}；在途批次{" "}
                {facts.readiness.openUploadBatches.length} 个。求值：{facts.checks.evaluatedAt}
              </p>
            </>
          ) : (
            <>
              <FormField label="下架原因">
                {(props) => (
                  <Select
                    {...props}
                    value={reasonCode}
                    onChange={setReason}
                    options={[
                      { value: "ops_strategy", label: "运营策略" },
                      { value: "rights_issue", label: "版权问题" },
                      { value: "content_revision", label: "内容修订" },
                      { value: "other", label: "其他" },
                    ]}
                  />
                )}
              </FormField>
              <FormField label="说明" value={note} maxLength={200}>
                {(props) => (
                  <Input.TextArea
                    {...props}
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </FormField>
            </>
          )}
          {!allowed ? (
            <Alert type="warning" title="当前状态或权限不允许此操作，请关闭后重新核对。" />
          ) : null}
          <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
            我已核对当前资料及操作影响
          </Checkbox>
        </>
      )}
    </ContentDialog>
  );
}
