import { Button } from "@/components/Button";

import { Demo } from "../demo";

export default function ButtonPreview() {
  return (
    <>
      <Demo title="四种变体（大，46）" row>
        <Button>提交审核</Button>
        <Button variant="secondary">取消</Button>
        <Button variant="outline">加入选剧单</Button>
        <Button variant="danger">移除成员</Button>
      </Demo>
      <Demo title="四档尺寸：特大 48、大 46、中 40、小 32" row>
        <Button size="xl">手机号快捷登录</Button>
        <Button size="lg">确认订购</Button>
        <Button size="md">去选剧</Button>
        <Button size="sm">去上线</Button>
      </Demo>
      <Demo title="禁用：文字就是原因" row>
        <Button disabled>第 2 版制作中</Button>
        <Button variant="secondary" disabled>
          取消
        </Button>
        <Button size="sm" disabled>
          去上线
        </Button>
      </Demo>
      <Demo title="提交中：加载图标，文字不变" row>
        <Button loading>提交审核</Button>
        <Button variant="secondary" loading>
          保存
        </Button>
        <Button variant="outline" size="md" loading>
          重新加载
        </Button>
      </Demo>
      <Demo title="带图标；占满一行">
        <Button icon="plus" variant="outline" size="md">
          加入选剧单
        </Button>
        <Button block>确认订购</Button>
        <Button block variant="secondary">
          查看订单
        </Button>
      </Demo>
    </>
  );
}
