// 审核工作台骨架（D7 第 5.3 节 QueueWorkbench；规范 第 5.2 节“队列工作台”）：左队列、右详情、清单勾选、底部动作条。
// 页面只填：页签、队列取数结果、队列项与详情怎么画、清单、动作。行为约定：
//   1. 当前页签、选中项、搜索词进 URL（?tab=&id=&q=）：本构件受控，由路由接到地址上（lib/queue.ts）。
//   2. 清单没勾完，needsChecklist 的动作禁用；勾选状态只在本地，提交时把勾选结果交给动作函数。
//   3. 动作带幂等键（一次意图一个键：选中一条时生成，处理完或换一条时换新）。记录的 lockVersion 由页面的动作函数回传。
//      别人先处理了（VERSION_CONFLICT、STATE_NOT_ALLOWED）：动作函数返回 conflict，这里提示并跳到下一条。
//   4. 处理完自动选中下一条；队列空时显示空态。
//   5. 队列的定时静默刷新由取数一侧做（lib/query.ts 的 QUEUE_QUERY），不打断正在看的详情。
import { Alert, Button } from "antd";
import { useState, type ReactNode } from "react";

import { newIdempotencyKey } from "../lib/idempotency";
import { checklistDone, currentKey, nextKey, type QueueSearch } from "../lib/queue";

import { CheckList, type CheckListItem } from "./CheckList";
import { KeywordInput } from "./KeywordInput";
import { EmptyState, ErrorState } from "./StateBlock";
import { Tabs, type TabItem } from "./Tabs";

export type QueueState<Item> =
  | { status: "loading" }
  | { status: "error"; message?: string }
  | { status: "success"; items: readonly Item[] };

export type QueueActionResult =
  /** 处理成功：tone 决定结果条的色调（通过为成功、驳回为错误） */
  | { outcome: "done"; tone: "success" | "danger"; message: string }
  /** 已被别人处理：提示、刷新队列并跳到下一条 */
  | { outcome: "conflict"; message: string }
  /** 没处理成：留在这一条，把原因显示在动作条左侧 */
  | { outcome: "failed"; message: string };

export interface QueueActionContext<Item> {
  item: Item;
  /** 已勾选的清单项，随请求交给服务端留痕 */
  checked: readonly string[];
  idempotencyKey: string;
}

export interface QueueAction<Item> {
  key: string;
  label: string;
  /** 主按钮（通过）；另一种是驳回样式 */
  kind: "primary" | "reject";
  /** 清单没勾完时禁用 */
  needsChecklist?: boolean;
  /** 权限不够时不渲染：由页面按 useCan 的结果传 */
  hidden?: boolean;
  run: (context: QueueActionContext<Item>) => Promise<QueueActionResult>;
}

export interface QueueWorkbenchProps<Item> {
  label: string;
  tabs: readonly TabItem[];
  defaultTab?: string;
  search: QueueSearch;
  onSearchChange: (next: QueueSearch) => void;
  searchPlaceholder?: string;
  queue: QueueState<Item>;
  onRetry: () => void;
  /** 处理完或发现冲突后调：让队列重新取数 */
  onQueueChanged: () => void;
  itemKey: (item: Item) => string;
  renderItem: (item: Item) => { title: string; line: string; meta: string; tag?: ReactNode };
  detailHeader: (item: Item) => { title: string; description?: string; status?: ReactNode };
  detail: (item: Item) => ReactNode;
  checklist?: { items: readonly CheckListItem[]; title?: string };
  actions: readonly QueueAction<Item>[];
  /** 不能处理时（只读页签、等级只有查看）动作条换成这句说明 */
  readOnlyHint?: string;
  empty?: { title: string; description?: string };
}

type ResultStrip = { tone: "success" | "danger" | "warning"; message: string };

const SKELETON_ITEMS = 3;

interface QueueDetailProps<Item> {
  item: Item;
  header: { title: string; description?: string; status?: ReactNode };
  body: ReactNode;
  checklist?: { items: readonly CheckListItem[]; title?: string };
  actions: readonly QueueAction<Item>[];
  readOnlyHint?: string;
  /** 处理成功或发现已被别人处理：交回外层去出结果条、选下一条、刷新队列 */
  onSettled: (result: ResultStrip) => void;
}

/**
 * 右侧详情里随“选中的这一条”走的部分：清单勾选、幂等键、动作的提交状态。
 * 外层按选中项的键重建它，换一条时这些状态自然清空（清单不带到下一条，幂等键换新）。
 */
function QueueDetail<Item>({
  item,
  header,
  body,
  checklist,
  actions,
  readOnlyHint,
  onSettled,
}: QueueDetailProps<Item>) {
  const [checked, setChecked] = useState<string[]>([]);
  const [intentKey] = useState(() => newIdempotencyKey("queue"));
  const [running, setRunning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const checklistOk = checklistDone(checklist?.items.map((entry) => entry.key) ?? [], checked);
  const visibleActions = actions.filter((action) => !action.hidden);

  const runAction = async (action: QueueAction<Item>) => {
    if (running) return;
    setRunning(action.key);
    setFailure(null);
    let outcome: QueueActionResult;
    try {
      outcome = await action.run({ item, checked, idempotencyKey: intentKey });
    } catch {
      outcome = { outcome: "failed", message: "没有处理成功，请重试" };
    }
    setRunning(null);
    if (outcome.outcome === "failed") setFailure(outcome.message);
    else if (outcome.outcome === "done")
      onSettled({ tone: outcome.tone, message: outcome.message });
    else onSettled({ tone: "warning", message: outcome.message });
  };

  return (
    <>
      <div className="lyx-queue__detail-head">
        <div>
          <h2 className="lyx-queue__detail-title">{header.title}</h2>
          {header.description ? (
            <p className="lyx-queue__detail-desc">{header.description}</p>
          ) : null}
        </div>
        {header.status}
      </div>
      {body}
      {checklist ? (
        <div>
          <h3 className="lyx-section-title">{checklist.title ?? "核对清单"}</h3>
          <CheckList items={checklist.items} checked={checked} onChange={setChecked} />
        </div>
      ) : null}
      <div className="lyx-action-bar">
        {readOnlyHint ? (
          <span className="lyx-action-bar__hint">{readOnlyHint}</span>
        ) : (
          <>
            {failure ? (
              <span className="lyx-action-bar__hint lyx-action-bar__hint--block" role="alert">
                {failure}
              </span>
            ) : checklist && !checklistOk ? (
              <span className="lyx-action-bar__hint">核对清单全部勾选后才能通过</span>
            ) : null}
            {visibleActions.map((action) => (
              <Button
                key={action.key}
                size="large"
                type={action.kind === "primary" ? "primary" : "default"}
                className={action.kind === "reject" ? "lyx-btn-reject" : undefined}
                disabled={
                  (action.needsChecklist && !checklistOk) ||
                  (running !== null && running !== action.key)
                }
                loading={running === action.key}
                onClick={() => void runAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export function QueueWorkbench<Item>({
  label,
  tabs,
  defaultTab,
  search,
  onSearchChange,
  searchPlaceholder,
  queue,
  onRetry,
  onQueueChanged,
  itemKey,
  renderItem,
  detailHeader,
  detail,
  checklist,
  actions,
  readOnlyHint,
  empty,
}: QueueWorkbenchProps<Item>) {
  const items = queue.status === "success" ? queue.items : [];
  const keys = items.map(itemKey);
  const selectedKey = currentKey(keys, search.id);
  const selected = items.find((item) => itemKey(item) === selectedKey);
  const activeTab = search.tab ?? defaultTab ?? tabs[0]?.key ?? "";
  const [result, setResult] = useState<ResultStrip | null>(null);

  const select = (id: string | undefined) => onSearchChange({ ...search, id });

  return (
    <div className="lyx-queue" aria-label={label}>
      <section className="lyx-card lyx-queue__list" aria-label={`${label}的队列`}>
        <Tabs
          label={`${label}的页签`}
          items={tabs}
          activeKey={activeTab}
          onChange={(key) => {
            setResult(null);
            onSearchChange({ ...search, tab: key, id: undefined });
          }}
        />
        {searchPlaceholder !== undefined ? (
          <div className="lyx-queue__search">
            <KeywordInput
              value={search.q}
              placeholder={searchPlaceholder}
              onSearch={(value) =>
                onSearchChange({ ...search, q: value.trim() || undefined, id: undefined })
              }
            />
          </div>
        ) : null}
        {queue.status === "loading" ? (
          <ul className="lyx-queue__items" data-state="loading" aria-busy="true">
            {Array.from({ length: SKELETON_ITEMS }, (_, index) => (
              <li key={index} className="lyx-queue-item">
                <div className="lyx-skeleton-bar" />
              </li>
            ))}
          </ul>
        ) : null}
        {queue.status === "error" ? <ErrorState message={queue.message} onRetry={onRetry} /> : null}
        {queue.status === "success" && items.length === 0 ? (
          <EmptyState
            title={empty?.title ?? "队列里没有待处理的事项"}
            description={empty?.description}
          />
        ) : null}
        {items.length > 0 ? (
          <ul className="lyx-queue__items">
            {items.map((item) => {
              const key = itemKey(item);
              const view = renderItem(item);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="lyx-queue-item lyx-focusable"
                    aria-current={key === selectedKey}
                    data-queue-item={key}
                    onClick={() => select(key)}
                  >
                    <div className="lyx-queue-item__head">
                      <span className="lyx-queue-item__title">{view.title}</span>
                      {view.tag}
                    </div>
                    <div className="lyx-queue-item__line">{view.line}</div>
                    <div className="lyx-queue-item__meta">{view.meta}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <section className="lyx-card lyx-queue__detail" aria-label={`${label}的详情`}>
        {result ? (
          <Alert
            type={result.tone === "danger" ? "error" : result.tone}
            title={result.message}
            closable
            onClose={() => setResult(null)}
            data-testid="queue-result"
          />
        ) : null}
        {selected && selectedKey ? (
          <QueueDetail
            key={selectedKey}
            item={selected}
            header={detailHeader(selected)}
            body={detail(selected)}
            checklist={checklist}
            actions={actions}
            readOnlyHint={readOnlyHint}
            onSettled={(settled) => {
              setResult(settled);
              // 自动选中下一条；队列只有这一条时回到空态
              select(nextKey(keys, selectedKey));
              onQueueChanged();
            }}
          />
        ) : queue.status === "loading" ? (
          <div className="lyx-skeleton-rows" aria-busy="true">
            <div className="lyx-skeleton-row">
              <span className="lyx-skeleton-bar" />
            </div>
          </div>
        ) : (
          <EmptyState title="没有选中的事项" description="队列处理完了，或换一个页签看看" />
        )}
      </section>
    </div>
  );
}
