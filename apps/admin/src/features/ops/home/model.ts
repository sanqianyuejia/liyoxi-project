import { HomeRecommendConfigSchema, MallConfigSchema, type SiteConfigView } from "@liyoxi/contract";
import { newIdempotencyKey } from "../../../lib/idempotency";
import {
  fieldErrors,
  siteError,
  versionConflict,
  type ConfigKey,
  type DraftBody,
  type SiteApi,
} from "./api";

export type SiteContent = DraftBody["content"];
const page = (value: unknown) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 1;
export function homeSearch(raw: Record<string, unknown>) {
  return {
    bannerState: ["current", "all", "live", "scheduled", "ended", "disabled"].includes(
      String(raw.bannerState),
    )
      ? String(raw.bannerState)
      : "current",
    bannerPage: page(raw.bannerPage),
    bannerPageSize: [10, 20, 50].includes(Number(raw.bannerPageSize))
      ? Number(raw.bannerPageSize)
      : 20,
    historyPage: page(raw.historyPage),
  };
}
export function mallSearch(raw: Record<string, unknown>) {
  return { historyPage: page(raw.historyPage) };
}
export function createSiteIntent(action: string) {
  let previous: { fingerprint: string; key: string } | undefined;
  return {
    key(body: unknown) {
      const fingerprint = JSON.stringify(body);
      if (previous?.fingerprint !== fingerprint)
        previous = { fingerprint, key: newIdempotencyKey(action) };
      return previous.key;
    },
    done() {
      previous = undefined;
    },
  };
}
export function validateContent(kind: ConfigKey, content: SiteContent): Record<string, string> {
  const parsed = (kind === "mall" ? MallConfigSchema : HomeRecommendConfigSchema).safeParse(
    content,
  );
  return parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}
export function moveId(ids: readonly string[], source: string, target: string) {
  const from = ids.indexOf(source),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const result = [...ids];
  result.splice(from, 1);
  result.splice(to, 0, source);
  return result;
}
export interface SiteState {
  view?: SiteConfigView;
  content?: SiteContent;
  note: string;
  pending: boolean;
  dirty: boolean;
  saved: boolean;
  conflict: boolean;
  message?: string;
  errors: Record<string, string>;
}
/** 两页私有状态：版本属于编辑快照，读取当前值不能给旧草稿换锁。 */
export function createSiteModel(api: Pick<SiteApi, "get" | "save" | "publish">, kind: ConfigKey) {
  let state: SiteState = {
    note: "",
    pending: false,
    dirty: false,
    saved: false,
    conflict: false,
    errors: {},
  };
  const listeners = new Set<() => void>(),
    controller = new AbortController();
  const saving = createSiteIntent("site-draft"),
    publishing = createSiteIntent("site-publish");
  let disposed = false,
    active = true,
    loadedContent = "",
    loadedNote = "",
    savedContent = "",
    publishBaseRevNo: number | undefined;
  function set(patch: Partial<SiteState>) {
    if (disposed || !active) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function accept(view: SiteConfigView, message?: string, baseRevNo?: number) {
    const content = view.draft?.content ?? view.published.content;
    loadedContent = JSON.stringify(content);
    loadedNote = view.draft?.note ?? "";
    savedContent = view.draft ? JSON.stringify({ content, note: loadedNote }) : "";
    publishBaseRevNo = baseRevNo ?? view.draft?.baseRevNo ?? view.published.revNo;
    set({
      view,
      content,
      note: view.draft?.note ?? "",
      saved: Boolean(view.draft),
      dirty: false,
      conflict: false,
      errors: {},
      message,
    });
  }
  async function publishCurrent() {
    const view = state.view;
    if (!view?.draft) throw new Error("请先保存草稿");
    const body = {
      lockVersion: view.draft.lockVersion,
      baseRevNo: publishBaseRevNo ?? view.published.revNo,
    };
    const result = await api.publish(kind, body, publishing.key(body), controller.signal);
    if (disposed || !active) return;
    publishing.done();
    saving.done();
    accept(result, `已发布版本 ${result.published.revNo}`);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      if (state.pending || disposed || !active) return;
      set({ pending: true, message: undefined });
      try {
        accept(await api.get(kind, controller.signal));
      } catch (error) {
        set({ message: siteError(error) });
      } finally {
        set({ pending: false });
      }
    },
    edit(content: SiteContent) {
      if (state.pending || disposed || !active) return;
      set({
        content,
        dirty: JSON.stringify(content) !== loadedContent || state.note !== loadedNote,
        saved: JSON.stringify({ content, note: state.note }) === savedContent,
        errors: {},
        message: undefined,
      });
    },
    note(note: string) {
      if (!state.pending)
        set({
          note,
          dirty: JSON.stringify(state.content) !== loadedContent || note !== loadedNote,
          saved: JSON.stringify({ content: state.content, note }) === savedContent,
          message: undefined,
        });
    },
    restore(content: SiteContent, revNo: number) {
      if (!state.pending)
        set({
          content: structuredClone(content),
          note: `从版本 ${revNo} 复制`,
          dirty: true,
          saved: false,
          errors: {},
          message: "历史内容已复制到编辑区，核对后保存并发布新版本",
        });
    },
    async submit(publish = true) {
      if (state.pending || state.conflict || !state.view || !state.content || disposed || !active)
        return;
      const errors = validateContent(kind, state.content);
      if (Object.keys(errors).length) {
        set({ errors, message: "请修正标记字段后再保存" });
        return;
      }
      set({ pending: true, message: undefined, errors: {} });
      let draftSaved = false;
      try {
        const body: DraftBody = {
          content: state.content,
          note: state.note || undefined,
          baseRevNo: state.view.published.revNo,
          lockVersion: state.view.draft?.lockVersion ?? null,
        };
        const view = await api.save(kind, body, saving.key(body), controller.signal);
        if (disposed || !active) return;
        saving.done();
        publishing.done();
        accept(view, "草稿已保存，尚未发布", body.baseRevNo);
        draftSaved = true;
        if (publish) await publishCurrent();
      } catch (error) {
        set({
          errors: fieldErrors(error),
          conflict: versionConflict(error),
          message: `${draftSaved ? "草稿已保存，发布未成功。" : ""}${versionConflict(error) ? "版本已变化，编辑内容已保留，请重新读取并核对后操作。" : siteError(error)}`,
        });
      } finally {
        set({ pending: false });
      }
    },
    async retryPublish() {
      if (state.pending || state.conflict || !state.saved || disposed || !active) return;
      set({ pending: true, errors: {}, message: undefined });
      try {
        await publishCurrent();
      } catch (error) {
        set({
          errors: fieldErrors(error),
          conflict: versionConflict(error),
          message: `草稿已保存，发布未成功。${siteError(error)}`,
        });
      } finally {
        set({ pending: false });
      }
    },
    resume() {
      if (!disposed) active = true;
    },
    suspend() {
      active = false;
    },
    dispose() {
      disposed = true;
      active = false;
      controller.abort();
      listeners.clear();
    },
  };
}
