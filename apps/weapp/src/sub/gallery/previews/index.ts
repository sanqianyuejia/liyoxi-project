// 预览的登记：组件名 → 预览。键必须与 src/gallery.ts 的 GALLERY_ITEMS 一一对应，多了少了类型检查都过不去。
import type { ComponentType } from "react";

import type { GalleryName } from "@/gallery";

import Button from "./Button";
import Icon from "./Icon";
import NavBar from "./NavBar";

export const PREVIEWS: Record<GalleryName, ComponentType> = {
  Icon,
  NavBar,
  Button,
};
