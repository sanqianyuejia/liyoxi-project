// 表单的样例页：一张比一屏长的表单（规范 第 5.3 节“表单字段”“输入框、下拉”“多行输入”“错误提示”，第 8 节“表单校验”）。
// 给冒烟核对一件要在浏览器里才量得出的事：滚到页面底部点“保存档案”，有没填的必填项时，页面滚到第一个出错的字段，
// 字段落在内容区中间，上面的标签与下面的错误提示一起看得见（theme/antd.ts 的 adminComponentConfig.form）。
// 也给看样用：标签在上、选填项写“（选填）”、不显示必填星号、出错时控件描边与提示的样子。数据是写在本文件里的夹具，不提交。
import { Alert, Button, Card, Form, Input, Select } from "antd";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";

import { DEV_FIXTURE_MARK } from "./mark";

interface StoreProfile {
  entityName: string;
  creditCode: string;
  entityType: string;
  legalPerson: string;
  registeredAddress?: string;
  storeName: string;
  district?: string;
  address?: string;
  category: string;
  openingHours?: string;
  contactName: string;
  contactPhone?: string;
  email?: string;
  remark?: string;
}

/** 预先填好的一部分：第一个没填的必填项（所在区域）在表单中段，滚到页面底部时它在视野之外 */
const INITIAL: Partial<StoreProfile> = {
  entityName: "成都晴天洗涤服务有限公司",
  creditCode: "91510104MA6C8E2X5K",
  entityType: "company",
  legalPerson: "周晴",
  storeName: "晴天洗衣",
  category: "laundry",
  contactName: "周晴",
};

const ENTITY_TYPES = [
  { value: "company", label: "企业" },
  { value: "individual", label: "个体工商户" },
];

const DISTRICTS = [
  { value: "chenghua", label: "成华区" },
  { value: "jinjiang", label: "锦江区" },
  { value: "wuhou", label: "武侯区" },
];

const CATEGORIES = [
  { value: "laundry", label: "生活服务 / 洗衣" },
  { value: "tea", label: "餐饮 / 茶饮" },
  { value: "store", label: "零售 / 便利店" },
];

const required = (message: string) => [{ required: true, message }];

export function FormSample() {
  const [form] = Form.useForm<StoreProfile>();
  const [passed, setPassed] = useState(false);

  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <PageHeader
        title="商家档案"
        subtitle="样例页：一张比一屏长的表单。滚到底点“保存档案”，页面滚到第一个没填的必填项。数据是夹具，不提交。"
      />
      {passed ? <Alert type="success" title="校验通过。样例页不提交。" /> : null}
      <Form<StoreProfile>
        form={form}
        aria-label="商家档案"
        layout="vertical"
        initialValues={INITIAL}
        onValuesChange={() => setPassed(false)}
        onFinish={() => setPassed(true)}
        // 几张卡片之间是区块间距（规范 第 3 节：16）
        style={{ display: "flex", flexDirection: "column", gap: "var(--lyx-layout-section-gap)" }}
      >
        <Card title="主体信息">
          <div style={{ maxWidth: 480 }}>
            <Form.Item label="主体名称" name="entityName" rules={required("请填写主体名称")}>
              <Input placeholder="营业执照上的名称" />
            </Form.Item>
            <Form.Item
              label="统一社会信用代码"
              name="creditCode"
              rules={required("请填写统一社会信用代码")}
            >
              <Input placeholder="18 位" />
            </Form.Item>
            <Form.Item label="主体类型" name="entityType" rules={required("请选择主体类型")}>
              <Select placeholder="请选择" options={ENTITY_TYPES} />
            </Form.Item>
            <Form.Item label="法定代表人" name="legalPerson" rules={required("请填写法定代表人")}>
              <Input placeholder="真实姓名" />
            </Form.Item>
            <Form.Item label="注册地址（选填）" name="registeredAddress">
              <Input placeholder="营业执照上的住所" />
            </Form.Item>
          </div>
        </Card>
        <Card title="门店信息">
          <div style={{ maxWidth: 480 }}>
            <Form.Item label="门店名称" name="storeName" rules={required("请填写门店名称")}>
              <Input placeholder="对顾客展示的名称" />
            </Form.Item>
            <Form.Item label="所在区域" name="district" rules={required("请选择所在区域")}>
              <Select placeholder="请选择" options={DISTRICTS} />
            </Form.Item>
            <Form.Item label="详细地址" name="address" rules={required("请填写详细地址")}>
              <Input placeholder="街道、门牌号" />
            </Form.Item>
            <Form.Item label="品类" name="category" rules={required("请选择品类")}>
              <Select placeholder="请选择" options={CATEGORIES} />
            </Form.Item>
            <Form.Item label="营业时间（选填）" name="openingHours">
              <Input placeholder="如 09:00–21:00" />
            </Form.Item>
          </div>
        </Card>
        <Card title="联系人">
          <div style={{ maxWidth: 480 }}>
            <Form.Item label="联系人" name="contactName" rules={required("请填写联系人")}>
              <Input placeholder="真实姓名" />
            </Form.Item>
            <Form.Item label="联系电话" name="contactPhone" rules={required("请填写联系电话")}>
              <Input placeholder="11 位手机号" />
            </Form.Item>
            <Form.Item label="邮箱（选填）" name="email">
              <Input placeholder="接收对账单" />
            </Form.Item>
            <Form.Item
              label="备注（选填）"
              name="remark"
              extra="只有运营看得到，商家看不到。"
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea rows={3} placeholder="需要交接的情况写在这里" />
            </Form.Item>
          </div>
        </Card>
        <div className="lyx-action-bar">
          <span className="lyx-action-bar__hint">标签后面写着“（选填）”的可以不填</span>
          <Button
            size="large"
            onClick={() => {
              form.resetFields();
              setPassed(false);
            }}
          >
            恢复原样
          </Button>
          <Button size="large" type="primary" htmlType="submit">
            保存档案
          </Button>
        </div>
      </Form>
    </div>
  );
}
