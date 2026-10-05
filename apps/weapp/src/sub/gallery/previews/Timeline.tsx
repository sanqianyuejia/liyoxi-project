import { Timeline } from "@/components/Timeline";

import { Demo } from "../demo";

export default function TimelinePreview() {
  return (
    <>
      <Demo title="进度时间轴：完成是对勾，当前是内点，未到是空环">
        <Timeline
          items={[
            {
              title: "提交资料",
              description: "已提交门店信息与证照",
              time: "09-26 14:02",
              state: "done",
            },
            { title: "平台审核", description: "预计 1 个工作日内完成", state: "current" },
            { title: "审核通过", description: "通过后即可订购短剧", state: "todo" },
          ]}
        />
      </Demo>
      <Demo title="全部完成">
        <Timeline
          items={[
            { title: "已下单", time: "09-20 10:12", state: "done" },
            { title: "样片已确认", time: "09-24 16:40", state: "done" },
            { title: "已上线", time: "09-28 09:00", state: "done" },
          ]}
        />
      </Demo>
      <Demo title="记录时间轴：最新一条按状态取色，历史记录是灰点">
        <Timeline
          variant="record"
          latestTone="success"
          items={[
            { title: "已核验", description: "抖音 · 云间火锅春熙路店", time: "09-28 10:12" },
            { title: "提交上线链接", time: "09-27 18:30" },
            { title: "成片已交付", time: "09-26 11:05" },
          ]}
        />
      </Demo>
      <Demo title="记录时间轴：最新一条出错">
        <Timeline
          variant="record"
          latestTone="danger"
          items={[
            { title: "核验未通过", description: "链接打不开，请重新提交", time: "今天 09:12" },
            { title: "提交上线链接", time: "09-27 18:30" },
          ]}
        />
      </Demo>
    </>
  );
}
