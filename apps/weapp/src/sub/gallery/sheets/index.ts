// 基础样张的登记：样张名 → 预览。键必须与 src/gallery.ts 的 GALLERY_SHEETS 一一对应，多了少了类型检查都过不去。
import type { ComponentType } from "react";

import type { GallerySheetName } from "@/gallery";

import Colors from "./Colors";
import Spacing from "./Spacing";
import StatusTone from "./StatusTone";
import Typography from "./Typography";

export const SHEETS: Record<GallerySheetName, ComponentType> = {
  colors: Colors,
  typography: Typography,
  spacing: Spacing,
  "status-tone": StatusTone,
};
