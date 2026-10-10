import { statusToneByEnum } from "@liyoxi/shared/design/status-tone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { useRef, useState } from "react";
import { ConfirmAction } from "../../../components/ConfirmAction";
import { QueryTablePage, type QueryColumn } from "../../../components/QueryTablePage";
import { StatusTag } from "../../../components/StatusTag";
import { useModuleLevel } from "../../../lib/permissions";
import { LIST_QUERY } from "../../../lib/query";
import { BannerEditor } from "./banner-editor";
import { createSiteIntent, moveId, type homeSearch } from "./model";
import {
  bannerOrderStale,
  siteError,
  versionConflict,
  type Banner,
  type BannerQuery,
  type SiteApi,
} from "./api";

type Search = ReturnType<typeof homeSearch>;
const labels = { live: "生效中", scheduled: "已排期", ended: "已结束", disabled: "已停用" };
const displayTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
export function Banners({
  api,
  search,
  change,
}: {
  api: SiteApi;
  search: Search;
  change(patch: Partial<Search>): void;
}) {
  const editable = useModuleLevel("ops") === "e";
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ banner?: Banner }>(),
    [toggle, setToggle] = useState<Banner>();
  const [message, setMessage] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [intent] = useState(() => createSiteIntent("banner-order"));
  const running = useRef(false),
    dragged = useRef<string | undefined>(undefined);
  const summary = useQuery({
    queryKey: ["ops", "banner-summary"],
    queryFn: ({ signal }) => api.summary(signal),
    ...LIST_QUERY,
  });
  const current = useQuery({
    queryKey: ["ops", "banner-unended"],
    queryFn: ({ signal }) => api.unended(signal),
    ...LIST_QUERY,
  });
  const query: BannerQuery = {
    page: search.bannerPage,
    pageSize: search.bannerPageSize,
    sort: "position",
    isEnded: search.bannerState === "current" ? false : undefined,
    displayState:
      search.bannerState === "all" || search.bannerState === "current"
        ? undefined
        : search.bannerState,
  };
  const list = useQuery({
    queryKey: ["ops", "banners", query],
    queryFn: ({ signal }) => api.banners(query, signal),
    ...LIST_QUERY,
  });
  const refresh = async () => {
    await Promise.all([
      list.refetch(),
      current.refetch(),
      summary.refetch(),
      queryClient.invalidateQueries({ queryKey: ["ops", "home-preview-banners"] }),
    ]);
  };
  async function reorder(source: string, target: string) {
    if (running.current || !editable || !current.data || source === target) return;
    const ids = current.data.map((row) => row.homeBannerId),
      ordered = moveId(ids, source, target);
    if (ordered.every((id, index) => id === ids[index])) return;
    running.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.reorder(ordered, intent.key({ homeBannerIds: ordered }));
      intent.done();
      await refresh();
      setMessage("Banner 顺序已保存");
    } catch (error) {
      await refresh();
      if (bannerOrderStale(error) || versionConflict(error)) intent.done();
      setMessage(
        bannerOrderStale(error) || versionConflict(error)
          ? "排序集合已变化，已重新读取。请核对当前完整列表后重新排序。"
          : siteError(error),
      );
    } finally {
      running.current = false;
      setBusy(false);
      dragged.current = undefined;
    }
  }
  const columns: QueryColumn<Banner>[] = [
    {
      key: "order",
      title: "顺序",
      width: 130,
      render: (row) => {
        const ids = current.data?.map((item) => item.homeBannerId) ?? [],
          index = ids.indexOf(row.homeBannerId);
        return editable && index >= 0 ? (
          <div className="lyx-site-actions">
            <button
              type="button"
              className="lyx-link lyx-site-drag"
              aria-label={`拖动排序 ${row.title}`}
              draggable={!busy}
              onDragStart={() => {
                dragged.current = row.homeBannerId;
              }}
              onDragEnd={() => {
                dragged.current = undefined;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current) void reorder(dragged.current, row.homeBannerId);
              }}
            >
              ↕
            </button>
            <Button
              size="small"
              aria-label={`上移 ${row.title}`}
              disabled={busy || index === 0}
              onClick={() => void reorder(row.homeBannerId, ids[index - 1]!)}
            >
              上
            </Button>
            <Button
              size="small"
              aria-label={`下移 ${row.title}`}
              disabled={busy || index >= ids.length - 1}
              onClick={() => void reorder(row.homeBannerId, ids[index + 1]!)}
            >
              下
            </Button>
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      key: "image",
      title: "图片",
      width: 116,
      render: (row) =>
        row.imageUrl ? (
          <img className="lyx-site-thumb" src={row.imageUrl.url} alt={row.title} />
        ) : (
          "图片链接未取得"
        ),
    },
    {
      key: "title",
      title: "标题与跳转",
      render: (row) => (
        <div className="lyx-cell-2">
          <div className="lyx-cell-2__main">{row.title}</div>
          <div className="lyx-cell-2__sub">{row.jumpTargetLabel ?? "不跳转"}</div>
        </div>
      ),
    },
    {
      key: "time",
      title: "生效时间",
      width: 200,
      render: (row) => (
        <div className="lyx-cell-2">
          <div className="lyx-cell-2__main">{displayTime(row.startAt)}</div>
          <div className="lyx-cell-2__sub">
            至 {row.endAt ? displayTime(row.endAt) : "长期有效"}
          </div>
        </div>
      ),
    },
    {
      key: "state",
      title: "状态",
      width: 90,
      render: (row) => (
        <StatusTag
          tone={
            statusToneByEnum("home_banner.display_state", row.displayState)?.admin?.tone ??
            "neutral"
          }
        >
          {labels[row.displayState]}
        </StatusTag>
      ),
    },
    {
      key: "clicks",
      title: "点击",
      width: 70,
      align: "right",
      render: (row) => row.clickCount ?? "—",
    },
    {
      key: "actions",
      title: "操作",
      width: 130,
      render: (row) =>
        editable ? (
          <div className="lyx-site-actions">
            {row.actions.includes("edit") ? (
              <Button size="small" type="link" onClick={() => setEditing({ banner: row })}>
                编辑
              </Button>
            ) : null}
            {row.actions.includes(row.isEnabled ? "disable" : "enable") ? (
              <Button
                size="small"
                type="link"
                danger={row.isEnabled}
                onClick={() => setToggle(row)}
              >
                {row.isEnabled ? "停用" : "启用"}
              </Button>
            ) : null}
          </div>
        ) : (
          "只读"
        ),
    },
  ];
  return (
    <section aria-label="Banner" className="lyx-site-stack">
      <div className="lyx-site-section-heading">
        <div>
          <h2>Banner</h2>
          <p>
            {summary.data
              ? `生效中 ${summary.data.live} 张 · 最多 ${summary.data.maxActive} 张`
              : "正在读取 Banner 上限…"}
          </p>
        </div>
        {editable ? (
          <Button type="primary" onClick={() => setEditing({})}>
            新增 Banner
          </Button>
        ) : null}
      </div>
      {message ? <Alert type="info" title={message} /> : null}
      {summary.isError || current.isError ? (
        <Alert
          type="error"
          title={siteError(summary.error ?? current.error)}
          action={<Button onClick={() => void refresh()}>重新加载</Button>}
        />
      ) : null}
      <QueryTablePage
        label="Banner 列表"
        search={{
          page: search.bannerPage,
          pageSize: search.bannerPageSize,
          filters: { displayState: search.bannerState },
        }}
        onSearchChange={(next) =>
          change({
            bannerPage: next.page,
            bannerPageSize: next.pageSize,
            bannerState: next.filters.displayState ?? "current",
          })
        }
        filters={[
          {
            key: "displayState",
            placeholder: "显示状态",
            options: [
              { value: "current", label: "全部未结束（含停用）" },
              { value: "all", label: "全部" },
              ...Object.entries(labels).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        columns={columns}
        rowKey={(row) => row.homeBannerId}
        refreshing={list.isFetching}
        query={
          list.isError
            ? { status: "error", message: siteError(list.error) }
            : list.data
              ? { status: "success", items: list.data.items, total: list.data.total }
              : { status: "loading" }
        }
        onRetry={() => void refresh()}
        empty={{ title: "暂无 Banner", filteredTitle: "没有符合条件的 Banner" }}
      />
      <p className="lyx-site-help">
        拖动顺序符号或使用上移、下移。排序提交全部未结束 Banner，包含停用行；到达结束时间自动下线。
      </p>
      {editing ? (
        <BannerEditor
          api={api}
          banner={editing.banner}
          close={() => setEditing(undefined)}
          saved={refresh}
        />
      ) : null}
      {toggle ? (
        <ConfirmAction
          open
          action="banner-toggle"
          spec={{
            title: toggle.isEnabled ? "停用 Banner" : "启用 Banner",
            echo: [
              { label: "标题", value: toggle.title },
              { label: "版本锁", value: String(toggle.lockVersion) },
            ],
            checkLabel: "我已核对 Banner 与生效时间",
            danger: toggle.isEnabled,
          }}
          onCancel={() => setToggle(undefined)}
          onDone={() => {
            setToggle(undefined);
            setMessage("Banner 状态已更新");
          }}
          onConfirm={async ({ idempotencyKey }) => {
            try {
              await api.updateBanner(
                toggle.homeBannerId,
                { lockVersion: toggle.lockVersion, isEnabled: !toggle.isEnabled },
                idempotencyKey,
              );
              await refresh();
              return { outcome: "done" };
            } catch (error) {
              await refresh();
              if (versionConflict(error)) {
                setToggle(undefined);
                setMessage("Banner 已变化，请核对新版本后重新操作");
              }
              return { outcome: "failed", message: siteError(error) };
            }
          }}
        />
      ) : null}
    </section>
  );
}
