import { Button, Input, Select } from "antd";
import { useState } from "react";
import { DateRangeField, type DateRangeFieldProps } from "../../../components/DateRangeField";
import { FormField } from "../../../components/FormField";
import { categoryOptions, datePreset, type AuditSearch } from "./model";
const fields = [
  ["actorId", "操作人 ID"],
  ["targetType", "对象类型"],
  ["targetId", "对象 ID"],
  ["targetKey", "对象 key"],
  ["entityId", "主体 ID"],
  ["storeId", "门店 ID"],
] as const;
export function AuditFilters({
  search,
  onChange,
}: {
  search: AuditSearch;
  onChange(patch: Record<string, string | undefined>): void;
}) {
  const [q, setQ] = useState(search.q ?? ""),
    [advanced, setAdvanced] = useState(false);
  const [dates, setDates] = useState<{ wire: string; value: DateRangeFieldProps["value"] }>();
  const currentDates = `${search.createdFrom ?? ""}/${search.createdTo ?? ""}`;
  return (
    <form
      className="lyx-card lyx-audit-filters"
      aria-label="审计日志筛选"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ q: q.trim() || undefined });
      }}
    >
      <div className="lyx-audit-filters__row">
        <Input
          type="search"
          aria-label="搜索标题或日志编号"
          placeholder="搜索标题或 RZ 日志编号"
          value={q}
          maxLength={200}
          onChange={(event) => setQ(event.target.value)}
        />
        <Button htmlType="submit">查询</Button>
        <Select
          mode="multiple"
          allowClear
          aria-label="日志类别"
          placeholder="全部类别"
          value={search.category?.split(",") ?? []}
          options={categoryOptions(search.stream ?? "ops")}
          onChange={(value: string[]) =>
            onChange({ category: value.length ? value.join(",") : undefined })
          }
        />
        <Select
          allowClear
          aria-label="操作人类型"
          placeholder="全部操作人"
          value={search.actorType}
          options={[
            { value: "staff", label: "员工" },
            { value: "merchant", label: "商家" },
            { value: "system", label: "系统" },
          ]}
          onChange={(value: string | undefined) =>
            onChange({ actorType: value, actorId: undefined })
          }
        />
        <Button aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
          更多筛选
        </Button>
      </div>
      <div className="lyx-audit-filters__row">
        <span>发生日期</span>
        <DateRangeField
          aria-label="发生日期范围"
          format="YYYY-MM-DD"
          placeholder={[search.createdFrom ?? "开始日期", search.createdTo ?? "结束日期"]}
          value={dates?.wire === currentDates ? dates.value : null}
          onChange={(value, text) => {
            setDates({ value, wire: `${text[0]}/${text[1]}` });
            onChange({ createdFrom: text[0] || undefined, createdTo: text[1] || undefined });
          }}
        />
        <Button onClick={() => onChange(datePreset(7))}>近 7 天</Button>
        <Button onClick={() => onChange(datePreset(30))}>近 30 天</Button>
        <Button onClick={() => onChange(datePreset("all"))}>全部日期</Button>
        <Button
          onClick={() => {
            setQ("");
            setDates(undefined);
            onChange(
              Object.fromEntries(
                [
                  "category",
                  "actorType",
                  ...fields.map(([key]) => key),
                  "createdFrom",
                  "createdTo",
                  "q",
                ].map((key) => [key, undefined]),
              ),
            );
          }}
        >
          重置筛选
        </Button>
      </div>
      <span className="lyx-audit-muted" aria-label="当前有效日期范围">
        {search.createdFrom ?? "不限开始"} 至 {search.createdTo ?? "不限结束"}（北京时间，两端含）
      </span>
      {advanced ? (
        <div className="lyx-audit-filters__advanced">
          {fields.map(([key, label]) => (
            <FormField key={key} label={label}>
              {(props) => (
                <Input
                  {...props}
                  defaultValue={search[key]}
                  key={search[key] ?? ""}
                  onBlur={(event) =>
                    onChange({
                      [key]: event.target.value.trim() || undefined,
                      ...(key === "targetId"
                        ? { targetKey: undefined }
                        : key === "targetKey"
                          ? { targetId: undefined }
                          : {}),
                    })
                  }
                />
              )}
            </FormField>
          ))}
        </div>
      ) : null}
    </form>
  );
}
