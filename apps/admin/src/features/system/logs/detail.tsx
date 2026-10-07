import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { DiffBlock } from "../../../components/DiffBlock";
import { categoryLabel, safeLink } from "./model";
import type { AccessSnapshot } from "../../../lib/permissions";
import type { AuditDetail } from "./api";
import { authLabel, displayFields, safeText, accessFieldLabel } from "./display";
function Fields({ value }: { value: Record<string, unknown> | null }) {
  const fields = displayFields(value);
  return fields.length ? (
    <dl className="lyx-audit-kv">
      {fields.map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <p>无变更</p>
  );
}
export function AuditDetailPanel({
  detail,
  access,
}: {
  detail: AuditDetail;
  access: AccessSnapshot | null;
}) {
  const link = safeLink(detail.link, access);
  const base = [
    ["操作人", `${safeText(detail.actor.name)}（${safeText(detail.actor.role)}）`],
    [
      "操作人类型",
      ({ staff: "员工", merchant: "商家", system: "系统" } as const)[detail.actor.actorType],
    ],
    ["操作人 ID", detail.actor.actorId ?? "—"],
    ["客户端", detail.actor.client ?? "系统任务"],
    [
      "对象",
      detail.target
        ? `${detail.target.type} · ${safeText(detail.target.label ?? detail.target.id ?? detail.target.key ?? "—")}`
        : "—",
    ],
    ["主体", detail.entityId ?? "—"],
    ["门店", detail.storeId ?? "—"],
    ["发生时间", appDateTimeFormat.dateTimeFull(new Date(detail.createdAt))],
    ["登录方式", authLabel(detail.authMethod)],
    ["来源 IP（已脱敏）", detail.ipMask ?? "—"],
    ["请求编号", safeText(detail.requestId ?? "—")],
    ["任务", safeText(detail.jobName ?? "—")],
    ["代操作主体", detail.onBehalfOfEntityId ?? "—"],
  ];
  return (
    <div className="lyx-audit-detail">
      <div className="lyx-audit-detail__number">{detail.logNo}</div>
      <span>{categoryLabel(detail.category)}</span>
      <h3>{safeText(detail.summary)}</h3>
      {detail.stream === "access" ? (
        <p className="lyx-audit-muted">访问留痕不包含被查看的值</p>
      ) : null}
      <dl className="lyx-audit-kv">
        {base.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>动作</h3>
      <p>{safeText(detail.action)}</p>
      {detail.stream === "access" && accessFieldLabel(detail.action) ? (
        <dl className="lyx-audit-kv">
          <div>
            <dt>访问字段</dt>
            <dd>{accessFieldLabel(detail.action)}</dd>
          </div>
        </dl>
      ) : null}
      {detail.reason ? (
        <>
          <h3>操作原因</h3>
          <p>{safeText(detail.reason.text ?? detail.reason.code)}</p>
        </>
      ) : null}
      {detail.meta ? (
        <>
          <h3>{detail.stream === "access" ? "访问用途与备注" : "键值"}</h3>
          <Fields value={detail.meta} />
        </>
      ) : null}
      {detail.before || detail.after ? (
        <>
          <h3>变更前后 · 已脱敏</h3>
          <div className="lyx-audit-diff">
            <DiffBlock
              ariaLabel="脱敏变更前后"
              before={<Fields value={detail.before} />}
              after={<Fields value={detail.after} />}
            />
          </div>
        </>
      ) : null}
      {detail.link ? (
        <p>
          {link ? (
            <a className="lyx-link" href={link.href}>
              {safeText(link.label)}
            </a>
          ) : (
            <span>{safeText(detail.link.label)}（暂不可跳转）</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
