import { expect, test } from "vitest";

import type { MediaDetails, MediaItem } from "./api";
import type { SyncState } from "./api";
import {
  detailSections,
  formatBitrate,
  formatBytes,
  formatNotes,
  matchesFilter,
} from "./mediaInfo";

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

test("a still is described by its real image format, with a wrong extension called out", () => {
  const still = { kind: "image", label: "car.jpg", width: 3000, height: 1688 } as MediaItem;
  const avif = details({
    container: "QuickTime / MOV",
    image_format: "AVIF",
    image_extension_matches: false,
    video: {
      ...details().video!,
      codec: "av1",
      pix_fmt: "yuv422p",
      bit_depth: 8,
      width: 3000,
      height: 1688,
    },
    audio: null,
  });
  const sections = detailSections(avif, still, null);
  expect(sections.map((s) => s.title)).toEqual(["File", "Picture"]);
  const file = sections[0].rows;
  expect(file[0]).toEqual({ label: "Format", value: "AVIF", warn: true });
  expect(file.find((r) => r.label === "Name")?.value).toBe(
    ".jpg in the name, but the file is AVIF",
  );
  expect(file.some((r) => /QuickTime/.test(r.value))).toBe(false); // the container is not shown
  expect(sections[1].rows[0]).toEqual({ label: "Resolution", value: "3000×1688" });
  // An honest extension isn't flagged.
  const png = detailSections(
    details({ image_format: "PNG", image_extension_matches: true, video: null, audio: null }),
    { kind: "image", label: "car.png", width: 640, height: 360 } as MediaItem,
    null,
  );
  expect(png[0].rows.find((r) => r.label === "Name")).toBeUndefined();
  expect(png[0].rows[0].warn).toBe(false);
});

test("audio-only files have no video section", () => {
  const wav = detailSections(details({ video: null }), { kind: "audio" } as MediaItem, null);
  expect(wav.map((s) => s.title)).toEqual(["File", "Audio"]);
});

test("a frame rate that differs from the project's, or a portrait picture, gets a note", () => {
  const cam = (patch: Partial<MediaItem>) =>
    ({ kind: "video", fps: 29.97, width: 1920, height: 1080, ...patch }) as MediaItem;
  expect(formatNotes(cam({}), { fps: 29.97 })).toEqual([]);
  expect(formatNotes(cam({ fps: 59.94 }), { fps: 29.97 })).toEqual([
    "59.94 fps, but the project is 29.97 fps",
  ]);
  expect(formatNotes(cam({ width: 1080, height: 1920 }), { fps: 29.97 })).toEqual([
    "Portrait (vertical) picture",
  ]);
  expect(formatNotes({ kind: "audio" } as MediaItem, { fps: 25 })).toEqual([]);
  expect(formatNotes(cam({ kind: "image", fps: null }), { fps: 25 })).toEqual([]);
});

test("the media filter: by kind, new files, and files the sync has not placed", () => {
  const m = (patch: Partial<MediaItem>) =>
    ({ id: "x", kind: "video", included: true, ...patch }) as MediaItem;
  const sync = {
    results: { ok: { status: "synced" }, weak: { status: "low_confidence" } },
  } as unknown as SyncState;
  expect(matchesFilter(m({}), "all", sync)).toBe(true);
  expect(matchesFilter(m({ kind: "audio" }), "video", sync)).toBe(false);
  expect(matchesFilter(m({ kind: "audio" }), "audio", sync)).toBe(true);
  expect(matchesFilter(m({ included: false }), "new", sync)).toBe(true);
  expect(matchesFilter(m({ id: "ok" }), "unsynced", sync)).toBe(false);
  expect(matchesFilter(m({ id: "weak" }), "unsynced", sync)).toBe(true);
  expect(matchesFilter(m({ id: "none" }), "unsynced", sync)).toBe(true);
  expect(matchesFilter(m({ kind: "image" }), "unsynced", sync)).toBe(false); // pictures aren't synced
  expect(matchesFilter(m({ included: false }), "unsynced", sync)).toBe(false); // not in the project
});
