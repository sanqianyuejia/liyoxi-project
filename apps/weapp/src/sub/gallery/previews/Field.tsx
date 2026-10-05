import { View } from "@tarojs/components";

import { Chip } from "@/components/Chip";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { TextArea } from "@/components/TextArea";

import { Demo } from "../demo";

import "./form.scss";

export default function FieldPreview() {
  return (
    <>
      <Demo title="标签在上、控件在下、说明在最下；字段之间 16">
        <View className="lyx-form-demo">
          <Field label="门店名称" required hint="与营业执照上的名称一致">
            <Input placeholder="请填写门店名称" />
          </Field>
          <Field label="备注" optionalText="选填">
            <TextArea placeholder="如：价格再放大一些" maxLength={200} />
          </Field>
        </View>
      </Demo>
      <Demo title="校验错误：控件描边变红，下方红字（盖住说明）">
        <View className="lyx-form-demo">
          <Field label="联系电话" required hint="用于接收交付通知" error="请填写 11 位手机号">
            <Input value="1380013" error />
          </Field>
          <Field label="宣传重点" required error="请至少选择一项">
            <View className="lyx-form-demo__chips">
              <Chip>新品上市</Chip>
              <Chip>节日促销</Chip>
              <Chip>门店环境</Chip>
            </View>
          </Field>
        </View>
      </Demo>
    </>
  );
}
