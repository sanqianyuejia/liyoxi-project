// staff.I8 写成 SQL 断言（W0-21）：staff_role 恰有契约登记的 8 个角色（03 分组 第 2.1 节）。
// 违规对象用角色键。已登记进不变量框架（register.ts，W0-24）；staff 的其余检查项随 W1-01b。
import { STAFF_ROLE_KEY } from "@liyoxi/contract";

import type { SqlAssertion } from "../kernel/index.js";

export function staffSeedAssertions(): SqlAssertion[] {
  return [
    {
      code: "staff.I8",
      title: "后台角色恰有 8 行",
      sql: `
        SELECT k.key AS subject_key, '缺少这个角色' AS detail
        FROM jsonb_array_elements_text($1::jsonb) AS k(key)
        LEFT JOIN staff_role r ON r.key = k.key
        WHERE r.key IS NULL
        UNION ALL
        SELECT r.key, '多出的角色'
        FROM staff_role r
        WHERE r.key NOT IN (SELECT jsonb_array_elements_text($1::jsonb))
        ORDER BY 1`,
      params: [JSON.stringify(STAFF_ROLE_KEY.values)],
    },
  ];
}
