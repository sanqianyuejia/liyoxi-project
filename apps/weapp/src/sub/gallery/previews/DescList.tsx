import { Card } from "@/components/Card";
import { DescList } from "@/components/DescList";
import { PillButton } from "@/components/PillButton";

import { Demo } from "../demo";

export default function DescListPreview() {
  return (
    <>
      <Demo title="键宽 64（缺省）" bare>
        <Card title="订单信息">
          <DescList
            items={[
              { label: "订单号", value: "LYX2026092800012" },
              { label: "下单时间", value: "09-28 10:12" },
              { label: "订购内容", value: "《巷口那家店》整部 80 集，含广告植入 1 条" },
              { label: "消耗积分", value: "180 积分" },
            ]}
          />
        </Card>
      </Demo>
      <Demo title="键较长时键宽 96；值可以放组件" bare>
        <Card title="开票信息">
          <DescList
            labelWidth="lg"
            items={[
              { label: "发票抬头", value: "成都云间餐饮管理有限公司" },
              { label: "纳税人识别号", value: "91510104MA6B****2R" },
              { label: "接收邮箱", value: <PillButton icon="copy">复制</PillButton> },
            ]}
          />
        </Card>
      </Demo>
    </>
  );
}
