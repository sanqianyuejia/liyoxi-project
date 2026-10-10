import { MALL_SORTS, type MallBand, type MallConfig, type SiteConfigView } from "@liyoxi/contract";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Button, Checkbox, Input, InputNumber, Select, Switch } from "antd";
import { useMemo, useRef, useState } from "react";
import { FormField } from "../../../components/FormField";
import { PageHeader } from "../../../components/PageHeader";
import { DICT_QUERY } from "../../../lib/query";
import { createSiteApi, siteError, type SiteApi } from "../home/api";
import { errorAt, SiteConfigEditor } from "../home/site-editor";
import { mallSearch, newCategoryKey, reorderCategories } from "./model";
import "./mall.css";

const route = getRouteApi("/ops/mall");
const sortLabels = {
  composite: "综合排序",
  heat: "热度优先",
  price_asc: "积分价从低到高",
  price_desc: "积分价从高到低",
  newest: "最新上架",
};
const weightLabels = {
  heat: "热度等级",
  sales30d: "近 30 天订购",
  freshness: "上架时间",
  manual: "人工加权",
};
export function OpsMallPage() {
  const { services } = useRouteContext({ from: "__root__" });
  const api = useMemo(() => createSiteApi(services), [services]);
  const search = mallSearch(route.useSearch()),
    navigate = route.useNavigate();
  return (
    <>
      <PageHeader
        title="商城配置"
        subtitle="配置分类标签、筛选、排序与热门搜索词；实际展示与订购资格由服务端判定。"
      />
      <SiteConfigEditor
        api={api}
        kind="mall"
        label="商城配置"
        historyPage={search.historyPage}
        onHistoryPage={(historyPage) => {
          void navigate({ search: { historyPage } });
        }}
      >
        {(content, change, view, errors) =>
          "categories" in content ? (
            <MallForm api={api} content={content} change={change} view={view} errors={errors} />
          ) : (
            <p role="alert">服务端配置类型不匹配</p>
          )
        }
      </SiteConfigEditor>
    </>
  );
}
function MallForm({
  api,
  content,
  change,
  view,
  errors,
}: {
  api: SiteApi;
  content: MallConfig;
  change(content: MallConfig): void;
  view: SiteConfigView;
  errors: Record<string, string>;
}) {
  const [categoryName, setCategoryName] = useState(""),
    [genres, setGenres] = useState<string[]>([]);
  const [word, setWord] = useState(""),
    [message, setMessage] = useState<string>();
  const dragged = useRef<string | undefined>(undefined);
  const dictionaries = useQuery({
    queryKey: ["ops", "site-dictionaries"],
    queryFn: ({ signal }) => api.dictionaries(signal),
    ...DICT_QUERY,
  });
  const genreOptions =
    dictionaries.data?.items
      .filter((row) => row.typeKey === "genre")
      .map((row) => ({ value: row.code, label: row.name })) ?? [];
  const categoryChange = (index: number, patch: Partial<MallConfig["categories"][number]>) =>
    change({
      ...content,
      categories: content.categories.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    });
  const filterChange = (patch: Partial<MallConfig["filters"]>) =>
    change({ ...content, filters: { ...content.filters, ...patch } });
  return (
    <div className="lyx-site-stack">
      <section aria-label="分类标签" data-site-path="categories">
        <h3>分类标签</h3>
        <p>顶部分类最多 10 个，全部分类固定在首位。短剧数来自服务端引用统计。</p>
        <div className="lyx-site-table-scroll">
          <table className="lyx-mall-categories">
            <thead>
              <tr>
                <th>顺序</th>
                <th>分类名称 / key</th>
                <th>包含题材</th>
                <th>短剧数</th>
                <th>显示</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {content.categories.map((category, index) => {
                const invalid = view.refs.invalidRefs.filter((item) =>
                  item.path.startsWith(`categories.${index}.`),
                );
                const stat = view.refs.categoryStats.find((row) => row.key === category.key);
                return (
                  <tr
                    key={category.key}
                    className={invalid.length ? "lyx-site-invalid" : undefined}
                  >
                    <td>
                      {category.fixed ? (
                        "固定"
                      ) : (
                        <div className="lyx-site-actions">
                          <button
                            className="lyx-link lyx-site-drag"
                            type="button"
                            draggable
                            aria-label={`拖动分类 ${category.name}`}
                            onDragStart={() => {
                              dragged.current = category.key;
                            }}
                            onDragEnd={() => {
                              dragged.current = undefined;
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (dragged.current)
                                change(reorderCategories(content, dragged.current, category.key));
                            }}
                          >
                            ↕
                          </button>
                          <Button
                            size="small"
                            aria-label={`上移分类 ${category.name}`}
                            disabled={index <= 1}
                            onClick={() =>
                              change(
                                reorderCategories(
                                  content,
                                  category.key,
                                  content.categories[index - 1]!.key,
                                ),
                              )
                            }
                          >
                            上
                          </Button>
                          <Button
                            size="small"
                            aria-label={`下移分类 ${category.name}`}
                            disabled={index === content.categories.length - 1}
                            onClick={() =>
                              change(
                                reorderCategories(
                                  content,
                                  category.key,
                                  content.categories[index + 1]!.key,
                                ),
                              )
                            }
                          >
                            下
                          </Button>
                        </div>
                      )}
                    </td>
                    <td>
                      {category.fixed ? (
                        <strong>{category.name}</strong>
                      ) : (
                        <Input
                          aria-label={`分类名称 ${index + 1}`}
                          data-site-path={`categories.${index}.name`}
                          status={errorAt(errors, `categories.${index}.name`) ? "error" : undefined}
                          value={category.name}
                          maxLength={4}
                          onChange={(event) => categoryChange(index, { name: event.target.value })}
                        />
                      )}
                      <div className="lyx-site-help">{category.key}</div>
                    </td>
                    <td>
                      {category.fixed ? (
                        "全部已上架短剧"
                      ) : (
                        <Select
                          aria-label={`分类题材 ${category.name}`}
                          data-site-path={`categories.${index}.genreCodes`}
                          mode="multiple"
                          value={category.genreCodes}
                          options={genreOptions}
                          status={
                            invalid.length || errorAt(errors, `categories.${index}.genreCodes`)
                              ? "error"
                              : undefined
                          }
                          onChange={(genreCodes: string[]) => categoryChange(index, { genreCodes })}
                        />
                      )}
                      {invalid.map((item) => (
                        <p key={item.path} role="alert">
                          {item.code} · {item.reason}
                        </p>
                      ))}
                    </td>
                    <td>{stat ? `${stat.dramaCount} 部` : "待保存后统计"}</td>
                    <td>
                      <Switch
                        aria-label={`显示分类 ${category.name}`}
                        checked={category.visible}
                        disabled={category.fixed}
                        onChange={(visible) => categoryChange(index, { visible })}
                      />
                    </td>
                    <td>
                      {!category.fixed ? (
                        <Button
                          size="small"
                          type="link"
                          danger
                          onClick={() =>
                            change({
                              ...content,
                              categories: content.categories.filter(
                                (row) => row.key !== category.key,
                              ),
                            })
                          }
                        >
                          删除
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="lyx-site-actions">
          <Input
            aria-label="新分类名称"
            placeholder="新分类名称"
            value={categoryName}
            maxLength={4}
            onChange={(event) => setCategoryName(event.target.value)}
          />
          <Select
            aria-label="新分类包含题材"
            placeholder="包含题材"
            mode="multiple"
            value={genres}
            options={genreOptions}
            onChange={setGenres}
          />
          <Button
            disabled={content.categories.length >= 10}
            onClick={() => {
              const name = categoryName.trim();
              if (!name || !genres.length) {
                setMessage("请填写分类名称并选择至少一个题材");
                return;
              }
              if (content.categories.some((row) => row.name === name)) {
                setMessage("分类不能重名");
                return;
              }
              change({
                ...content,
                categories: [
                  ...content.categories,
                  { key: newCategoryKey(), name, genreCodes: genres, fixed: false, visible: true },
                ],
              });
              setCategoryName("");
              setGenres([]);
              setMessage(undefined);
            }}
          >
            添加分类
          </Button>
        </div>
        {dictionaries.isError ? (
          <p role="alert">
            题材字典读取失败：{siteError(dictionaries.error)}
            <Button onClick={() => void dictionaries.refetch()}>重新加载题材</Button>
          </p>
        ) : null}
      </section>
      <div className="lyx-site-form-grid">
        <section aria-label="热门搜索词" data-site-path="hotWords">
          <h3>热门搜索词</h3>
          <p>最多 8 个，每项最多 8 个字，可填写剧名、题材或行业。</p>
          <div className="lyx-site-actions">
            {content.hotWords.map((text, index) => (
              <span className="lyx-site-chip" key={`${index}:${text}`}>
                {text}
                <Button
                  size="small"
                  type="link"
                  aria-label={`移除搜索词 ${text}`}
                  onClick={() =>
                    change({
                      ...content,
                      hotWords: content.hotWords.filter((_, position) => position !== index),
                    })
                  }
                >
                  移除
                </Button>
              </span>
            ))}
          </div>
          <div className="lyx-site-actions">
            <Input
              aria-label="新搜索词"
              value={word}
              maxLength={8}
              onChange={(event) => setWord(event.target.value)}
            />
            <Button
              disabled={content.hotWords.length >= 8}
              onClick={() => {
                const text = word.trim();
                if (!text) {
                  setMessage("请填写搜索词");
                  return;
                }
                if (content.hotWords.includes(text)) {
                  setMessage("热词不能重复");
                  return;
                }
                change({ ...content, hotWords: [...content.hotWords, text] });
                setWord("");
                setMessage(undefined);
              }}
            >
              添加热词
            </Button>
          </div>
        </section>
        <section aria-label="筛选项">
          <h3>筛选项</h3>
          <p>关闭后商城不展示该筛选项。</p>
          {(["genre", "industry", "episodes", "price"] as const).map((key) => (
            <div className="lyx-site-section-heading" key={key}>
              <span>
                {{ genre: "题材", industry: "适配行业", episodes: "集数", price: "积分价" }[key]}
              </span>
              <Switch
                aria-label={`启用${{ genre: "题材", industry: "适配行业", episodes: "集数", price: "积分价" }[key]}筛选`}
                checked={content.filters[key]}
                onChange={(enabled) => filterChange({ [key]: enabled })}
              />
            </div>
          ))}
        </section>
      </div>
      <div className="lyx-site-form-grid">
        <BandEditor
          label="集数分档"
          path="filters.episodeBands"
          errors={errors}
          bands={content.filters.episodeBands}
          change={(episodeBands) => filterChange({ episodeBands })}
        />
        <BandEditor
          label="积分价分档"
          path="filters.priceBands"
          errors={errors}
          bands={content.filters.priceBands}
          change={(priceBands) => filterChange({ priceBands })}
        />
      </div>
      <section aria-label="排序方式">
        <h3>排序方式</h3>
        <p>选择可用排序与默认排序；综合排序权重合计须为 100%。</p>
        <FormField label="可用排序" error={errorAt(errors, "sorts")}>
          {() => (
            <Checkbox.Group
              data-site-path="sorts"
              value={content.sorts}
              options={MALL_SORTS.map((value) => ({ value, label: sortLabels[value] }))}
              onChange={(sorts) => change({ ...content, sorts: sorts as MallConfig["sorts"] })}
            />
          )}
        </FormField>
        <FormField label="默认排序" error={errorAt(errors, "defaultSort")}>
          {(props) => (
            <Select
              {...props}
              data-site-path="defaultSort"
              value={content.defaultSort}
              options={content.sorts.map((value) => ({ value, label: sortLabels[value] }))}
              onChange={(defaultSort: MallConfig["defaultSort"]) =>
                change({ ...content, defaultSort })
              }
            />
          )}
        </FormField>
        <div className="lyx-site-form-grid" data-site-path="weights">
          {(Object.keys(weightLabels) as (keyof MallConfig["weights"])[]).map((key) => (
            <FormField
              label={`${weightLabels[key]}权重（%）`}
              key={key}
              error={errorAt(errors, `weights.${key}`)}
            >
              {(props) => (
                <InputNumber
                  {...props}
                  data-site-path={`weights.${key}`}
                  value={content.weights[key]}
                  min={0}
                  max={100}
                  precision={0}
                  onChange={(value) =>
                    change({ ...content, weights: { ...content.weights, [key]: value ?? 0 } })
                  }
                />
              )}
            </FormField>
          ))}
        </div>
        <p className={errorAt(errors, "weights") ? "lyx-site-invalid" : undefined}>
          权重合计：{Object.values(content.weights).reduce((sum, value) => sum + value, 0)}%
        </p>
      </section>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
function BandEditor({
  label,
  path,
  errors,
  bands,
  change,
}: {
  label: string;
  path: string;
  errors: Record<string, string>;
  bands: MallBand[];
  change(bands: MallBand[]): void;
}) {
  function update(index: number, patch: Partial<MallBand>) {
    change(bands.map((band, position) => (position === index ? { ...band, ...patch } : band)));
  }
  return (
    <section aria-label={label} data-site-path={path}>
      <h3>{label}</h3>
      <p>最多 6 档。闭区间，至少填写一个边界；不设边界时留空。</p>
      <div className="lyx-site-bands lyx-site-help">
        <span>key</span>
        <span>显示名称</span>
        <span>最小值</span>
        <span>最大值</span>
        <span>操作</span>
      </div>
      {bands.map((band, index) => (
        <div className="lyx-site-bands" key={index} data-site-path={`${path}.${index}`}>
          <Input
            aria-label={`${label} ${index + 1} key`}
            status={errorAt(errors, `${path}.${index}.key`) ? "error" : undefined}
            value={band.key}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            aria-label={`${label} ${index + 1} 名称`}
            status={errorAt(errors, `${path}.${index}.label`) ? "error" : undefined}
            value={band.label}
            maxLength={10}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <InputNumber
            aria-label={`${label} ${index + 1} 最小值`}
            status={
              errorAt(errors, `${path}.${index}`) || errorAt(errors, `${path}.${index}.min`)
                ? "error"
                : undefined
            }
            min={0}
            precision={0}
            value={band.min}
            onChange={(min) => update(index, { min })}
          />
          <InputNumber
            aria-label={`${label} ${index + 1} 最大值`}
            status={
              errorAt(errors, `${path}.${index}`) || errorAt(errors, `${path}.${index}.max`)
                ? "error"
                : undefined
            }
            min={0}
            precision={0}
            value={band.max}
            onChange={(max) => update(index, { max })}
          />
          <Button
            danger
            aria-label={`删除${label} ${index + 1}`}
            onClick={() => change(bands.filter((_, position) => position !== index))}
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        disabled={bands.length >= 6}
        onClick={() =>
          change([
            ...bands,
            {
              key: `band_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
              label: "",
              min: null,
              max: null,
            },
          ])
        }
      >
        添加{label}
      </Button>
    </section>
  );
}
