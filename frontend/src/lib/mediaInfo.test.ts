import { expect, test } from "vitest";

import type { MediaDetails, MediaItem } from "./api";
import { detailSections, formatBitrate, formatBytes } from "./mediaInfo";

const item = { kind: "video", width: 1920, height: 1080 } as MediaItem;

const details = (patch: Partial<MediaDetails> = {}): MediaDetails => ({
  container: "QuickTime / MOV",
  size_bytes: 1_234_567_890,
  duration_s: 12.5,
  bit_rate: 100_000_000,
  created: "2026-11-09T14:03:22.000000Z",
  video: {
    codec: "h264",
    profile: "High",
    width: 3840,
    height: 2160,
    fps: 29.97,
    fps_variable: false,
    pix_fmt: "yuv420p10le",
    bit_depth: 10,
    color_space: "bt709",
    color_range: "tv",
    color_transfer: null,
    bit_rate: 95_000_000,
  },
  audio: {
    codec: "aac",
    sample_rate: 48000,
    channels: 2,
    channel_layout: "stereo",
    bit_rate: 256_000,
    bit_depth: null,
  },
  ...patch,
});

test("sizes and bit rates read the way people say them", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1_234_567_890)).toBe("1.2 GB");
  expect(formatBytes(45_000_000)).toBe("45.0 MB");
  expect(formatBytes(null)).toBe("–");
  expect(formatBitrate(100_000_000)).toBe("100.0 Mbps");
  expect(formatBitrate(256_000)).toBe("256 kbps");
});

test("the sections cover the file, the video and the audio, with colour depth", () => {
  const sections = detailSections(details(), item, { fps: 29.97 });
  expect(sections.map((s) => s.title)).toEqual(["File", "Video", "Audio"]);
  const rows = (title: string) =>
    Object.fromEntries(
      sections.find((s) => s.title === title)!.rows.map((r) => [r.label, r.value]),
    );
  expect(rows("File").Size).toBe("1.2 GB");
  expect(rows("Video").Resolution).toBe("3840×2160");
  expect(rows("Video").Colour).toBe("10-bit · yuv420p10le · bt709 · tv");
  expect(rows("Video")["Frame rate"]).toBe("29.97 fps");
  expect(rows("Audio")["Sample rate"]).toBe("48 kHz");
  expect(rows("Audio").Channels).toBe("stereo");
});

test("a variable frame rate, or one that differs from the project's, is flagged", () => {
  const warned = (patch: Partial<NonNullable<MediaDetails["video"]>>, projectFps: number) =>
    detailSections(details({ video: { ...details().video!, ...patch } }), item, {
      fps: projectFps,
    })
      .find((s) => s.title === "Video")!
      .rows.find((r) => r.label === "Frame rate")!.warn;
  expect(warned({}, 29.97)).toBeFalsy();
  expect(warned({ fps_variable: true }, 29.97)).toBe(true);
  expect(warned({ fps: 25 }, 29.97)).toBe(true);
});

test("a still has a picture section, and audio-only files have no video section", () => {
  const still = { kind: "image", width: 640, height: 360 } as MediaItem;
  expect(detailSections(details({ video: null, audio: null }), still, null)[1]).toEqual({
    title: "Picture",
    rows: [{ label: "Resolution", value: "640×360" }],
  });
  const wav = detailSections(details({ video: null }), { kind: "audio" } as MediaItem, null);
  expect(wav.map((s) => s.title)).toEqual(["File", "Audio"]);
});
