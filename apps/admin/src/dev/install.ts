// 开发与测试构建的入口：换上夹具的权限数据来源。生产构建不会走到这里（main.tsx）。
import type { AppServices } from "../app/services";

import { fixtureAccessSource } from "./fixture-access";

export function installDevFixtures(services: AppServices): void {
  services.setAccessSource(fixtureAccessSource());
}
