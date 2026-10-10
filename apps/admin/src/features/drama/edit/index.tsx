import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Alert, Button, Input } from "antd";
import { useContext, useMemo, useState } from "react";
import { DetailPage } from "../../../components/DetailPage";
import { FormField } from "../../../components/FormField";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import { StatusTag } from "../../../components/StatusTag";
import { AccessContext, canAction, hasModuleLevel } from "../../../lib/permissions";
import { DETAIL_QUERY, DICT_QUERY } from "../../../lib/query";
import { writeTableSearch } from "../../../lib/table-search";
import { createDramaApi, contentError, type DramaApi, type DramaDetail } from "./api";
import { BasicDialog, CastDialog, CommercialDialog } from "./basic";
import { CopyrightDialog } from "./copyright";
import { ContentDialog } from "./form";
import { FileLinks } from "./media";
import {
  contentScope,
  createContentIntent,
  editSearch,
  EDIT_TABS,
  pointsText,
  statusLabel,
  PLACEMENT_LABELS,
  type EditTab,
} from "./model";
import { EpisodesPanel } from "./episodes";
import { PermitsPanel } from "./permits";
import { TrailerPanel } from "./trailer";
import { ListingDialog } from "../list/dialogs";
import { createDramaListApi } from "../list/api";
import { dramaSearch } from "../list/model";
import "../list/drama-list.css";
import "./edit.css";

const route = getRouteApi("/dramas/$id");
const labels: Record<EditTab, string> = {
  basic: "基础信息",
  license: "许可信息",
  copyright: "版权信息",
  commercial: "商务信息",
  episodes: "原片 / 剧集",
};
export function DramaEditPage() {
  const { id } = route.useParams();
  return <DramaEditWorkspace key={`${id}:${contentScope(useContext(AccessContext))}`} id={id} />;
}
function DramaEditWorkspace({ id }: { id: string }) {
  const { services } = useRouteContext({ from: "__root__" });
  const access = useContext(AccessContext);
  const scope = contentScope(access);
  const api = useMemo(() => createDramaApi(services), [services]);
  const listApi = useMemo(() => createDramaListApi(services), [services]);
  const navigate = route.useNavigate();
  const search = editSearch(route.useSearch());
  const query = useQuery({
    queryKey: ["drama", id, scope],
    queryFn: ({ signal }) => api.get(id, signal),
    ...DETAIL_QUERY,
    refetchInterval: (state) =>
      state.state.data?.trailer?.state === "processing" ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const dict = useQuery({
    queryKey: ["drama", "edit-dict", scope],
    queryFn: ({ signal }) => api.dict("genre,selling_tag,industry", signal),
    ...DICT_QUERY,
  });
  const [form, setForm] = useState<{
    kind: "basic" | "cast" | "commercial" | "copyright" | "revision" | "recheck";
    snapshot: DramaDetail;
  }>();
  const [listing, setListing] = useState<"shelve" | "delist">();
  const drama = query.data;
  const refresh = () => {
    void query.refetch();
  };
  const editable = hasModuleLevel(access, "drama", "e") && !!drama?.editability.canEditContent;
  const mediaEditable = hasModuleLevel(access, "drama", "e") && !!drama?.editability.canManageMedia;
  const tab = (value: EditTab) => void navigate({ search: { ...search, tab: value } });
  const start = (kind: NonNullable<typeof form>["kind"]) => {
    if (drama) setForm({ kind, snapshot: drama });
  };
  const close = () => setForm(undefined);
  return (
    <div className="content-edit">
      <Button
        type="link"
        onClick={() =>
          void navigate({
            to: "/dramas",
            search: writeTableSearch(
              dramaSearch(Object.fromEntries(new URLSearchParams(search.returnTo.split("?")[1]))),
            ),
          })
        }
      >
        返回短剧列表
      </Button>
      <DetailPage
        title={drama?.title ?? "短剧详情"}
        subtitle={drama ? `最近更新 ${drama.updatedAt} · 版本 ${drama.lockVersion}` : undefined}
        tags={
          drama ? (
            <>
              <StatusTag tone={drama.status === "listed" ? "success" : "neutral"}>
                {statusLabel(drama.status)}
              </StatusTag>
              {drama.archivedAt ? <StatusTag tone="neutral">已归档</StatusTag> : null}
              {drama.isPermitRecheckRequired ? (
                <StatusTag tone="warning">许可待重新核验</StatusTag>
              ) : null}
            </>
          ) : null
        }
        actions={
          drama ? (
            <>
              <Button onClick={refresh}>刷新详情</Button>
              {drama.actions.includes("shelve") && canAction(access, "drama.shelf") ? (
                <Button type="primary" onClick={() => setListing("shelve")}>
                  上架
                </Button>
              ) : null}
              {drama.actions.includes("delist") && canAction(access, "drama.shelf") ? (
                <Button danger onClick={() => setListing("delist")}>
                  下架
                </Button>
              ) : null}
            </>
          ) : null
        }
        state={
          query.isPending
            ? { status: "loading" }
            : query.isError
              ? { status: "error", message: contentError(query.error) }
              : { status: "ready" }
        }
        onRetry={refresh}
        activeTab={search.tab}
        onTabChange={(value) => {
          const next = EDIT_TABS.find((v) => v === value);
          if (next) tab(next);
        }}
        tabs={EDIT_TABS.map((key) => ({
          key,
          label: labels[key],
          content: !drama ? null : key === "basic" ? (
            <>
              <div className="content-section-heading">
                <h2>基础信息</h2>
                {editable ? <Button onClick={() => start("basic")}>编辑基础信息</Button> : null}
              </div>
              {drama.posterUrl ? (
                <img
                  className="content-poster"
                  alt={`${drama.title}封面`}
                  src={drama.posterUrl.url}
                />
              ) : null}
              <div className="content-form-grid">
                <ReadOnlyValue
                  label="总集数 / 参考时长"
                  value={`${drama.totalEpisodes ?? "未填写"} 集 / ${drama.episodeDurationSec ?? "—"} 秒`}
                />
                <ReadOnlyValue
                  label="类别 / 原片制作方式"
                  value={`${drama.dramaClass ?? "未填写"} / ${drama.isAiGenerated ? "AI制作" : "非AI制作"}`}
                />
                <ReadOnlyValue
                  label="题材"
                  value={drama.genres.map((v) => v.name).join(" / ") || "—"}
                />
                <ReadOnlyValue
                  label="卖点标签"
                  value={drama.sellingTags.map((v) => v.name).join(" / ") || "—"}
                />
                <ReadOnlyValue label="出品方" value={drama.producerName ?? "—"} />
                <ReadOnlyValue label="主演" value={drama.castNames ?? "—"} />
              </div>
              <ReadOnlyValue label="简介" value={drama.synopsis ?? "—"} />
              <div className="content-section-heading">
                <h3>角色简介</h3>
                {editable ? <Button onClick={() => start("cast")}>编辑角色简介</Button> : null}
              </div>
              {drama.roles.map((role, i) => (
                <ReadOnlyValue
                  key={i}
                  label={`${role.name} · ${role.actor ?? "演员未填写"}`}
                  value={role.desc}
                />
              ))}
              <TrailerPanel
                api={api}
                drama={drama}
                editable={mediaEditable}
                scope={scope}
                refresh={refresh}
              />
            </>
          ) : key === "license" ? (
            <>
              <PermitsPanel
                api={api}
                drama={drama}
                editable={editable}
                scope={scope}
                refresh={refresh}
              />
              {drama.actions.includes("confirm-permit-recheck") && editable ? (
                <Button type="primary" onClick={() => start("recheck")}>
                  确认许可重新核验
                </Button>
              ) : null}
            </>
          ) : key === "copyright" ? (
            <>
              <div className="content-section-heading">
                <h2>版权信息</h2>
                {hasModuleLevel(access, "drama", "e") && drama.copyright.editMode === "direct" ? (
                  <Button onClick={() => start("copyright")}>编辑版权信息</Button>
                ) : drama.copyright.editMode === "revision" &&
                  canAction(access, "drama.copyright.revise") ? (
                  <Button onClick={() => start("revision")}>提交版权变更</Button>
                ) : null}
              </div>
              <ReadOnlyValue
                label="编辑方式"
                value={drama.copyright.editMode}
                reason={
                  drama.copyright.editMode === "locked"
                    ? "版权已锁定，只读核对"
                    : "版权版本独立于基础资料版本"
                }
              />
              <div className="content-form-grid">
                <ReadOnlyValue
                  label="来源 / 地域"
                  value={`${drama.copyright.source ?? "—"} / ${drama.copyright.territory ?? "—"}`}
                />
                <ReadOnlyValue label="平台" value={drama.copyright.platforms.join(" / ") || "—"} />
                <ReadOnlyValue
                  label="授权起止日"
                  value={`${drama.copyright.licenseStartDate ?? "—"} 至 ${drama.copyright.licenseEndDate ?? "—"}`}
                />
                <ReadOnlyValue label="停订日期" value={drama.copyright.stopOrderDate ?? "—"} />
              </div>
              <p>
                网络传播 {drama.copyright.hasNetworkRight ? "有" : "无"} · 转授权{" "}
                {drama.copyright.canSublicense ? "允许" : "不允许"} · 剪辑嵌入{" "}
                {drama.copyright.canEditEmbed ? "允许" : "不允许"} · 改编{" "}
                {drama.copyright.canAdapt ? "允许" : "不允许"}
              </p>
              <FileLinks api={api} files={drama.copyright.proofFiles} />
              <p>
                当前版权修订 {drama.copyright.currentRevisionId ?? "尚未形成修订"}
                ；变更记录见右侧活动记录。
              </p>
            </>
          ) : key === "commercial" ? (
            <>
              <div className="content-section-heading">
                <h2>商务信息</h2>
                {editable ? (
                  <Button onClick={() => start("commercial")}>编辑商务信息</Button>
                ) : null}
              </div>
              <div className="content-form-grid">
                <ReadOnlyValue
                  label="等级 / 手工加权"
                  value={`${drama.heatTier ?? "—"} / ${drama.manualBoost}`}
                />
                <ReadOnlyValue
                  label="适投行业"
                  value={drama.industries.map((v) => v.name).join(" / ") || "—"}
                />
                <ReadOnlyValue label="目标人群" value={drama.targetAudience ?? "—"} />
                <ReadOnlyValue
                  label="允许位置"
                  value={
                    drama.allowedPlacements.map((v) => PLACEMENT_LABELS[v] ?? v).join(" / ") || "—"
                  }
                />
                <ReadOnlyValue
                  label="已开放位置"
                  value={
                    drama.openPlacementSlots.map((v) => PLACEMENT_LABELS[v] ?? v).join(" / ") || "—"
                  }
                />
                <ReadOnlyValue
                  label="试订集数 / 正文策略"
                  value={`${drama.trialEpisodeCount ?? "—"} / ${drama.bodyEditPolicy}`}
                />
              </div>
              <p>积分价、折扣后价格均来自服务端。</p>
            </>
          ) : (
            <EpisodesPanel
              api={api}
              drama={drama}
              editable={editable}
              mediaEditable={mediaEditable}
              scope={scope}
              refresh={refresh}
            />
          ),
        }))}
        aside={
          !drama
            ? []
            : [
                {
                  key: "checks",
                  title: `上架校验 ${drama.listingChecks.passedCount} / ${drama.listingChecks.total}`,
                  content: (
                    <>
                      <p>评估于 {drama.listingChecks.evaluatedAt}</p>
                      <ul className="drama-checks">
                        {drama.listingChecks.items.map((item) => (
                          <li key={item.code} data-ok={item.isOk}>
                            <strong>
                              {item.isOk ? "通过" : item.severity === "block" ? "阻断" : "提示"} ·{" "}
                              {item.code} {item.label}
                            </strong>
                            {item.note ? <p>{item.note}</p> : null}
                            {item.fixTab && EDIT_TABS.some((v) => v === item.fixTab) ? (
                              <Button
                                type="link"
                                onClick={() => {
                                  const next = EDIT_TABS.find((v) => v === item.fixTab);
                                  if (next) tab(next);
                                }}
                              >
                                去补充
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ),
                },
                {
                  key: "price",
                  title: "当前积分价",
                  content: (
                    <>
                      <ReadOnlyValue
                        label="P / 模板价 T"
                        value={`${pointsText(drama.pricing.listPricePoints)} / ${pointsText(drama.pricing.templatePoints)}`}
                      />
                      <p>{drama.pricing.priceMode === "custom" ? "采用单剧价" : "采用模板价"}</p>
                      {drama.pricing.planPrices.map((price) => (
                        <p key={price.planId}>
                          {price.planName}：{pointsText(price.discountedPoints)}
                        </p>
                      ))}
                      {drama.pricing.pendingRevisions.map((revision) => (
                        <p key={revision.dramaPriceRevisionId}>
                          待生效 {pointsText(revision.newPoints)} · {revision.effectiveAt}
                        </p>
                      ))}
                      {hasModuleLevel(access, "billing") ? (
                        <Button
                          onClick={() =>
                            void navigate({
                              to: "/billing/pricing",
                              search: { tab: "dramas", page: 1, pageSize: 20, q: drama.title },
                            })
                          }
                        >
                          查看定价
                        </Button>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: "activity",
                  title: "活动记录",
                  content: (
                    <ActivityPanel
                      key={`${id}:${drama.updatedAt}`}
                      api={api}
                      id={id}
                      scope={scope}
                    />
                  ),
                },
              ]
        }
      />
      {dict.isError ? (
        <Alert
          type="warning"
          title="字典读取失败，编辑前请重新读取"
          action={<Button onClick={() => void dict.refetch()}>重试字典</Button>}
        />
      ) : null}
      {form?.kind === "basic" && dict.data ? (
        <BasicDialog
          api={api}
          drama={form.snapshot}
          dictionary={dict.data}
          onClose={close}
          onSaved={refresh}
        />
      ) : form?.kind === "commercial" && dict.data ? (
        <CommercialDialog
          api={api}
          drama={form.snapshot}
          dictionary={dict.data}
          onClose={close}
          onSaved={refresh}
        />
      ) : form?.kind === "cast" ? (
        <CastDialog api={api} drama={form.snapshot} onClose={close} onSaved={refresh} />
      ) : form?.kind === "copyright" || form?.kind === "revision" ? (
        <CopyrightDialog
          api={api}
          drama={form.snapshot}
          revision={form.kind === "revision"}
          onClose={close}
          onSaved={refresh}
        />
      ) : form?.kind === "recheck" ? (
        <RecheckDialog api={api} drama={form.snapshot} onClose={close} onSaved={refresh} />
      ) : null}
      {listing ? (
        <ListingDialog
          api={listApi}
          id={id}
          action={listing}
          onClose={() => setListing(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
function RecheckDialog({
  api,
  drama,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  drama: DramaDetail;
  onClose(): void;
  onSaved(): void;
}) {
  const [note, setNote] = useState("");
  const [intent] = useState(() => createContentIntent("permit-recheck"));
  return (
    <ContentDialog
      title="确认许可重新核验"
      intent={intent}
      onClose={onClose}
      submitText="确认已核验"
      submit={async () => {
        if (
          await intent.submit({ note }, (key, signal) =>
            api.recheck(drama.dramaId, note, key, signal),
          )
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <p>
        请核对当前已提交原片内许可信息、备案编号和本剧许可记录；确认后由服务端重新判断上架条件。
      </p>
      <FormField label="核验说明" value={note} maxLength={200}>
        {(field) => (
          <Input.TextArea
            {...field}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </FormField>
    </ContentDialog>
  );
}
function ActivityPanel({ api, id, scope }: { api: DramaApi; id: string; scope: string }) {
  const query = useInfiniteQuery({
    queryKey: ["drama", id, "activity", scope],
    queryFn: ({ signal, pageParam }) => api.activity(id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    ...DETAIL_QUERY,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      {items.map((item) => (
        <article className="content-activity" key={item.activityId}>
          <strong>{item.summary}</strong>
          <p>
            {item.actorName ?? item.actorType} · {item.occurredAt}
          </p>
          {item.reasonText ? <p>{item.reasonText}</p> : null}
          {item.transition ? (
            <p>
              {item.transition.fromState ?? "创建"} → {item.transition.toState}
            </p>
          ) : null}
        </article>
      ))}
      {query.isPending ? <p aria-busy="true">读取活动记录…</p> : null}
      {query.isError ? (
        <Alert
          type="error"
          title={contentError(query.error)}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : null}
      {query.hasNextPage ? (
        <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          更多记录
        </Button>
      ) : null}
      {!query.isPending && !items.length && !query.isError ? <p>暂无活动记录</p> : null}
    </>
  );
}
