import { SelectEntry } from "@/components/SelectEntry";

import { Demo } from "../demo";

const noop = () => undefined;

export default function SelectEntryPreview() {
  return (
    <>
      <Demo title="未选与已选：外形同单行输入，右侧 18 的箭头">
        <SelectEntry placeholder="请选择所在城市" onClick={noop} />
        <SelectEntry value="成都" onClick={noop} />
      </Demo>
      <Demo title="出错与禁用">
        <SelectEntry placeholder="请选择行业" error onClick={noop} />
        <SelectEntry value="餐饮 / 火锅" disabled />
      </Demo>
    </>
  );
}
