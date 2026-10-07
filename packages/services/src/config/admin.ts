import type { z } from "@liyoxi/contract";
import {
  DictItemCreateBodySchema,
  DictItemUpdateBodySchema,
  ParamReplaceBodySchema,
  FeatureFlagUpdateBodySchema,
  ChecklistTemplateCreateBodySchema,
} from "@liyoxi/contract";
import { invalid, requireConfigActor } from "./admin-context.js";
import type { Tx, TxRunOptions } from "../kernel/index.js";
import { alertsOf } from "../kernel/index.js";
import type { ConfigNamespace } from "./cache.js";
import type { ConfigActor, ConfigAdminDeps } from "./admin-context.js";
import { createAdminDicts } from "./admin-dicts.js";
import { createAdminParams } from "./admin-params.js";
import { createAdminVersions } from "./admin-versions.js";

/** 事务与幂等结果在同一提交边界；缓存和告警只在真实提交后触发。 */
export function createConfigAdmin(deps: ConfigAdminDeps) {
  const dicts = createAdminDicts(deps),
    params = createAdminParams(deps),
    versions = createAdminVersions(deps);
  async function write<T>(
    namespace: ConfigNamespace,
    fn: (tx: Tx) => Promise<T>,
    options: TxRunOptions = {},
    flagKey?: string,
  ): Promise<T> {
    let changed = false;
    const result = await deps.tx.run(async (tx) => {
      const data = await fn(tx);
      changed = true;
      return data;
    }, options);
    if (changed) {
      await deps.config.cache.bump(namespace);
      if (flagKey)
        await alertsOf(deps.assembly).raise({
          rule: "config.flag_changed",
          dimension: flagKey,
          severity: "P3",
          detail: { flagKey },
        });
    }
    return result;
  }
  function checked<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const result = schema.safeParse(input);
    if (!result.success)
      return invalid(
        result.error.issues[0]?.path.join(".") ?? "body",
        result.error.issues[0]?.message ?? "结构不符",
      );
    return result.data;
  }
  function authorize<T>(
    ctx: ConfigActor,
    permission: Parameters<typeof requireConfigActor>[1],
    namespace: ConfigNamespace,
    fn: (tx: Tx) => Promise<T>,
    options?: TxRunOptions,
    flagKey?: string,
  ): Promise<T> {
    requireConfigActor(ctx, permission);
    return write(namespace, fn, options, flagKey);
  }
  return {
    dictTypes: () => deps.tx.run(dicts.types),
    dictReferences: (items: readonly { typeKey: string; code: string }[]) =>
      deps.tx.run((tx) => dicts.withReferences(tx, items)),
    createDictItem: (
      ctx: ConfigActor,
      input: Parameters<typeof dicts.create>[2],
      options?: TxRunOptions,
    ) =>
      authorize(
        ctx,
        "sys.dict.edit",
        "dict",
        (tx) => dicts.create(tx, ctx, checked(DictItemCreateBodySchema, input)),
        options,
      ),
    updateDictItem: (
      ctx: ConfigActor,
      id: string,
      input: Parameters<typeof dicts.update>[3],
      options?: TxRunOptions,
    ) =>
      authorize(
        ctx,
        "sys.dict.edit",
        "dict",
        (tx) => dicts.update(tx, ctx, id, checked(DictItemUpdateBodySchema, input)),
        options,
      ),
    params: (query: Parameters<typeof params.list>[1] = {}) =>
      deps.tx.run((tx) => params.list(tx, query)),
    replaceParams: (
      ctx: ConfigActor,
      input: Parameters<typeof params.replace>[2],
      options?: TxRunOptions,
    ) =>
      authorize(
        ctx,
        "sys.param.edit",
        "param",
        (tx) => params.replace(tx, ctx, checked(ParamReplaceBodySchema, input)),
        options,
      ),
    withdrawParam: (ctx: ConfigActor, id: string, reason?: string, options?: TxRunOptions) =>
      authorize(
        ctx,
        "sys.param.edit",
        "param",
        (tx) => params.withdraw(tx, ctx, id, reason),
        options,
      ),
    flags: () => deps.tx.run(versions.flags),
    updateFlag: (
      ctx: ConfigActor,
      key: string,
      input: Parameters<typeof versions.updateFlag>[3],
      options?: TxRunOptions,
    ) =>
      authorize(
        ctx,
        "sys.super_admin",
        "flag",
        (tx) => versions.updateFlag(tx, ctx, key, checked(FeatureFlagUpdateBodySchema, input)),
        options,
        key,
      ),
    createChecklist: (
      ctx: ConfigActor,
      input: Parameters<typeof versions.createChecklist>[2],
      options?: TxRunOptions,
    ) =>
      authorize(
        ctx,
        "flow.checklist.manage",
        "checklist",
        (tx) =>
          versions.createChecklist(tx, ctx, checked(ChecklistTemplateCreateBodySchema, input)),
        options,
      ),
    activateChecklist: (ctx: ConfigActor, id: string, options?: TxRunOptions) =>
      authorize(
        ctx,
        "flow.checklist.manage",
        "checklist",
        (tx) => versions.changeChecklist(tx, ctx, id, true),
        options,
      ),
    discardChecklist: (ctx: ConfigActor, id: string, options?: TxRunOptions) =>
      authorize(
        ctx,
        "flow.checklist.manage",
        "checklist",
        (tx) => versions.changeChecklist(tx, ctx, id, false),
        options,
      ),
    checklistView: versions.checklistView,
  };
}
export type ConfigAdmin = ReturnType<typeof createConfigAdmin>;
export type { ConfigActor, ConfigAdminDeps } from "./admin-context.js";
