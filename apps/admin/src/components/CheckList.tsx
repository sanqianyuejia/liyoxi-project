// 核对清单：勾选后变绿底绿边，复选框为绿色（规范 第 5.2、5.5 节）。清单项来自数据字典，由页面传进来。
import { Checkbox, ConfigProvider } from "antd";

import { checkListTheme } from "../theme/antd";

export interface CheckListItem {
  key: string;
  label: string;
}

export interface CheckListProps {
  items: readonly CheckListItem[];
  checked: readonly string[];
  onChange: (checked: string[]) => void;
  /** 只读的质检清单：只展示结果 */
  readOnly?: boolean;
}

export function CheckList({ items, checked, onChange, readOnly }: CheckListProps) {
  return (
    <ConfigProvider theme={checkListTheme}>
      <ul className="lyx-checklist">
        {items.map((item) => {
          const isChecked = checked.includes(item.key);
          return (
            <li key={item.key} className="lyx-checklist__item" data-checked={isChecked}>
              <Checkbox
                checked={isChecked}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...checked, item.key]
                      : checked.filter((key) => key !== item.key),
                  )
                }
              >
                {item.label}
              </Checkbox>
            </li>
          );
        })}
      </ul>
    </ConfigProvider>
  );
}
