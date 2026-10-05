import { View } from "@tarojs/components";

import { merchantStatusByEnum, StatusTag } from "@/components/StatusTag";

import { Demo } from "../demo";

const ORDER_VALUES = ["pending_start", "producing", "to_launch", "live", "after_sale", "ended"];

export default function StatusTagPreview() {
  return (
    <>
      <Demo title="五种色调" row>
        <StatusTag tone="success">已认证</StatusTag>
        <StatusTag tone="info">制作中</StatusTag>
        <StatusTag tone="warning">待确认</StatusTag>
        <StatusTag tone="danger">核验未通过</StatusTag>
        <StatusTag tone="neutral">已结束</StatusTag>
      </Demo>
      <Demo title="纯文字状态：列表卡片右上角" row>
        <StatusTag tone="success" plain>
          上线中
        </StatusTag>
        <StatusTag tone="info" plain>
          制作中
        </StatusTag>
        <StatusTag tone="warning" plain>
          待上线
        </StatusTag>
        <StatusTag tone="danger" plain>
          已过期
        </StatusTag>
        <StatusTag tone="neutral" plain>
          已取消
        </StatusTag>
      </Demo>
      <Demo title="由状态取色表得出：订购单的状态" row>
        {ORDER_VALUES.map((value) => {
          const status = merchantStatusByEnum("drama_order.status", value);
          return status ? (
            <StatusTag key={value} tone={status.tone}>
              {status.label}
            </StatusTag>
          ) : null;
        })}
      </Demo>
      <Demo title="用法">
        <View className="lyx-demo__note">
          颜色不由页面挑：merchantStatusByEnum(“表.列”, 取值) 给出色调与商家端的叫法。
        </View>
      </Demo>
    </>
  );
}
