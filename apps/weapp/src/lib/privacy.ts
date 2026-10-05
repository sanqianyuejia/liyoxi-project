// 隐私授权封装（D7 第 4.14 节）。借参考工程 privacy.ts 的写法。
// app.json 开着 __usePrivacyCheck__：调任何隐私接口（手机号、选照片或视频、摄像头、麦克风、存相册、剪切板、
// 聊天文件、地图选点）之前先走这里。用户在隐私保护指引的弹窗上点了“不同意”时，返回可识别的结果，不抛错。
// 基础库低于 2.32.3 没有这两个接口，直接放行。

export interface PrivacyDeps {
  /** wx.getPrivacySetting；老基础库没有时不给 */
  getPrivacySetting?: () => Promise<{ needAuthorization: boolean }>;
  /** wx.requirePrivacyAuthorize：弹隐私保护指引；用户不同意时拒绝 */
  requirePrivacyAuthorize?: () => Promise<unknown>;
}

/** declined：用户在隐私保护指引上点了不同意。下次点按会重新弹，不要引导去设置页 */
export type PrivacyResult<T = void> = { ok: true; value: T } | { ok: false; reason: "declined" };

export function createPrivacy(deps: PrivacyDeps) {
  /** 隐私指引同意了没有。同意过（或不需要、或基础库不支持）为 true */
  async function ensurePrivacyAuthorized(): Promise<boolean> {
    if (!deps.getPrivacySetting || !deps.requirePrivacyAuthorize) return true;
    let needAuthorization: boolean;
    try {
      needAuthorization = (await deps.getPrivacySetting()).needAuthorization;
    } catch {
      // 查不到设置就放行：真要授权，隐私接口自己会报错，由调用处处理
      return true;
    }
    if (!needAuthorization) return true;
    try {
      await deps.requirePrivacyAuthorize();
      return true;
    } catch {
      return false;
    }
  }

  /** 先过隐私授权，再调隐私接口。没同意时不调 call */
  async function withPrivacy<T>(call: () => Promise<T> | T): Promise<PrivacyResult<T>> {
    if (!(await ensurePrivacyAuthorized())) return { ok: false, reason: "declined" };
    return { ok: true, value: await call() };
  }

  return { ensurePrivacyAuthorized, withPrivacy };
}
