import { AddButton } from "@/components/AddButton";

import { Demo } from "../demo";

export default function AddButtonPreview() {
  return (
    <>
      <Demo title="缺省：高 48，虚线，圆角 14" bare>
        <AddButton>绑定新账号</AddButton>
        <AddButton>添加主推服务</AddButton>
      </Demo>
      <Demo title="换图标" bare>
        <AddButton icon="upload">选择文件</AddButton>
      </Demo>
      <Demo title="禁用" bare>
        <AddButton disabled>最多绑定 5 个账号</AddButton>
      </Demo>
    </>
  );
}
