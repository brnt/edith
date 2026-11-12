import type { IconDefinition } from "@ant-design/icons-svg/es/types";

// The Ant Design icons the app uses (outlined theme), named without the "Outlined" suffix.
// Add new ones here so every import of the icon set lives in one place.
export { default as ArrowLeft } from "@ant-design/icons-svg/es/asn/ArrowLeftOutlined";
export { default as ArrowUp } from "@ant-design/icons-svg/es/asn/ArrowUpOutlined";
export { default as CaretDown } from "@ant-design/icons-svg/es/asn/CaretDownOutlined";
export { default as Ellipsis } from "@ant-design/icons-svg/es/asn/EllipsisOutlined";
export { default as CaretRight } from "@ant-design/icons-svg/es/asn/CaretRightOutlined";
export { default as Compress } from "@ant-design/icons-svg/es/asn/CompressOutlined";
export { default as Aim } from "@ant-design/icons-svg/es/asn/AimOutlined";
export { default as Edit } from "@ant-design/icons-svg/es/asn/EditOutlined";
export { default as Check } from "@ant-design/icons-svg/es/asn/CheckOutlined";
export { default as CheckCircle } from "@ant-design/icons-svg/es/asn/CheckCircleOutlined";
export { default as Close } from "@ant-design/icons-svg/es/asn/CloseOutlined";
export { default as CloseCircle } from "@ant-design/icons-svg/es/asn/CloseCircleOutlined";
export { default as ColumnWidth } from "@ant-design/icons-svg/es/asn/ColumnWidthOutlined";
export { default as CustomerService } from "@ant-design/icons-svg/es/asn/CustomerServiceOutlined";
export { default as Down } from "@ant-design/icons-svg/es/asn/DownOutlined";
export { default as Download } from "@ant-design/icons-svg/es/asn/DownloadOutlined";
export { default as Export } from "@ant-design/icons-svg/es/asn/ExportOutlined";
export { default as ExclamationCircle } from "@ant-design/icons-svg/es/asn/ExclamationCircleOutlined";
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
// A filled speaker, left of centre. Sound waves where the muted version has its cross, so the speaker
// itself never shifts between the two.
const SPEAKER = "M1 6h3l4.5-3.5v11L4 10H1z";
export const Speaker = glyph(
  "speaker",
  `${SPEAKER}M10.94 6.3A3.4 3.4 0 0 1 10.94 9.7L11.98 10.3A4.6 4.6 0 0 0 11.98 5.7zM13.2 5.0A6 6 0 0 1 13.2 11.0L14.24 11.6A7.2 7.2 0 0 0 14.24 4.4z`,
);
export const SpeakerMuted = glyph(
  "speaker-muted",
  `${SPEAKER}M10.5 6.5l1-1L13 7l1.5-1.5 1 1L14 8l1.5 1.5-1 1L13 9l-1.5 1.5-1-1L12 8z`,
);

// Application and format icons. Premiere, `{}` (JSON) and the EDL list are from Tabler Icons
// (https://tabler.io/icons, MIT, Copyright (c) 2020-2026 Paweł Kuna): outline icons on a 24 grid,
// stroked. DaVinci Resolve is from Simple Icons (https://simpleicons.org, CC0), a filled logo.
// The logos belong to their owners; they are used only to name the program a file is for.
const outline = (name: string, ds: string[]): IconDefinition => ({
  name,
  theme: "outlined",
  icon: {
    tag: "svg",
    attrs: { viewBox: "0 0 24 24", focusable: "false" },
    children: ds.map((d) => ({
      tag: "path",
      attrs: {
        d,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    })),
  },
});
export const Premiere = outline("premiere", [
  "M3 12c0 -4.243 0 -6.364 1.318 -7.682s3.44 -1.318 7.682 -1.318s6.364 0 7.682 1.318s1.318 3.44 1.318 7.682s0 6.364 -1.318 7.682s-3.44 1.318 -7.682 1.318s-6.364 0 -7.682 -1.318s-1.318 -3.44 -1.318 -7.682",
  "M7.263 15.79v-3.79m0 0v-3.248c0 -.335 .222 -.541 .542 -.541h1.353a1.895 1.895 0 1 1 0 3.789l-1.895 0",
  "M13.895 10.579v1.895m0 0v3.315m0 -3.315c.531 -.709 1.026 -1.592 1.894 -1.832q .22 -.062 .474 -.063",
]);
export const Braces = outline("braces", [
  "M7 4a2 2 0 0 0 -2 2v3a2 3 0 0 1 -2 3a2 3 0 0 1 2 3v3a2 2 0 0 0 2 2",
  "M17 4a2 2 0 0 1 2 2v3a2 3 0 0 0 2 3a2 3 0 0 0 -2 3v3a2 2 0 0 1 -2 2",
]);
export const ListNumbers = outline("list-numbers", [
  "M11 6h9",
  "M11 12h9",
  "M12 18h8",
  "M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4",
  "M6 10v-6l-2 2",
]);
export const Resolve: IconDefinition = {
  name: "resolve",
  theme: "filled",
  icon: {
    tag: "svg",
    attrs: { viewBox: "0 0 24 24", focusable: "false" },
    children: [
      {
        tag: "path",
        attrs: {
          d: "M17.621 0 5.977.004c-1.37 0-2.756.345-3.762 1.11a4.925 4.925 0 0 0-1.61 2.003C.233 3.93 0 5.02 0 5.951l.012 12.2c.002 1.604.479 3.057 1.461 4.112.984 1.056 2.462 1.683 4.331 1.691L16.856 24c1.26.005 3.095-.036 4.303-.714 1.075-.605 2.025-1.556 2.497-2.984.278-.84.345-2.084.344-3.147l-.021-11.13c-.002-.888-.15-2.023-.547-2.934-.425-.976-1.181-1.815-2.322-2.425C20.353.26 19.123 0 17.622 0zm0 .93c1.378 0 2.538.295 3.04.565.977.523 1.544 1.166 1.889 1.96.315.721.47 1.793.473 2.572l.018 11.13c.002 1.013-.097 2.257-.298 2.86-.396 1.202-1.146 1.946-2.063 2.462-.814.457-2.612.593-3.82.588l-11.05-.044c-1.657-.007-2.832-.534-3.626-1.386-.792-.851-1.212-2.06-1.212-3.485L.999 5.95c0-.829.196-1.827.474-2.437.345-.757.75-1.207 1.365-1.674C3.585 1.27 4.868.97 6.08.97zm-5.66 3.423c-1.976.089-3.204 1.658-3.214 3.29.019 1.443 1.635 3.481 2.884 4.53.12.099.154.109.33.18.062.025.198-.047.327-.135.36-.245.993-.947 1.648-1.738a7.67 7.67 0 0 0 1.031-1.683c.409-.89.261-1.599.235-1.888a3.983 3.983 0 0 0-.99-1.692 3.36 3.36 0 0 0-2.251-.864zm4.172 7.922a10.185 10.185 0 0 0-3.244.61c-.15.058-.26.1-.374.17-.057.036-.11.135-.105.292.017.433.29 1.278.624 2.27.384 1.135 1.066 2.27 1.844 2.74a3.23 3.23 0 0 0 2.53.342c.832-.243 1.595-.868 1.962-1.546.986-1.818.19-3.548-1.121-4.417-.447-.296-1.133-.445-1.89-.46-.074 0-.15-.002-.226-.001zm-8.432.038a6.201 6.201 0 0 0-.752.047c-.596.078-.932.273-1.29.51a3.177 3.177 0 0 0-1.365 1.979c-.075.552-.086 1.053.033 1.507.433 1.389 1.326 2.222 2.847 2.452.636.028 1.37-.063 1.99-.45 1.269-.782 2.08-3.17 2.412-4.742.053-.176.035-.357-.013-.42-.005-.067-.044-.113-.19-.183-.398-.192-1.32-.417-2.375-.6a7.68 7.68 0 0 0-1.297-.1z",
        },
      },
    ],
  },
};
