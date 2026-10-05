// 状态色调字典的类型（规范 第 6 节）。字典只写色调名，不写色值；色值在样式变量里，与色调同名。

/** 六种色调。前五种两端共用，与类名修饰符同名（规范 第 4.1 节）；purple 只在后台用（规范 第 1.4 节） */
export const TONES = ["success", "info", "warning", "danger", "neutral", "purple"] as const;
export type Tone = (typeof TONES)[number];

export type Side = "merchant" | "admin";

/** 某一端怎么显示：什么色调、叫什么（两端对同一状态的叫法可以不同，规范 第 6.3 节） */
export interface ToneSide {
  readonly tone: Tone;
  readonly label: string;
}

export interface StatusToneEntry {
  /** 状态名，同一业务对象内不重复 */
  readonly state: string;
  /** 出自规范 第 6.2 节的哪一行（那一行里的状态名）；null = 表里没有，依据写在 note */
  readonly row: string | null;
  /** 数据模型的“表.列”（各分组文档 第 3 节）；null = 无枚举对应 */
  readonly column: string | null;
  /** 该列的取值；无枚举对应时为空 */
  readonly values: readonly string[];
  /** 无枚举对应时写推导来源；有对应时可以补一句说明；契约还没有绑定这一列的枚举时以 UNBOUND_ENUM_NOTE 开头 */
  readonly note?: string;
  /** 商家端；null = 这一端不出现 */
  readonly merchant: ToneSide | null;
  /** 后台；null = 这一端不出现 */
  readonly admin: ToneSide | null;
}

/**
 * 库里确有这一列、契约还没有绑定枚举的条目，说明以这句开头并写明出处（W0-30a）。
 * “键与契约枚举同名”的检查（pnpm status-tone:check）见到它只列出、不核对取值；契约补上枚举之后检查会要求把它去掉。
 */
export const UNBOUND_ENUM_NOTE = "契约未绑定枚举：";

export interface StatusToneGroup {
  /** 分组键，与文件名相同 */
  readonly key: string;
  /** 规范 第 6.2 节的业务对象名，原样 */
  readonly object: string;
  readonly entries: readonly StatusToneEntry[];
}

/** 一端的写法：只写色调（叫法同状态名）；[色调, 这一端的叫法]；null = 这一端不出现 */
export type SideInput = Tone | readonly [Tone, string] | null;

const toSide = (state: string, input: SideInput): ToneSide | null => {
  if (input === null) return null;
  return typeof input === "string"
    ? { tone: input, label: state }
    : { tone: input[0], label: input[1] };
};

/** 补充项。row 不写时等于状态名；写 null 表示规范 第 6.2 节的表里没有这一条 */
export interface EntryExtra {
  readonly note?: string;
  readonly row?: string | null;
}

/** 有枚举对应的条目 */
export function entry(
  state: string,
  column: string,
  values: readonly string[],
  merchant: SideInput,
  admin: SideInput,
  extra: EntryExtra = {},
): StatusToneEntry {
  const base = {
    state,
    row: extra.row === undefined ? state : extra.row,
    column,
    values,
    merchant: toSide(state, merchant),
    admin: toSide(state, admin),
  };
  return extra.note === undefined ? base : { ...base, note: extra.note };
}

/** 无枚举对应的条目：由多列推导的展示状态，或分类标签。必须写推导来源 */
export function derived(
  state: string,
  merchant: SideInput,
  admin: SideInput,
  note: string,
): StatusToneEntry {
  return {
    state,
    row: state,
    column: null,
    values: [],
    note,
    merchant: toSide(state, merchant),
    admin: toSide(state, admin),
  };
}
