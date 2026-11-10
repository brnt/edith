// One palette for the things the output can show, used by the ribbon buttons, the timeline row
// chips, and the spans on the timeline, so a channel's color means the same thing everywhere.
// Calm cool tones on purpose: red marks cuts and amber the playhead, so neither is reused here.
export const CHANNEL_STYLE = {
  video: {
    chip: "bg-sky-700 text-white hover:bg-sky-600",
    span: "bg-sky-500/80",
  },
  image: {
    chip: "bg-teal-700 text-white hover:bg-teal-600",
    span: "bg-teal-500/80",
  },
} as const;

export const channelStyle = (kind: "video" | "image") => CHANNEL_STYLE[kind];
