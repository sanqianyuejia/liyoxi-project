import { View } from "@tarojs/components";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { TextArea } from "@/components/TextArea";

import { Demo } from "../demo";

import "./form.scss";

export default function SheetPreview() {
  // 进来就开着第一种，截图里看得见；另外两种点按钮看
  const [open, setOpen] = useState<"form" | "confirm" | "long" | null>("form");
  const close = () => setOpen(null);
  return (
    <>
      <Demo title="底部弹层：上两角圆角 16，最高为屏高的 90%">
        <Button variant="secondary" size="md" onClick={() => setOpen("form")}>
          提出修改意见（表单）
        </Button>
        <Button variant="secondary" size="md" onClick={() => setOpen("confirm")}>
          移除成员（危险操作的确认）
        </Button>
        <Button variant="secondary" size="md" onClick={() => setOpen("long")}>
          正文比弹层高（内部滚动）
        </Button>
      </Demo>
      <Sheet
        visible={open === "form"}
        title="提出修改意见"
        description="还可以修改 2 次"
        onClose={close}
        footer={<Button onClick={close}>提交修改意见</Button>}
      >
        <View className="lyx-form-demo">
          <Field label="修改重点" required>
            <View className="lyx-form-demo__chips">
              <Chip size="lg" selected>
                文案
              </Chip>
              <Chip size="lg">画面</Chip>
              <Chip size="lg">配音</Chip>
            </View>
          </Field>
          <Field label="修改意见" required>
            <TextArea placeholder="如：价格再放大一些" maxLength={200} />
          </Field>
        </View>
      </Sheet>
      <Sheet
        visible={open === "confirm"}
        title="移除成员"
        description="移除后，王** 不能再查看本店的订单与素材。"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button variant="danger" onClick={close}>
              确认移除
            </Button>
          </>
        }
      />
      <Sheet
        visible={open === "long"}
        title="服务协议"
        onClose={close}
        footer={<Button onClick={close}>我已阅读</Button>}
      >
        {Array.from({ length: 30 }, (_, index) => (
          <View key={index} className="lyx-demo__note">
            第 {index + 1} 条：协议正文示例，正文区在弹层内部滚动，标题与按钮不动。
          </View>
        ))}
      </Sheet>
    </>
  );
}
