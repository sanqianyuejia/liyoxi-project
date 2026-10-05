import { ICON_NAMES } from "@liyoxi/shared/design/icons";
import { View } from "@tarojs/components";

import { Icon } from "@/components/Icon";

import { Demo } from "../demo";

import "./Icon.scss";

export default function IconPreview() {
  return (
    <>
      <Demo title="尺寸：24、22（缺省）、20、18、16、14" row>
        {([24, 22, 20, 18, 16, 14] as const).map((size) => (
          <Icon key={size} name="store" size={size} />
        ))}
      </Demo>
      <Demo title="颜色跟随外层文字色" row>
        <View className="lyx-icon-demo__primary">
          <Icon name="flame" />
        </View>
        <View className="lyx-icon-demo__success">
          <Icon name="check-circle" />
        </View>
        <View className="lyx-icon-demo__danger">
          <Icon name="alert-circle" />
        </View>
        <View className="lyx-icon-demo__muted">
          <Icon name="chevron-right" size={16} />
        </View>
      </Demo>
      <Demo title={`全部图标（${ICON_NAMES.length}）`} row>
        {ICON_NAMES.map((name) => (
          <View key={name} className="lyx-icon-demo__cell">
            <Icon name={name} />
          </View>
        ))}
      </Demo>
    </>
  );
}
