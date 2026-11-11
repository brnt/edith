import type { IconDefinition } from "@ant-design/icons-svg/es/types";

// The Ant Design icons the app uses (outlined theme), named without the "Outlined" suffix.
// Add new ones here so every import of the icon set lives in one place.
export { default as ArrowLeft } from "@ant-design/icons-svg/es/asn/ArrowLeftOutlined";
export { default as ArrowUp } from "@ant-design/icons-svg/es/asn/ArrowUpOutlined";
export { default as AudioMuted } from "@ant-design/icons-svg/es/asn/AudioMutedOutlined";
export { default as CaretDown } from "@ant-design/icons-svg/es/asn/CaretDownOutlined";
export { default as Ellipsis } from "@ant-design/icons-svg/es/asn/EllipsisOutlined";
export { default as CaretRight } from "@ant-design/icons-svg/es/asn/CaretRightOutlined";
export { default as Check } from "@ant-design/icons-svg/es/asn/CheckOutlined";
export { default as CheckCircle } from "@ant-design/icons-svg/es/asn/CheckCircleOutlined";
export { default as Clear } from "@ant-design/icons-svg/es/asn/ClearOutlined";
export { default as Close } from "@ant-design/icons-svg/es/asn/CloseOutlined";
export { default as CloseCircle } from "@ant-design/icons-svg/es/asn/CloseCircleOutlined";
export { default as ColumnWidth } from "@ant-design/icons-svg/es/asn/ColumnWidthOutlined";
export { default as CustomerService } from "@ant-design/icons-svg/es/asn/CustomerServiceOutlined";
export { default as Down } from "@ant-design/icons-svg/es/asn/DownOutlined";
export { default as Download } from "@ant-design/icons-svg/es/asn/DownloadOutlined";
export { default as Export } from "@ant-design/icons-svg/es/asn/ExportOutlined";
export { default as ExclamationCircle } from "@ant-design/icons-svg/es/asn/ExclamationCircleOutlined";
export { default as Stop } from "@ant-design/icons-svg/es/asn/StopOutlined";
export { default as Eye } from "@ant-design/icons-svg/es/asn/EyeOutlined";
export { default as EyeInvisible } from "@ant-design/icons-svg/es/asn/EyeInvisibleOutlined";
export { default as File } from "@ant-design/icons-svg/es/asn/FileOutlined";
export { default as Folder } from "@ant-design/icons-svg/es/asn/FolderOutlined";
export { default as FolderOpen } from "@ant-design/icons-svg/es/asn/FolderOpenOutlined";
export { default as InfoCircle } from "@ant-design/icons-svg/es/asn/InfoCircleOutlined";
export { default as Loading } from "@ant-design/icons-svg/es/asn/LoadingOutlined";
export { default as Pause } from "@ant-design/icons-svg/es/asn/PauseOutlined";
export { default as Picture } from "@ant-design/icons-svg/es/asn/PictureOutlined";
export { default as PlayCircle } from "@ant-design/icons-svg/es/asn/PlayCircleOutlined";
export { default as Plus } from "@ant-design/icons-svg/es/asn/PlusOutlined";
export { default as Save } from "@ant-design/icons-svg/es/asn/SaveOutlined";
export { default as Scissor } from "@ant-design/icons-svg/es/asn/ScissorOutlined";
export { default as Search } from "@ant-design/icons-svg/es/asn/SearchOutlined";
export { default as Sound } from "@ant-design/icons-svg/es/asn/SoundOutlined";
export { default as StepBackward } from "@ant-design/icons-svg/es/asn/StepBackwardOutlined";
export { default as Sync } from "@ant-design/icons-svg/es/asn/SyncOutlined";
export { default as Thunderbolt } from "@ant-design/icons-svg/es/asn/ThunderboltOutlined";
export { default as VideoCamera } from "@ant-design/icons-svg/es/asn/VideoCameraOutlined";
export { default as Warning } from "@ant-design/icons-svg/es/asn/WarningOutlined";
export { default as ZoomIn } from "@ant-design/icons-svg/es/asn/ZoomInOutlined";
export { default as ZoomOut } from "@ant-design/icons-svg/es/asn/ZoomOutOutlined";

// Icons Ant doesn't have, in the same IconDefinition shape (so <Icon> draws them).
// Undo and Redo are "ImUndo" / "ImRedo" from IcoMoon Free (https://icomoon.io, CC BY 4.0), picked
// because Ant's undo/redo arrows are hard to read at button size.
const glyph = (name: string, d: string): IconDefinition => ({
  name,
  theme: "outlined",
  icon: {
    tag: "svg",
    attrs: { viewBox: "0 0 16 16", focusable: "false" },
    children: [{ tag: "path", attrs: { d } }],
  },
});
export const Undo = glyph(
  "undo",
  "M8 1c-2.209 0-4.209 0.896-5.657 2.343l-2.343-2.343v6h6l-2.243-2.243c1.086-1.086 2.586-1.757 4.243-1.757 3.314 0 6 2.686 6 6 0 1.792-0.786 3.401-2.032 4.5l1.323 1.5c1.661-1.466 2.709-3.611 2.709-6 0-4.418-3.582-8-8-8z",
);
export const Redo = glyph(
  "redo",
  "M0 9c0 2.389 1.048 4.534 2.709 6l1.323-1.5c-1.246-1.099-2.031-2.708-2.031-4.5 0-3.314 2.686-6 6-6 1.657 0 3.157 0.672 4.243 1.757l-2.243 2.243h6v-6l-2.343 2.343c-1.448-1.448-3.448-2.343-5.657-2.343-4.418 0-8 3.582-8 8z",
);
