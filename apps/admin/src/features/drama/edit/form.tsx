import { Alert, Button, Modal } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { contentConflict, contentError, contentListingFailures } from "./api";
import type { createContentIntent } from "./model";

export function ContentDialog({
  title,
  children,
  intent,
  submit,
  onClose,
  submitText = "保存",
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  intent: ReturnType<typeof createContentIntent>;
  submit: () => Promise<void>;
  onClose: () => void;
  submitText?: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [listingBlocked, setListingBlocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    intent.activate();
    return () => intent.close();
  }, [intent]);
  async function save() {
    if (pending || intent.pending || disabled || conflict) return;
    setPending(true);
    setError(undefined);
    setListingBlocked(false);
    try {
      await submit();
    } catch (failure) {
      if (!intent.signal.aborted) {
        setError(contentError(failure));
        setListingBlocked(contentListingFailures(failure).length > 0);
        setConflict(contentConflict(failure));
      }
    } finally {
      if (!intent.signal.aborted) setPending(false);
    }
  }
  return (
    <Modal
      open
      title={title}
      width={680}
      footer={null}
      mask={{ closable: !pending }}
      keyboard={!pending}
      closable={!pending}
      onCancel={onClose}
    >
      <div className="content-form">{children}</div>
      {error ? <Alert type="error" title={error} /> : null}
      {listingBlocked ? (
        <p role="status">
          本次修改未保存，表单内容已保留。已上架短剧须先补齐上述资料；如需暂存修改，请先下架再编辑。
        </p>
      ) : null}
      {conflict ? (
        <Alert
          type="warning"
          title="当前资料已经变化。草稿保留；请另存核对后关闭并重新打开，不能直接用新版本覆盖。"
        />
      ) : null}
      <div className="lyx-confirm__footer">
        <Button size="large" disabled={pending} onClick={onClose}>
          取消
        </Button>
        <Button
          size="large"
          type="primary"
          loading={pending}
          disabled={disabled || conflict}
          onClick={() => void save()}
        >
          {submitText}
        </Button>
      </div>
    </Modal>
  );
}
