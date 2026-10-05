// config 模块的枚举。取值的中文含义见 docs/data-model/ 下 14 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const DICT_TYPE_STRUCTURE = defineEnum(
  "dict_type_structure",
  ["dict_type.structure"],
  ["flat", "tree"],
);

export const DICT_TYPE_DISABLE_POLICY = defineEnum(
  "dict_type_disable_policy",
  ["dict_type.disable_policy"],
  ["free", "block_if_referenced", "never"],
);

export const SITE_CONFIG_REVISION_CONFIG_KEY = defineEnum(
  "site_config_revision_config_key",
  ["site_config_revision.config_key"],
  ["mall", "home_recommend"],
);

export const SITE_CONFIG_REVISION_STATUS = defineEnum(
  "site_config_revision_status",
  ["site_config_revision.status"],
  ["draft", "published", "archived"],
);

export const HOME_BANNER_JUMP_KIND = defineEnum(
  "home_banner_jump_kind",
  ["home_banner.jump_kind"],
  ["drama", "mall", "page", "none"],
);

export const SITE_NOTICE_KIND = defineEnum(
  "site_notice_kind",
  ["site_notice.kind"],
  ["plan_revision", "billing_param", "agreement_version"],
);

export const SITE_NOTICE_STATUS = defineEnum(
  "site_notice_status",
  ["site_notice.status"],
  ["announced", "withdrawn"],
);

export const FEATURE_FLAG_VALUE_TYPE = defineEnum(
  "feature_flag_value_type",
  ["feature_flag.value_type"],
  ["bool", "enum", "json"],
);

export const FEATURE_FLAG_EXPOSED_TO = defineEnum(
  "feature_flag_exposed_to",
  ["feature_flag.exposed_to"],
  ["client", "server"],
);

export const CHECKLIST_TEMPLATE_CODE = defineEnum(
  "checklist_template_code",
  ["checklist_template.code"],
  [
    "qc.sample",
    "qc.episode",
    "qc.package",
    "delivery.precheck",
    "launch.verify",
    "patrol.check",
    "takedown.check",
    "takedown.absence_check",
    "account.verify",
  ],
);

export const CHECKLIST_TEMPLATE_STATUS = defineEnum(
  "checklist_template_status",
  ["checklist_template.status"],
  ["draft", "active", "retired"],
);
