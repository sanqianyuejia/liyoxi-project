// 陈列页的三组：按钮、表单控件、弹层与反馈（规范 第 5.3 节；第 8 节）。
// 控件都是 Ant Design 的，样子由主题（theme/antd.ts）与全局样式（theme/global.css）套好，这里只摆出来，不另写样式。
import { formatMoneyFixed } from "@liyoxi/shared/format/money";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Select,
  Switch,
} from "antd";
import { useState } from "react";

import { showApiNotice, showSuccessNotice } from "../../app/feedback";
import { ConfirmAction, type ConfirmSpec } from "../../components/ConfirmAction";
import { InfoList } from "../../components/InfoList";
import { UploadField } from "../../components/UploadField";
import type { UploadFn, UploadRule } from "../../lib/upload";
import { DEV_FIXTURE_MARK } from "../mark";

import { Demo, Remark } from "./parts";

const AMOUNT = formatMoneyFixed(300000);
const REFUND = formatMoneyFixed(128050);

const SIZES = [
  { size: "middle", label: "高 36：页头与筛选条" },
  { size: "large", label: "高 40：弹窗底部与详情操作" },
  { size: "small", label: "高 32：表格行内" },
] as const;

export function ButtonsBody() {
  return (
    <>
      {SIZES.map(({ size, label }) => (
        <Demo key={size} title={label} row>
          <Button size={size} type="primary">
            提交审核
          </Button>
          <Button size={size}>取消</Button>
          <Button size={size} type="primary" danger>
            确认驳回
          </Button>
          <Button size={size} danger>
            驳回
          </Button>
          <Button size={size} type="link">
            重置筛选
          </Button>
        </Demo>
      ))}
      <Demo title="禁用：主按钮是灰底深字；原因写在按钮行左侧" row>
        <Button type="primary" disabled>
          审核通过
        </Button>
        <Button disabled>取消</Button>
        <Button danger disabled>
          驳回
        </Button>
        <Button type="link" disabled>
          重置筛选
        </Button>
      </Demo>
      <Demo title="提交中：按钮内显示加载图标，不可重复点击" row>
        <Button type="primary" loading>
          提交审核
        </Button>
        <Button loading>保存</Button>
        <Button size="large" type="primary" danger loading>
          确认驳回
        </Button>
      </Demo>
      <Demo title="文字链：主色字，悬停只加下划线；危险操作是红字" row>
        <a className="lyx-link" href="/dev/table">
          查看详情
        </a>
        <button type="button" className="lyx-link lyx-link--danger">
          移除
        </button>
      </Demo>
    </>
  );
}

const UPLOAD_RULE: UploadRule = { accept: ["image/png", "image/jpeg", ".pdf"], maxSizeMb: 10 };

/** 夹具上传：不碰网络。文件名里带“失败”的第一次传不上去，重试成功 */
function createFixtureUpload(): UploadFn {
  const failedOnce = new Set<string>();
  return async (file, { onProgress }) => {
    for (const percent of [30, 60, 90]) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      onProgress(percent);
    }
    if (file.name.includes("失败") && !failedOnce.has(file.name)) {
      failedOnce.add(file.name);
      throw new Error("上传失败：网络中断，请重试");
    }
    return { fileId: `${DEV_FIXTURE_MARK}-${file.name}` };
  };
}

type Scope = "all" | "pending" | "confirmed";

export function FormsBody() {
  const [upload] = useState(createFixtureUpload);
  const [scope, setScope] = useState<Scope>("all");

  return (
    <>
      <Demo title="字段：标签在上；选填在标签后写“（选填）”；出错时描边变红、下方红字">
        <Form layout="vertical" className="lyx-showcase-form" aria-label="示例表单">
          <div className="lyx-showcase-form__grid">
            <Form.Item label="主体名称">
              <Input placeholder="营业执照上的名称" />
            </Form.Item>
            <Form.Item label="主体类型">
              <Select
                placeholder="请选择"
                options={[
                  { value: "company", label: "企业" },
                  { value: "individual", label: "个体工商户" },
                ]}
              />
            </Form.Item>
            <Form.Item label="联系电话" validateStatus="error" help="请填写联系电话">
              <Input placeholder="11 位手机号" />
            </Form.Item>
            <Form.Item label="所在区域" validateStatus="error" help="请选择所在区域">
              <Select placeholder="请选择" options={[{ value: "chenghua", label: "成华区" }]} />
            </Form.Item>
            <Form.Item label="调整数量">
              <InputNumber placeholder="如：1000" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="统计日期">
              <DatePicker.RangePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="已填的值">
              <Input defaultValue="成都晴天洗涤服务有限公司" />
            </Form.Item>
            <Form.Item label="禁用的输入框与下拉">
              <div className="lyx-showcase-inline">
                <Input disabled defaultValue="不可修改" />
                <Select disabled placeholder="请选择" style={{ width: 160 }} />
              </div>
            </Form.Item>
          </div>
          <Form.Item label="备注（选填）" extra="只有运营看得到，商家看不到。">
            <Input.TextArea rows={3} placeholder="需要交接的情况写在这里" />
          </Form.Item>
        </Form>
        <Remark>
          有字数上限的字段在标签行右侧显示计数（规范 第 5.3、8
          节）还没有做，交第一个有表单的后台页面包；只读值、原因单选、单选卡、月份切换还没有构件（见下面“需要自己写的组件”）。整张表单的样子看{" "}
          <a className="lyx-link" href="/dev/form">
            表单样例页
          </a>
          。
        </Remark>
      </Demo>
      <Demo title="复选框、单选框 16 × 16，选中为主色" row>
        <Checkbox defaultChecked>已核对</Checkbox>
        <Checkbox>未勾选</Checkbox>
        <Checkbox disabled>禁用</Checkbox>
        <Radio.Group
          defaultValue="a"
          options={[
            { value: "a", label: "选中" },
            { value: "b", label: "未选" },
            { value: "c", label: "禁用", disabled: true },
          ]}
        />
      </Demo>
      <Demo title="开关 36 × 20，开是绿色；分段控件选中项是白底" row>
        <Switch defaultChecked aria-label="开启的开关" />
        <Switch aria-label="关闭的开关" />
        <Switch disabled aria-label="禁用的开关" />
        <Segmented<Scope>
          aria-label="示例分段控件"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "全部" },
            { value: "pending", label: "待确认" },
            { value: "confirmed", label: "已确认" },
          ]}
        />
      </Demo>
      <Demo title="上传区：通栏、高 64、虚线框。选一个文件名里带“失败”的文件可以看失败与重试">
        <div className="lyx-showcase-upload">
          <UploadField rule={UPLOAD_RULE} upload={upload} onChange={() => {}} />
        </div>
      </Demo>
    </>
  );
}

const CONFIRM: ConfirmSpec = {
  title: "确认收款",
  description: "确认后订购单进入“待开工”，并通知商家。",
  echo: [
    { label: "付款方", value: "成都晴天洗涤服务有限公司" },
    { label: "订购单号", value: "LYX2026100500001" },
    { label: "金额", value: AMOUNT, emphasis: true },
  ],
  checkLabel: "我已核对付款方与金额",
  confirmText: "确认收款",
};

const CONFIRM_DANGER: ConfirmSpec = {
  title: "执行退款",
  description: "退款原路退回，执行后不可撤销。",
  echo: [
    { label: "退款单号", value: "TK2026100500003" },
    { label: "退款金额", value: REFUND, emphasis: true },
  ],
  checkLabel: "我已核对退款金额与收款账户",
  seenValue: "1280.50",
  sensitive: { label: "请输入退款金额", expected: "1280.50", placeholder: "如：1280.50" },
  confirmText: "确认退款",
  danger: true,
};

type Opened = "modal" | "confirm" | "confirm-danger" | "drawer" | null;

export function OverlaysBody() {
  const [opened, setOpened] = useState<Opened>(null);
  const close = (): void => setOpened(null);

  return (
    <>
      <Demo title="弹窗、二次确认、抽屉：点开看" row>
        <Button onClick={() => setOpened("modal")}>打开弹窗</Button>
        <Button onClick={() => setOpened("confirm")}>打开二次确认</Button>
        <Button onClick={() => setOpened("confirm-danger")}>打开敏感确认（危险实心）</Button>
        <Button onClick={() => setOpened("drawer")}>打开抽屉</Button>
      </Demo>
      <Demo
        title="轻提示：右上角，深色底。成功带对勾、4 秒后消失；失败是红色感叹号、不自动消失"
        row
      >
        <Button onClick={() => showSuccessNotice("收款已确认，已通知商家")}>成功的提示</Button>
        <Button
          onClick={() =>
            showApiNotice({
              symbol: "INTERNAL_ERROR",
              message: "没有保存成功，请稍后重试",
              requestIdTail: "8f3a1c2e",
            })
          }
        >
          失败的提示
        </Button>
      </Demo>
      <Demo title="提示条：四种色调，圆角 8、无描边、默认无图标">
        <Alert type="success" title="已通过审核，商家可以开始选剧。" />
        <Alert type="info" title="样片制作中，预计 3 个工作日内交付。" />
        <Alert type="warning" title="还有 2 条链接待核验，请在今天 24:00 前处理。" />
        <Alert type="error" title="已驳回：证照模糊，无法识别统一社会信用代码。" />
        <Remark>
          规范里的“中性款”提示条（底 bg-subtle、字 text-secondary）Ant Design
          没有对应的类型，还没有做；带说明的那一种不要用（W0-28 偏差第 26 条）。
        </Remark>
      </Demo>

      <Modal open={opened === "modal"} title="分配服务经理" footer={null} onCancel={close}>
        <div className="lyx-confirm">
          <p className="lyx-confirm__desc">分配后由服务经理跟进这家商家的交付与续费。</p>
          <Form layout="vertical" aria-label="分配服务经理">
            <Form.Item label="服务经理" style={{ marginBottom: 0 }}>
              <Select
                placeholder="请选择"
                options={[
                  { value: "wang", label: "王磊" },
                  { value: "li", label: "李娜" },
                ]}
              />
            </Form.Item>
          </Form>
          <div className="lyx-confirm__footer">
            <Button size="large" onClick={close}>
              取消
            </Button>
            <Button size="large" type="primary" onClick={close}>
              确认分配
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmAction
        open={opened === "confirm"}
        spec={CONFIRM}
        action="showcase-confirm"
        onConfirm={() => Promise.resolve({ outcome: "done" })}
        onDone={() => {
          close();
          showSuccessNotice("收款已确认，已通知商家");
        }}
        onCancel={close}
      />
      <ConfirmAction
        open={opened === "confirm-danger"}
        spec={CONFIRM_DANGER}
        action="showcase-refund"
        onConfirm={() => Promise.resolve({ outcome: "done" })}
        onDone={() => {
          close();
          showSuccessNotice("退款已执行");
        }}
        onCancel={close}
      />
      <Drawer open={opened === "drawer"} title="付款单详情" onClose={close}>
        <InfoList
          labelWidth={84}
          items={[
            { label: "付款方", value: "成都晴天洗涤服务有限公司" },
            { label: "订购单号", value: "LYX2026100500001" },
            { label: "金额", value: AMOUNT },
            { label: "状态", value: "待确认收款" },
          ]}
        />
      </Drawer>
    </>
  );
}
