// 预览的登记：组件名 → 预览。键必须与 src/gallery.ts 的 GALLERY_ITEMS 一一对应，多了少了类型检查都过不去。
import type { ComponentType } from "react";

import type { GalleryName } from "@/gallery";

import AddButton from "./AddButton";
import Badge from "./Badge";
import Button from "./Button";
import Card from "./Card";
import DescList from "./DescList";
import Icon from "./Icon";
import IconButton from "./IconButton";
import InfoTag from "./InfoTag";
import List from "./List";
import NavBar from "./NavBar";
import PillButton from "./PillButton";
import Section from "./Section";
import StatusTag from "./StatusTag";
import TextButton from "./TextButton";

export const PREVIEWS: Record<GalleryName, ComponentType> = {
  Icon,
  NavBar,
  Button,
  PillButton,
  TextButton,
  IconButton,
  AddButton,
  StatusTag,
  InfoTag,
  Badge,
  Card,
  Section,
  List,
  DescList,
};
