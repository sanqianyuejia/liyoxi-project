// 详情页骨架的样例页：页面只填标题与状态、操作按钮、页签内容、侧栏卡片。顺带演示二次确认与上传两个构件。
import { formatMoney, formatMoneyFixed, formatPoints } from "@liyoxi/shared/format/money";
import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { statusToneByEnum } from "@liyoxi/shared/design/status-tone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "antd";
import { useState } from "react";

import { showSuccessNotice } from "../app/feedback";
import { ConfirmAction, type ConfirmSpec } from "../components/ConfirmAction";
import { DetailPage, type DetailState } from "../components/DetailPage";
import { InfoList } from "../components/InfoList";
import { StatusTag } from "../components/StatusTag";
import { UploadField } from "../components/UploadField";
import { hasModuleLevel } from "../lib/permissions";
import { DETAIL_QUERY } from "../lib/query";
import type { UploadFn, UploadRule } from "../lib/upload";
import { rootRoute } from "../routes/__root";

import { DEV_FIXTURE_MARK } from "./mark";
import { SampleApiError, sampleClient } from "./sample-api";

// 不直接 import 路由对象：路由文件反过来动态引入本页，直接引会成环
const route = getRouteApi("/dev/detail/$storeId");

const UPLOAD_RULE: UploadRule = { accept: ["image/png", "image/jpeg", ".pdf"], maxSizeMb: 10 };

/** 夹具上传：不碰网络。文件名里带“失败”的第一次传不上去，重试成功 */
function createFixtureUpload(): UploadFn {
  const failedOnce = new Set<string>();
  return async (file, { onProgress }) => {
    for (const percent of [30, 60, 90]) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      onProgress(percent);
    }
    if (file.name.includes("失败") && !failedOnce.has(file.name)) {
      failedOnce.add(file.name);
      throw new Error("上传失败：网络中断，请重试");
    }
    return { fileId: `${DEV_FIXTURE_MARK}-${file.name}` };
  };
}

export function DetailSample() {
  const { services, access } = rootRoute.useRouteContext();
  const { storeId } = route.useParams();
  const navigate = route.useNavigate();
  const rawTab = route.useSearch().tab;
  const activeTab = typeof rawTab === "string" ? rawTab : "profile";
  const queryClient = useQueryClient();
  const client = sampleClient(services);
  const [confirming, setConfirming] = useState(false);
  const [upload] = useState(createFixtureUpload);
  const [licenseFileId, setLicenseFileId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["samples", "stores", "detail", storeId],
    queryFn: async () => {
      const { data, error } = await client.GET("/admin/samples/stores/{storeId}", {
        params: { path: { storeId } },
      });
      if (!data) throw new SampleApiError(error);
      return data.data;
    },
    ...DETAIL_QUERY,
  });

  const state: DetailState =
    detail.status === "pending"
      ? { status: "loading" }
      : detail.status === "error"
        ? { status: "error", message: detail.error.message }
        : { status: "ready" };
  const store = detail.data;
  const tone = store
    ? statusToneByEnum("store.qualification_status", store.qualificationStatus)?.admin
    : undefined;
  const canEdit = hasModuleLevel(access, "merchant", "e");

  const confirmSpec: ConfirmSpec | null = store
    ? {
        title: "禁用商家账号",
        description: "禁用后该门店的全部成员无法登录小程序，进行中的工单不受影响。",
        echo: [
          { label: "门店", value: store.name },
          { label: "经营主体", value: store.entityName },
          { label: "联系电话", value: store.phoneMasked, emphasis: true },
        ],
        checkLabel: "我已核对门店与联系电话，确认禁用",
        seenValue: store.phoneTail,
        sensitive: {
          label: "请输入联系电话后 4 位",
          expected: store.phoneTail,
          placeholder: "4 位数字",
        },
        confirmText: "确认禁用",
        danger: true,
      }
    : null;

  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <DetailPage
        title={store?.name ?? "商家详情"}
        subtitle={
          store
            ? `样例页：详情页骨架，数据是夹具。${store.entityName} · ${store.region} · 注册于 ${store.registeredDay}`
            : undefined
        }
        tags={
          store ? (
            <>
              {tone ? (
                <StatusTag size="large" tone={tone.tone}>
                  {tone.label}
                </StatusTag>
              ) : null}
              {store.disabled ? (
                <StatusTag size="large" tone="danger">
                  已禁用
                </StatusTag>
              ) : null}
              <span className="lyx-pill">{store.category}</span>
              <span className="lyx-pill">{store.source === "sales" ? "销售" : "自然流量"}</span>
            </>
          ) : undefined
        }
        actions={
          canEdit && store && !store.disabled ? (
            <Button size="large" danger onClick={() => setConfirming(true)}>
              禁用账号
            </Button>
          ) : undefined
        }
        tabs={[
          {
            key: "profile",
            label: "档案",
            content: store ? (
              <>
                <h2 className="lyx-section-title">基础信息</h2>
                <InfoList
                  labelWidth={84}
                  items={[
                    { label: "门店名称", value: store.name },
                    { label: "行业与品类", value: store.category },
                    { label: "门店地址", value: store.address },
                    { label: "营业时间", value: store.businessHours },
                    { label: "联系电话", value: store.phoneMasked },
                    { label: "人均消费", value: formatMoney(store.avgSpendFen) },
                  ]}
                />
              </>
            ) : null,
          },
          {
            key: "qualification",
            label: "资质",
            content: (
              <>
                <h2 className="lyx-section-title">补传证照</h2>
                <UploadField
                  rule={UPLOAD_RULE}
                  upload={upload}
                  onChange={setLicenseFileId}
                  text="点击上传营业执照"
                />
                {licenseFileId ? (
                  <p className="lyx-upload__hint">已上传，文件编号 {licenseFileId}</p>
                ) : null}
              </>
            ),
          },
          { key: "orders", label: "订单", count: 5, content: <p>订单列表在页面包里做。</p> },
          { key: "follow", label: "跟进记录", disabled: true, content: null },
          {
            key: "logs",
            label: "操作日志",
            content: store ? (
              <InfoList
                labelWidth={110}
                items={store.logs.map((log) => ({
                  label: appDateTimeFormat.dateTime(log.at),
                  value: `${log.actor}：${log.text}`,
                }))}
              />
            ) : null,
          },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => void navigate({ search: { tab: key } })}
        aside={
          store
            ? [
                {
                  key: "plan",
                  title: "套餐与积分",
                  content: (
                    <InfoList
                      labelWidth={84}
                      items={[
                        {
                          label: "当前套餐",
                          value: `${store.planName} · ${store.planExpireDay} 到期`,
                        },
                        {
                          label: "可用积分",
                          value: (
                            <span className="lyx-num">{formatPoints(store.availablePoints)}</span>
                          ),
                        },
                        {
                          label: "累计实付",
                          value: <span className="lyx-num">{formatMoneyFixed(store.paidFen)}</span>,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "manager",
                  title: "交付经理",
                  content: (
                    <InfoList items={[{ label: "负责人", value: store.manager ?? "未分配" }]} />
                  ),
                },
              ]
            : []
        }
        state={state}
        onRetry={() => void detail.refetch()}
      />
      {confirmSpec && store ? (
        <ConfirmAction
          open={confirming}
          action="sample-store-disable"
          spec={confirmSpec}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            showSuccessNotice(`${store.name}：账号已禁用`);
            void queryClient.invalidateQueries({ queryKey: ["samples", "stores"] });
          }}
          onConfirm={async ({ seenValue, idempotencyKey }) => {
            const { error } = await client.POST("/admin/samples/stores/{storeId}/disable", {
              params: { path: { storeId }, header: { "Idempotency-Key": idempotencyKey } },
              body: { lockVersion: store.lockVersion, confirm: { phoneTail: seenValue ?? "" } },
            });
            if (!error) return { outcome: "done" };
            if (error.error === "CONFIRM_MISMATCH") {
              await detail.refetch();
              return { outcome: "mismatch" };
            }
            return { outcome: "failed", message: error.message };
          }}
        />
      ) : null}
    </div>
  );
}
