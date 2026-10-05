// 陈列页里各组共用的两样小东西：一段示例（小标题加一组示例）与一行说明。
import type { ReactNode } from "react";

export interface DemoProps {
  title: string;
  /** 横排并自动换行；缺省纵排 */
  row?: boolean;
  children: ReactNode;
}

export function Demo({ title, row = false, children }: DemoProps) {
  return (
    <div className="lyx-showcase-demo">
      <h3 className="lyx-section-title">{title}</h3>
      <div className={`lyx-showcase-demo__body${row ? " lyx-showcase-demo__body--row" : ""}`}>
        {children}
      </div>
    </div>
  );
}

export function Remark({ children }: { children: ReactNode }) {
  return <p className="lyx-showcase-remark">{children}</p>;
}
