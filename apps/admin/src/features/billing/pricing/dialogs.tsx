import { Alert, Checkbox, DatePicker, Input, InputNumber, Radio, Select } from "antd";
import { useState } from "react";
import { FormField } from "../../../components/FormField";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import { ContentDialog } from "../../drama/edit/form";
import { createContentIntent, pointsText } from "../../drama/edit/model";
import type { PricingApi, PriceRow, PriceRevision } from "./api";
import { priceBody, PRICE_REASONS, tomorrowBeijing } from "./model";
export function PriceDialog({
  api,
  row,
  onClose,
  onSaved,
}: {
  api: PricingApi;
  row: PriceRow;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() => createContentIntent("drama-price"));
  const [mode, setMode] = useState<"template" | "custom">("custom");
  const [points, setPoints] = useState<number | null>(row.listPricePoints);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [reason, setReason] = useState("quality");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ContentDialog
      title={`调整积分价 · ${row.title}`}
      intent={intent}
      onClose={onClose}
      submitText="确认提交调价"
      disabled={!confirmed || (scheduled && !date)}
      submit={async () => {
        const body = priceBody(row, {
          mode,
          points,
          effectiveDate: scheduled ? date : null,
          reason,
          note,
        });
        if (
          await intent.submit(body, (key, signal) => api.create(row.dramaId, body, key, signal))
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <ReadOnlyValue
        label="本次确认的当前价 P / 模板价 T"
        value={`${pointsText(row.listPricePoints)} / ${pointsText(row.templatePoints)}`}
        reason="提交时确认当前积分价；资料变化时服务端拒绝，保留本草稿重新核对。"
      />
      <FormField label="定价模式">
        {(field) => (
          <Radio.Group
            {...field}
            value={mode}
            onChange={(e) => setMode(e.target.value === "template" ? "template" : "custom")}
          >
            <Radio value="custom">单剧价</Radio>
            <Radio value="template" disabled={row.templatePoints === null}>
              恢复模板价
            </Radio>
          </Radio.Group>
        )}
      </FormField>
      {mode === "custom" ? (
        <FormField label="新积分价（整数，至少100）">
          {(field) => (
            <InputNumber {...field} value={points} min={100} precision={0} onChange={setPoints} />
          )}
        </FormField>
      ) : (
        <Alert
          type="info"
          title={`按生效时模板执行；当前模板价为 ${pointsText(row.templatePoints)}。`}
        />
      )}
      <FormField label="生效时间">
        {(field) => (
          <Radio.Group
            {...field}
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value === true)}
          >
            <Radio value={false}>立即生效</Radio>
            <Radio value={true}>指定日期 00:00（北京时间）</Radio>
          </Radio.Group>
        )}
      </FormField>
      {scheduled ? (
        <FormField label="生效日期">
          {(field) => (
            <DatePicker
              {...field}
              format="YYYY-MM-DD"
              disabledDate={(value) => value.format("YYYY-MM-DD") < tomorrowBeijing()}
              onChange={(value) => setDate(value?.format("YYYY-MM-DD") ?? null)}
            />
          )}
        </FormField>
      ) : null}
      {mode === "custom" ? (
        <FormField label="调价原因">
          {(field) => (
            <Select
              {...field}
              value={reason}
              options={PRICE_REASONS.filter((v) => v.value !== "restore_template")}
              onChange={setReason}
            />
          )}
        </FormField>
      ) : (
        <ReadOnlyValue label="原因" value="恢复模板价" />
      )}
      <FormField label="备注" value={note} maxLength={200}>
        {(field) => (
          <Input.TextArea
            {...field}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </FormField>
      <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
        已核对当前积分价 {pointsText(row.listPricePoints)}，确认此次调整
      </Checkbox>
      <p>已有订单不回算；套餐实扣只展示服务端返回结果。</p>
    </ContentDialog>
  );
}
export function WithdrawPriceDialog({
  api,
  revision,
  onClose,
  onSaved,
}: {
  api: PricingApi;
  revision: PriceRevision;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() => createContentIntent("price-withdraw"));
  const [note, setNote] = useState("");
  return (
    <ContentDialog
      title="撤销待生效调价"
      intent={intent}
      onClose={onClose}
      submitText="确认撤销"
      submit={async () => {
        if (
          await intent.submit({ id: revision.dramaPriceRevisionId, note }, (key, signal) =>
            api.withdraw(revision.dramaPriceRevisionId, note || null, key, signal),
          )
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <ReadOnlyValue
        label="待撤销调价"
        value={`${revision.dramaTitle} · ${pointsText(revision.newPoints)} · ${revision.effectiveAt}`}
      />
      <FormField label="撤销备注" value={note} maxLength={200}>
        {(field) => (
          <Input.TextArea
            {...field}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </FormField>
      <p>已经生效或撤销的记录不能再次撤销。</p>
    </ContentDialog>
  );
}
