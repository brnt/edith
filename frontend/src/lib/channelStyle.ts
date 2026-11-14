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

/**
 * Audio waveforms are a neutral cool grey, not a hue: green sat right next to the teal stills, and
 * a neutral waveform also lets the amber and red mix bands read clearly on top of it.
 */
export const AUDIO_WAVEFORM = "#a3b0c2";

/**
 * Where the sync found the registration sounds, drawn over a waveform: information, never a
 * control, and rarely what the eye is on. So it is not a hue at all (the timeline's hues all mean
 * something: sky and teal the channels, amber the playhead and levels, red the cuts) but a
 * darker grey than the waveform: the sound reads as dimmed, a span of the track that is not
 * content, clear when looked for and quiet otherwise.
 */
export const REGISTRATION_MARK = "#6b7686";
