// 预览的登记：组件名 → 预览。键必须与 src/gallery.ts 的 GALLERY_ITEMS 一一对应，多了少了类型检查都过不去。
import type { ComponentType } from "react";

import type { GalleryName } from "@/gallery";

import AddButton from "./AddButton";
import Avatar from "./Avatar";
import Badge from "./Badge";
import Button from "./Button";
import Card from "./Card";
import Checkbox from "./Checkbox";
import Chip from "./Chip";
import Cover from "./Cover";
import DescList from "./DescList";
import Empty from "./Empty";
import Field from "./Field";
import FilterChips from "./FilterChips";
import FooterBar from "./FooterBar";
import Icon from "./Icon";
import IconButton from "./IconButton";
import IconTile from "./IconTile";
import InfoTag from "./InfoTag";
import Input from "./Input";
import List from "./List";
import ListFooter from "./ListFooter";
import LoadError from "./LoadError";
import NavBar from "./NavBar";
import Note from "./Note";
import OptionCard from "./OptionCard";
import PageBody from "./PageBody";
import PillButton from "./PillButton";
import ProgressBar from "./ProgressBar";
import SearchBar from "./SearchBar";
import Section from "./Section";
import Segmented from "./Segmented";
import SelectEntry from "./SelectEntry";
import Sheet from "./Sheet";
import Skeleton from "./Skeleton";
import StatusTag from "./StatusTag";
import StepBar from "./StepBar";
import Switch from "./Switch";
import Tabs from "./Tabs";
import TextArea from "./TextArea";
import TextButton from "./TextButton";
import Timeline from "./Timeline";
import UploadGrid from "./UploadGrid";

export const PREVIEWS: Record<GalleryName, ComponentType> = {
  Icon,
  NavBar,
  PageBody,
  FooterBar,
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
  Field,
  Input,
  TextArea,
  SelectEntry,
  SearchBar,
  Checkbox,
  Switch,
  Chip,
  OptionCard,
  Tabs,
  Segmented,
  FilterChips,
  Note,
  Sheet,
  Empty,
  StepBar,
  Timeline,
  ProgressBar,
  UploadGrid,
  Avatar,
  IconTile,
  Cover,
  Skeleton,
  LoadError,
  ListFooter,
};
