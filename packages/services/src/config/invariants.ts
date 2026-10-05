// config 的五条配置类不变量，各写成一句 SQL 断言（W0-21）：config.N9、N16、N17、N19、N20（14 分组 第 5.4 节）。
// 查询返回违规行（subject_key、detail），0 行即通过。已接入不变量框架：register.ts 拿这里的清单登记（W0-24）。
// 要对照代码的（参数定义、开关登记、系统枚举、清单编码）把清单作 JSON 参数传入。
// “现在”取调用方给的时刻（注入的时钟），SQL 里不写 now()。
import { CHECKLIST_TEMPLATE_CODE, FLAGS, SITE_CONFIG_REVISION_CONFIG_KEY } from "@liyoxi/contract";
import { PARAM_DEFS, paramDef } from "@liyoxi/shared/params";

import type { SqlAssertion } from "../kernel/index.js";

import { SYSTEM_DICT_ITEMS } from "./seed-data.js";

/** Banner 同时生效上限的参数键；库里没有值时取代码默认值 */
const BANNER_CAP_KEY = "home.banner.max_active";

export function configSeedAssertions(now: Date): SqlAssertion[] {
  const bannerCap = paramDef(BANNER_CAP_KEY)?.default;
  if (typeof bannerCap !== "number") {
    throw new Error(`参数 ${BANNER_CAP_KEY} 没有数字默认值`);
  }
  return [
    {
      code: "config.N9",
      title: "每个站点配置键恰有一份已发布的修订；未来任意时刻同时生效的 Banner 不超过上限",
      // 同时生效数只会在“现在”或某张 Banner 的开始时刻变大：逐个时刻数一遍
      sql: `
        WITH cap AS (
          SELECT COALESCE(
            (SELECT (p.value #>> '{}')::int FROM param_value p
              WHERE p.key = '${BANNER_CAP_KEY}' AND p.cancelled_at IS NULL
                AND p.effective_at <= $3::timestamptz
              ORDER BY p.effective_at DESC LIMIT 1),
            $2::int) AS max_active
        ),
        points AS (
          SELECT $3::timestamptz AS at
          UNION
          SELECT b.start_at FROM home_banner b WHERE b.is_enabled AND b.start_at > $3::timestamptz
        ),
        load AS (
          SELECT p.at, count(*) AS active
          FROM points p
          JOIN home_banner b
            ON b.is_enabled AND b.start_at <= p.at AND (b.end_at IS NULL OR b.end_at > p.at)
          GROUP BY p.at
        )
        SELECT k.config_key AS subject_key,
               '已发布的修订有 ' || count(r.id) || ' 份，应恰有 1 份' AS detail
        FROM jsonb_array_elements_text($1::jsonb) AS k(config_key)
        LEFT JOIN site_config_revision r
          ON r.config_key = k.config_key AND r.status = 'published'
        GROUP BY k.config_key
        HAVING count(r.id) <> 1
        UNION ALL
        SELECT 'home_banner@' || to_char(l.at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD"T"HH24:MI'),
               '同时生效 ' || l.active || ' 张，上限 ' || c.max_active || ' 张'
        FROM load l CROSS JOIN cap c
        WHERE l.active > c.max_active
        ORDER BY 1`,
      params: [
        JSON.stringify(SITE_CONFIG_REVISION_CONFIG_KEY.values),
        String(bannerCap),
        now.toISOString(),
      ],
    },
    {
      code: "config.N16",
      title: "系统枚举字典（plan_tier、point_type）的项集合与代码一致",
      sql: `
        WITH expected AS (
          SELECT e->>'t' AS type_key, e->>'c' AS code FROM jsonb_array_elements($1::jsonb) AS e
        ),
        actual AS (
          SELECT i.dict_type_key AS type_key, i.code
          FROM dict_item i JOIN dict_type t ON t.type_key = i.dict_type_key
          WHERE t.is_system
        ),
        diff AS (
          SELECT COALESCE(e.type_key, a.type_key) AS type_key,
                 CASE WHEN a.code IS NULL THEN '缺少项 ' || e.code ELSE '多出项 ' || a.code END
                   AS problem
          FROM expected e
          FULL JOIN actual a ON a.type_key = e.type_key AND a.code = e.code
          WHERE a.code IS NULL OR e.code IS NULL
        )
        SELECT type_key AS subject_key, string_agg(problem, '；' ORDER BY problem) AS detail
        FROM diff GROUP BY type_key ORDER BY 1`,
      params: [
        JSON.stringify(SYSTEM_DICT_ITEMS.map((item) => ({ t: item.dictTypeKey, c: item.code }))),
      ],
    },
    {
      code: "config.N17",
      title: "参数值的键都在代码里定义过",
      sql: `
        SELECT p.key AS subject_key, '参数键没有定义，共 ' || count(*) || ' 行' AS detail
        FROM param_value p
        WHERE p.key NOT IN (SELECT jsonb_array_elements_text($1::jsonb))
        GROUP BY p.key ORDER BY 1`,
      params: [JSON.stringify(PARAM_DEFS.map((def) => def.key))],
    },
    {
      code: "config.N19",
      title: "开关键都在登记表里，值类型与登记一致",
      sql: `
        SELECT f.key AS subject_key,
               CASE WHEN r.key IS NULL THEN '开关键没有登记'
                    ELSE '值类型是 ' || f.value_type || '，登记的是 ' || r.value_type END AS detail
        FROM feature_flag f
        LEFT JOIN (
          SELECT e->>'key' AS key, e->>'valueType' AS value_type
          FROM jsonb_array_elements($1::jsonb) AS e
        ) r ON r.key = f.key
        WHERE r.key IS NULL OR r.value_type <> f.value_type
        ORDER BY 1`,
      params: [JSON.stringify(FLAGS.map(({ key, valueType }) => ({ key, valueType })))],
    },
    {
      code: "config.N20",
      title: "每个清单编码恰有一个启用中的版本",
      sql: `
        SELECT c.code AS subject_key,
               '启用中的版本有 ' || count(t.id) || ' 个，应恰有 1 个' AS detail
        FROM jsonb_array_elements_text($1::jsonb) AS c(code)
        LEFT JOIN checklist_template t ON t.code = c.code AND t.status = 'active'
        GROUP BY c.code
        HAVING count(t.id) <> 1
        ORDER BY 1`,
      params: [JSON.stringify(CHECKLIST_TEMPLATE_CODE.values)],
    },
  ];
}
