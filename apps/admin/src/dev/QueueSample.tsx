// 审核工作台骨架的样例页：页面只填页签、队列取数、队列项与详情怎么画、清单、动作。
import type { ErrorBody } from "@liyoxi/contract/errors";
import { statusToneByEnum } from "@liyoxi/shared/design/status-tone";
import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { InfoList } from "../components/InfoList";
import { PageHeader } from "../components/PageHeader";
import {
  QueueWorkbench,
  type QueueActionContext,
  type QueueActionResult,
  type QueueState,
} from "../components/QueueWorkbench";
import { StatusTag } from "../components/StatusTag";
import { hasModuleLevel } from "../lib/permissions";
import { QUEUE_QUERY } from "../lib/query";
import { readQueueSearch, writeQueueSearch } from "../lib/queue";
import { rootRoute } from "../routes/__root";

import { DEV_FIXTURE_MARK } from "./mark";
import { SampleApiError, sampleClient, sampleQuery } from "./sample-api";
import { SAMPLE_CHECKLIST, type SampleReviewItem } from "./sample-data";

// 不直接 import 路由对象：路由文件反过来动态引入本页，直接引会成环
const route = getRouteApi("/dev/queue");

type Review = SampleReviewItem;

/**
 * 已处理的事项显示成什么：色调与叫法取状态字典（资质审核的 store.qualification_status），页面不自己判色调。
 * 队列项的标签、详情卡右上角的状态、处理结果条三处用同一个结果。没处理过的返回 undefined。
 */
function settledOf(item: Review): { tone: "success" | "danger"; label: string } | undefined {
  if (item.qualificationStatus === undefined) return undefined;
  const entry = statusToneByEnum("store.qualification_status", item.qualificationStatus)?.admin;
  if (!entry) return undefined;
  return {
    // 处理结果只有两种色调（规范 第 5.2 节“处理结果条”：通过为成功色调，驳回为错误色调）
    tone: entry.tone === "danger" ? "danger" : "success",
    label: item.handledBy ? `${entry.label}（${item.handledBy}）` : entry.label,
  };
}

/** 冲突的两个码（别人先处理了）交给骨架去刷新队列并跳下一条，提示由请求层出；其余失败留在这一条 */
function toResult(error: ErrorBody | undefined, done: QueueActionResult): QueueActionResult {
  if (!error) return done;
  if (error.error === "STATE_NOT_ALLOWED" || error.error === "VERSION_CONFLICT") {
    return { outcome: "conflict" };
  }
  return { outcome: "failed", message: error.message };
}

export function QueueSample() {
  const { services, access } = rootRoute.useRouteContext();
  const navigate = route.useNavigate();
  const search = readQueueSearch(route.useSearch());
  const queryClient = useQueryClient();
  const client = sampleClient(services);
  const tab = search.tab ?? "pending";
  const listQuery = { tab, ...(search.q ? { q: search.q } : {}) };

  const list = useQuery({
    queryKey: ["samples", "reviews", "list", listQuery],
    queryFn: async () => {
      const { data, error } = await client.GET("/admin/samples/reviews", {
        params: { query: listQuery },
      });
      if (!data) throw new SampleApiError(error);
      return data.data.items;
    },
    ...QUEUE_QUERY,
  });
  // 页签计数：用带类型的查询钩子取（路径、参数、响应都按 paths 推出）
  const summary = sampleQuery(services).useQuery(
    "get",
    "/admin/samples/reviews/summary",
    {},
    QUEUE_QUERY,
  );

  const queue: QueueState<Review> =
    list.status === "pending"
      ? { status: "loading" }
      : list.status === "error"
        ? { status: "error", message: list.error.message }
        : { status: "success", items: list.data };

  const decide =
    (
      path:
        "/admin/samples/reviews/{reviewId}/approve" | "/admin/samples/reviews/{reviewId}/reject",
    ) =>
    async ({
      item,
      checked,
      idempotencyKey,
    }: QueueActionContext<Review>): Promise<QueueActionResult> => {
      const { error } = await client.POST(path, {
        params: { path: { reviewId: item.id }, header: { "Idempotency-Key": idempotencyKey } },
        body: { lockVersion: item.lockVersion, checked: [...checked] },
      });
      return toResult(
        error,
        path.endsWith("approve")
          ? { outcome: "done", message: `${item.storeName}：审核已通过` }
          : { outcome: "done", message: `${item.storeName}：已驳回，商家会收到补正通知` },
      );
    };

  const canEdit = hasModuleLevel(access, "merchant", "e");

  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <PageHeader
        title="资质审核"
        subtitle="样例页：审核工作台骨架，数据是夹具。队列按提交时间排序，须在 1 个工作日内完成。"
      />
      <QueueWorkbench<Review>
        label="资质审核"
        tabs={[
          { key: "pending", label: "待审核", count: summary.data?.data.pending },
          { key: "done", label: "今日已审核", count: summary.data?.data.done },
        ]}
        search={search}
        onSearchChange={(next) => void navigate({ search: writeQueueSearch(next) })}
        searchPlaceholder="门店名称"
        queue={queue}
        onRetry={() => void list.refetch()}
        onQueueChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["samples", "reviews"] });
          void queryClient.invalidateQueries({
            queryKey: ["get", "/admin/samples/reviews/summary"],
          });
        }}
        itemKey={(item) => item.id}
        renderItem={(item) => {
          const settled = settledOf(item);
          return {
            title: item.storeName,
            line: `${item.category} · ${item.region}`,
            meta: `${item.kind} · 提交于 ${appDateTimeFormat.dateTime(item.submittedAt)}`,
            tag: settled ? (
              <StatusTag tone={settled.tone}>{settled.label}</StatusTag>
            ) : (
              // 截止时间不是状态，字典里没有它，直接给色调
              <StatusTag tone="warning">
                {appDateTimeFormat.deadline(item.deadlineAt)} 截止
              </StatusTag>
            ),
          };
        }}
        detailHeader={(item) => {
          const settled = settledOf(item);
          return {
            title: item.storeName,
            description: `${item.entityName} · ${item.category} · ${item.region} · 联系人 ${item.contactMasked}`,
            status: settled ? (
              <StatusTag size="large" tone={settled.tone}>
                {settled.label}
              </StatusTag>
            ) : (
              <StatusTag size="large" tone="warning">
                待审核 · {appDateTimeFormat.deadline(item.deadlineAt)} 截止
              </StatusTag>
            ),
          };
        }}
        detail={(item) => (
          <div>
            <h3 className="lyx-section-title">营业执照 · 识别结果</h3>
            <InfoList
              labelWidth={110}
              items={item.fields.map((field) => ({
                label: field.label,
                value: `${field.value}（${field.verdict}）`,
              }))}
            />
          </div>
        )}
        checklist={tab === "pending" ? { items: SAMPLE_CHECKLIST } : undefined}
        readOnlyHint={canEdit ? undefined : "你的权限只能查看，不能审核"}
        settled={(item) => {
          const settled = settledOf(item);
          if (!settled) return undefined;
          return settled.tone === "danger"
            ? { tone: "danger", message: "已驳回，商家补正后会重新进入审核队列" }
            : { tone: "success", message: `审核${settled.label}，已通知商家` };
        }}
        actions={[
          {
            key: "reject",
            label: "驳回",
            kind: "reject",
            run: decide("/admin/samples/reviews/{reviewId}/reject"),
          },
          {
            key: "approve",
            label: "审核通过",
            kind: "primary",
            needsChecklist: true,
            run: decide("/admin/samples/reviews/{reviewId}/approve"),
          },
        ]}
      />
    </div>
  );
}
