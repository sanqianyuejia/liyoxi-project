import type { HomeRecommendConfig, SiteConfigView } from "@liyoxi/contract";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Button, InputNumber, Radio, Select } from "antd";
import { useMemo, useState } from "react";
import { FormField } from "../../../components/FormField";
import { PageHeader } from "../../../components/PageHeader";
import { DICT_QUERY } from "../../../lib/query";
import { createSiteApi, siteError, type SiteApi } from "./api";
import { Banners } from "./banners";
import { homeSearch } from "./model";
import { errorAt, SiteConfigEditor } from "./site-editor";

const route = getRouteApi("/ops/home");
export function OpsHomePage() {
  const { services } = useRouteContext({ from: "__root__" });
  const api = useMemo(() => createSiteApi(services), [services]);
  const search = homeSearch(route.useSearch()),
    navigate = route.useNavigate();
  const change = (patch: Partial<typeof search>) => {
    void navigate({ search: { ...search, ...patch } });
  };
  const preview = useQuery({
    queryKey: ["ops", "home-preview-banners"],
    queryFn: ({ signal }) => api.banners({ displayState: "live", pageSize: 100 }, signal),
  });
  return (
    <>
      <PageHeader
        title="首页配置"
        subtitle="配置小程序首页的 Banner 与推荐位；待办提醒、快捷入口与上线概览为固定模块。"
      />
      <div className="lyx-site-stack">
        <Banners api={api} search={search} change={change} />
        <SiteConfigEditor
          api={api}
          kind="home_recommend"
          label="推荐位"
          historyPage={search.historyPage}
          onHistoryPage={(historyPage) => change({ historyPage })}
          aside={(content, view) => (
            <section aria-label="首页预览" className="lyx-site-preview">
              <h2>首页预览</h2>
              <p>当前编辑配置 · 推荐结果与价格由服务端提供</p>
              {preview.data?.items[0]?.imageUrl ? (
                <img src={preview.data.items[0].imageUrl.url} alt={preview.data.items[0].title} />
              ) : (
                <p>暂无生效 Banner 图片</p>
              )}
              {preview.isError ? (
                <p role="alert">Banner 预览读取失败：{siteError(preview.error)}</p>
              ) : null}
              {"pins" in content ? (
                <>
                  <h3>为你推荐 · 展示 {content.recommendCount} 部</h3>
                  <ul>
                    {content.pins.map((pin) => {
                      const ref = view.refs.pins.find(
                        (row) =>
                          row.industryCode === pin.industryCode && row.dramaId === pin.dramaId,
                      );
                      return (
                        <li key={pin.industryCode}>
                          {ref
                            ? `${ref.industryName} · ${ref.dramaTitle}`
                            : `${pin.industryCode} · 新编辑的置顶剧目`}
                        </li>
                      );
                    })}
                  </ul>
                  <p>
                    {content.defaultTab === "hot" ? "热门" : "新剧"} · 上架 {content.newDays} 天内
                  </p>
                </>
              ) : null}
            </section>
          )}
        >
          {(content, changeContent, view, errors) =>
            "pins" in content ? (
              <RecommendationForm
                api={api}
                content={content}
                change={changeContent}
                view={view}
                errors={errors}
              />
            ) : (
              <p role="alert">服务端配置类型不匹配</p>
            )
          }
        </SiteConfigEditor>
      </div>
    </>
  );
}
function RecommendationForm({
  api,
  content,
  change,
  view,
  errors,
}: {
  api: SiteApi;
  content: HomeRecommendConfig;
  change(content: HomeRecommendConfig): void;
  view: SiteConfigView;
  errors: Record<string, string>;
}) {
  const [industry, setIndustry] = useState<string>(),
    [dramaId, setDramaId] = useState<string>(),
    [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>();
  const dictionaries = useQuery({
    queryKey: ["ops", "site-dictionaries"],
    queryFn: ({ signal }) => api.dictionaries(signal),
    ...DICT_QUERY,
  });
  const dramas = useQuery({
    queryKey: ["ops", "pin-dramas", query],
    queryFn: ({ signal }) => api.dramas(query, signal),
    ...DICT_QUERY,
  });
  const industries =
    dictionaries.data?.items.filter(
      (row) => row.typeKey === "industry" && row.parentCode === null,
    ) ?? [];
  return (
    <div className="lyx-site-stack">
      <section>
        <h3>为你推荐</h3>
        <p>按短剧适配行业与商家档案匹配；未建档时展示热门短剧。</p>
        <FormField label="展示数量（3–12 部）" error={errorAt(errors, "recommendCount")}>
          {(props) => (
            <InputNumber
              {...props}
              data-site-path="recommendCount"
              value={content.recommendCount}
              min={3}
              max={12}
              precision={0}
              onChange={(value) => change({ ...content, recommendCount: value ?? 0 })}
            />
          )}
        </FormField>
      </section>
      <section data-site-path="pins">
        <h3>按行业置顶</h3>
        <div className="lyx-site-actions">
          {content.pins.map((pin, index) => {
            const ref = view.refs.pins.find(
              (row) => row.dramaId === pin.dramaId && row.industryCode === pin.industryCode,
            );
            const invalid =
              view.refs.invalidRefs.some((item) => item.path.startsWith(`pins.${index}`)) ||
              Boolean(errorAt(errors, `pins.${index}`));
            return (
              <span
                className={`lyx-site-chip${invalid ? " lyx-site-invalid" : ""}`}
                key={pin.industryCode}
              >
                {industries.find((row) => row.code === pin.industryCode)?.name ?? pin.industryCode}{" "}
                ·{" "}
                {ref?.dramaTitle ??
                  dramas.data?.items.find((row) => row.dramaId === pin.dramaId)?.title ??
                  "剧目引用待核对"}
                <Button
                  type="link"
                  size="small"
                  aria-label={`移除 ${pin.industryCode} 置顶`}
                  onClick={() =>
                    change({ ...content, pins: content.pins.filter((row) => row !== pin) })
                  }
                >
                  移除
                </Button>
              </span>
            );
          })}
        </div>
        <div className="lyx-site-actions">
          <Select
            aria-label="置顶行业"
            placeholder="选择行业"
            value={industry}
            onChange={setIndustry}
            options={industries.map((row) => ({ value: row.code, label: row.name }))}
          />
          <Select
            aria-label="置顶短剧"
            placeholder="搜索已上架短剧"
            showSearch
            filterOption={false}
            onSearch={setQuery}
            value={dramaId}
            onChange={setDramaId}
            loading={dramas.isFetching}
            options={dramas.data?.items.map((row) => ({ value: row.dramaId, label: row.title }))}
          />
          <Button
            onClick={() => {
              if (!industry || !dramaId) {
                setMessage("请选择行业和短剧");
                return;
              }
              if (content.pins.some((pin) => pin.industryCode === industry)) {
                setMessage("每个行业至多置顶一部短剧");
                return;
              }
              change({ ...content, pins: [...content.pins, { industryCode: industry, dramaId }] });
              setMessage(undefined);
            }}
          >
            添加置顶
          </Button>
        </div>
        {message ? <p role="alert">{message}</p> : null}
        {dictionaries.isError || dramas.isError ? (
          <p role="alert">
            引用读取失败：{siteError(dictionaries.error ?? dramas.error)}
            <Button
              onClick={() => {
                void dictionaries.refetch();
                void dramas.refetch();
              }}
            >
              重新加载引用
            </Button>
          </p>
        ) : null}
      </section>
      <section>
        <h3>热门与新剧</h3>
        <p>热门按服务端热度与订购数据排序，新剧按上架时间排序。</p>
        <FormField label="默认页签" error={errorAt(errors, "defaultTab")}>
          {() => (
            <Radio.Group
              data-site-path="defaultTab"
              value={content.defaultTab}
              onChange={(event) =>
                change({ ...content, defaultTab: event.target.value as "hot" | "new" })
              }
              options={[
                { value: "hot", label: "热门" },
                { value: "new", label: "新剧" },
              ]}
            />
          )}
        </FormField>
        <FormField label="新剧范围（上架 7–90 天内）" error={errorAt(errors, "newDays")}>
          {(props) => (
            <InputNumber
              {...props}
              data-site-path="newDays"
              value={content.newDays}
              min={7}
              max={90}
              precision={0}
              onChange={(value) => change({ ...content, newDays: value ?? 0 })}
            />
          )}
        </FormField>
      </section>
    </div>
  );
}
