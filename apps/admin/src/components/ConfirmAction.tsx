// 二次确认（D7 第 5.3 节 ConfirmAction、第 5.7 节；规范 第 5.3 节“二次确认弹窗”；约定 C48、C54）。
//   普通确认：回显关键信息 → 勾选确认 → 确认按钮才可点。
//   敏感确认：另要再输入一次关键值（金额或单号后 4 位），并把操作人看到的关键值随请求交给服务端做回显校验；
//             服务端发现与库中当前值不一致返回 CONFIRM_MISMATCH，这里提示并让操作人刷新后重新确认。
//   财务执行类的“再验证”由请求层统一处理（STEP_UP_REQUIRED，lib/api.ts），本构件不管。
// 弹层打开时生成一个幂等键，这次打开里的重试都用它；提交完成前弹层不可关闭。
import { Alert, Button, Checkbox, ConfigProvider, Input, Modal } from "antd";
import { useState } from "react";

import { newIdempotencyKey } from "../lib/idempotency";
import { checkListTheme } from "../theme/antd";

export interface ConfirmEchoItem {
  label: string;
  value: string;
  /** 关键金额：16px / 700 */
  emphasis?: boolean;
}

export interface ConfirmSensitive {
  /** 输入框的标签，如“请输入退款金额” */
  label: string;
  /** 操作人要照着输入的关键值 */
  expected: string;
  placeholder?: string;
}

export interface ConfirmSpec {
  title: string;
  description?: string;
  /** 回显的关键信息 */
  echo: readonly ConfirmEchoItem[];
  /** 勾选确认的文案，如“我已核对退款金额与收款账户” */
  checkLabel: string;
  /** 操作人看到的关键值：随请求提交，服务端回显校验（约定 C54）。普通确认可以不给 */
  seenValue?: string;
  /** 给了就是敏感确认 */
  sensitive?: ConfirmSensitive;
  confirmText?: string;
  /** 确认按钮用危险实心（驳回、禁用、下架） */
  danger?: boolean;
}

export interface ConfirmSubmit {
  /** 操作人看到的关键值；没给时为 null */
  seenValue: string | null;
  idempotencyKey: string;
}

/** 提交函数的结果：mismatch 即服务端返回 CONFIRM_MISMATCH */
export type ConfirmResult =
  { outcome: "done" } | { outcome: "mismatch" } | { outcome: "failed"; message: string };

export interface ConfirmInput {
  checked: boolean;
  typed: string;
}

/** 能不能点确认：必须勾选；敏感确认另要输入的值与关键值一致（首尾空白不计） */
export function confirmReady(spec: Pick<ConfirmSpec, "sensitive">, input: ConfirmInput): boolean {
  if (!input.checked) return false;
  if (!spec.sensitive) return true;
  return input.typed.trim() === spec.sensitive.expected;
}

/**
 * 提交一次确认：没准备好不调提交函数；准备好了把操作人看到的关键值与幂等键交给它。
 * 抽成纯函数是为了单测能直接断言“交给提交函数的是什么”。
 */
export async function submitConfirm(
  spec: Pick<ConfirmSpec, "sensitive" | "seenValue">,
  input: ConfirmInput,
  idempotencyKey: string,
  onConfirm: (submit: ConfirmSubmit) => Promise<ConfirmResult>,
): Promise<ConfirmResult | { outcome: "not-ready" }> {
  if (!confirmReady(spec, input)) return { outcome: "not-ready" };
  try {
    return await onConfirm({ seenValue: spec.seenValue ?? null, idempotencyKey });
  } catch {
    return { outcome: "failed", message: "没有提交成功，请重试" };
  }
}

export interface ConfirmPanelProps {
  spec: ConfirmSpec;
  input: ConfirmInput;
  onInputChange: (next: ConfirmInput) => void;
  submitting: boolean;
  /** 上一次提交的结果里要显示的提示 */
  notice?: { tone: "error" | "warning"; message: string };
  onCancel: () => void;
  onConfirm: () => void;
}

/** 弹层里的内容。单独导出：单测直接渲染它，页面一般用下面的 ConfirmAction */
export function ConfirmPanel({
  spec,
  input,
  onInputChange,
  submitting,
  notice,
  onCancel,
  onConfirm,
}: ConfirmPanelProps) {
  const ready = confirmReady(spec, input);
  return (
    <div className="lyx-confirm">
      {spec.description ? <p className="lyx-confirm__desc">{spec.description}</p> : null}
      <dl className="lyx-confirm__echo">
        {spec.echo.map((item) => (
          <div key={item.label} style={{ display: "contents" }}>
            <dt>{item.label}</dt>
            <dd className={item.emphasis ? "lyx-confirm__key-value" : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {spec.sensitive ? (
        <label>
          <span className="lyx-confirm__field-label">{spec.sensitive.label}</span>
          <Input
            value={input.typed}
            placeholder={spec.sensitive.placeholder}
            disabled={submitting}
            autoComplete="off"
            onChange={(event) => onInputChange({ ...input, typed: event.target.value })}
          />
        </label>
      ) : null}
      <ConfigProvider theme={checkListTheme}>
        <div className="lyx-confirm__check" data-checked={input.checked}>
          <Checkbox
            checked={input.checked}
            disabled={submitting}
            onChange={(event) => onInputChange({ ...input, checked: event.target.checked })}
          >
            {spec.checkLabel}
          </Checkbox>
        </div>
      </ConfigProvider>
      {notice ? <Alert type={notice.tone} title={notice.message} /> : null}
      <div className="lyx-confirm__footer">
        <Button size="large" onClick={onCancel} disabled={submitting}>
          取消
        </Button>
        <Button
          size="large"
          type="primary"
          danger={spec.danger}
          disabled={!ready}
          loading={submitting}
          onClick={onConfirm}
        >
          {spec.confirmText ?? "确认"}
        </Button>
      </div>
    </div>
  );
}

export interface ConfirmActionProps {
  open: boolean;
  spec: ConfirmSpec;
  /** 幂等键里的动作名，如 refund-execute */
  action: string;
  /** 页面在这里发请求；CONFIRM_MISMATCH 时返回 mismatch，并自行刷新详情（让 spec 换成最新值） */
  onConfirm: (submit: ConfirmSubmit) => Promise<ConfirmResult>;
  /** 处理成功后调（关闭弹层、提示结果由页面做） */
  onDone: () => void;
  onCancel: () => void;
}

const MISMATCH_NOTICE = "确认信息与当前内容不一致：内容已刷新，请核对后重新确认";

function ConfirmBody({
  spec,
  action,
  onConfirm,
  onDone,
  onCancel,
  onBusyChange,
}: Omit<ConfirmActionProps, "open"> & { onBusyChange: (busy: boolean) => void }) {
  const [input, setInput] = useState<ConfirmInput>({ checked: false, typed: "" });
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey(action));
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ConfirmPanelProps["notice"]>();

  const confirm = async () => {
    setSubmitting(true);
    onBusyChange(true);
    setNotice(undefined);
    const result = await submitConfirm(spec, input, idempotencyKey, onConfirm);
    setSubmitting(false);
    onBusyChange(false);
    if (result.outcome === "done") onDone();
    else if (result.outcome === "mismatch") {
      // 回显变了：让操作人重新勾选、重新输入；内容变了必须换键（约定 C48）
      setInput({ checked: false, typed: "" });
      setIdempotencyKey(newIdempotencyKey(action));
      setNotice({ tone: "warning", message: MISMATCH_NOTICE });
    } else if (result.outcome === "failed") setNotice({ tone: "error", message: result.message });
  };

  return (
    <ConfirmPanel
      spec={spec}
      input={input}
      onInputChange={setInput}
      submitting={submitting}
      notice={notice}
      onCancel={onCancel}
      onConfirm={() => void confirm()}
    />
  );
}

/** 二次确认弹层。内容每次打开重建：勾选、输入与幂等键都不带到下一次 */
export function ConfirmAction({
  open,
  spec,
  action,
  onConfirm,
  onDone,
  onCancel,
}: ConfirmActionProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      title={spec.title}
      footer={null}
      destroyOnHidden
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      onCancel={onCancel}
    >
      <ConfirmBody
        spec={spec}
        action={action}
        onConfirm={onConfirm}
        onDone={onDone}
        onCancel={onCancel}
        onBusyChange={setBusy}
      />
    </Modal>
  );
}
