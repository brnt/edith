import { describe, expect, test } from "vitest";

import type { EditList, MediaItem, SyncState } from "./api";
import { addCuts, addStill, removeCut, setCamera, setTrack } from "./editOps";
import * as history from "./history";
import {
  activeCamera,
  cameraSpans,
  effectiveTracks,
  formatTime,
  frameState,
  keepIntervals,
  mediaOffsets,
  mergeRanges,
  outputToTimeline,
  skipCuts,
  sortMedia,
  timelineToOutput,
} from "./timeline";

const item = (id: string, kind: MediaItem["kind"], duration = 100): MediaItem => ({
  id,
  path: `${id}.x`,
  kind,
  label: id,
  duration_s: kind === "image" ? null : duration,
  width: null,
  height: null,
  fps: null,
  has_audio: kind !== "image",
  proxy_ready: true,
});

const edit = (patch: Partial<EditList> = {}): EditList => ({
  switches: [],
  cuts: [],
  stills: [],
  tracks: [],
  range_in_s: null,
  range_out_s: null,
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
  ...patch,
});

const media = [
  item("camA", "video"),
  item("camB", "video"),
  item("mic", "audio"),
  item("car", "image"),
];
const sync: SyncState = {
  template: null,
  needs_upgrade: false,
  nudges: { camB: 0.5 },
  results: {
    mic: {
      status: "synced",
      start_s: 0,
      drift_ppm: 0,
      tone_start_s: 1,
      tone_end_s: 2,
      score: 1,
      interval_residual_s: 0,
    },
    camA: {
      status: "synced",
      start_s: 5,
      drift_ppm: 0,
      tone_start_s: 1,
      tone_end_s: 2,
      score: 1,
      interval_residual_s: 0,
    },
    camB: {
      status: "unsynced",
      start_s: null,
      drift_ppm: null,
      tone_start_s: null,
      tone_end_s: null,
      score: null,
      interval_residual_s: null,
    },
  },
};

describe("ranges and cuts", () => {
  test("merge and keep intervals", () => {
    expect(
      mergeRanges([
        [5, 6],
        [1, 2],
        [1.5, 3],
        [3, 4],
      ]),
    ).toEqual([
      [1, 4],
      [5, 6],
    ]);
    expect(
      keepIntervals(0, 10, [
        [2, 3],
        [8, 12],
      ]),
    ).toEqual([
      [0, 2],
      [3, 8],
    ]);
    expect(keepIntervals(0, 10, [[0, 10]])).toEqual([]);
  });

  test("output time ripples over cuts and maps back", () => {
    const keeps = keepIntervals(0, 20, [[5, 10]]);
    expect(timelineToOutput(3, keeps)).toBe(3);
    expect(timelineToOutput(12, keeps)).toBe(7);
    expect(timelineToOutput(7, keeps)).toBe(5); // inside a cut: its start
    expect(outputToTimeline(7, keeps)).toBe(12);
    expect(outputToTimeline(99, keeps)).toBe(20);
  });

  test("playback skips a cut and stops after the end", () => {
    const keeps = keepIntervals(0, 20, [[5, 10]]);
    expect(skipCuts(4, keeps)).toBe(4);
    expect(skipCuts(5, keeps)).toBe(10);
    expect(skipCuts(7, keeps)).toBe(10);
    expect(skipCuts(25, keeps)).toBe(20);
  });
});

describe("offsets and frame state", () => {
  test("offsets are the sync start plus the nudge; unsynced falls back to the nudge", () => {
    expect(mediaOffsets(media, sync)).toEqual({ camA: 5, camB: 0.5, mic: 0 });
  });

  test("the default camera is the earliest started; switches override from their time", () => {
    const offsets = mediaOffsets(media, sync);
    expect(activeCamera([], 10, "camB")).toBe("camB");
    const e = edit({ switches: [{ at_s: 20, media_id: "camA" }] });
    expect(frameState(10, e, media, offsets).camera).toBe("camB");
    expect(frameState(25, e, media, offsets).camera).toBe("camA");
  });

  test("local times are null outside a file's footage", () => {
    const state = frameState(3, edit(), media, mediaOffsets(media, sync));
    expect(state.local.camA).toBeNull(); // starts at 5
    expect(state.local.mic).toBe(3);
  });

  test("a still covers its range", () => {
    const e = edit({ stills: [{ id: "s", media_id: "car", start_s: 10, end_s: 12 }] });
    const offsets = mediaOffsets(media, sync);
    expect(frameState(11, e, media, offsets).still?.id).toBe("s");
    expect(frameState(12, e, media, offsets).still).toBeNull();
  });
});

describe("camera spans", () => {
  test("spans follow the switches", () => {
    const switches = [
      { at_s: 10, media_id: "camB" },
      { at_s: 30, media_id: "camA" },
    ];
    expect(cameraSpans(switches, "camA", "camA", 0, 50)).toEqual([
      [0, 10],
      [30, 50],
    ]);
    expect(cameraSpans(switches, "camB", "camA", 0, 50)).toEqual([[10, 30]]);
    expect(cameraSpans([], "camB", "camA", 0, 50)).toEqual([]);
  });
});

describe("edit operations", () => {
  test("setCamera inserts, replaces at the same time, and drops redundant switches", () => {
    let e = setCamera(edit(), 10, "camA");
    e = setCamera(e, 20, "camB");
    e = setCamera(e, 20.01, "camA"); // replaces the 20 s switch
    expect(e.switches).toEqual([{ at_s: 10, media_id: "camA" }]); // camA -> camA is redundant
    expect(setCamera(e, 30, "camB").switches).toHaveLength(2);
  });

  test("cuts merge and remove", () => {
    const e = addCuts(edit({ cuts: [{ start_s: 1, end_s: 3 }] }), [
      { start_s: 2, end_s: 5 },
      { start_s: 8, end_s: 9 },
    ]);
    expect(e.cuts).toEqual([
      { start_s: 1, end_s: 5 },
      { start_s: 8, end_s: 9 },
    ]);
    expect(removeCut(e, 0).cuts).toEqual([{ start_s: 8, end_s: 9 }]);
  });

  test("stills are kept in time order", () => {
    const e = addStill(addStill(edit(), "car", 20, 22, "b"), "car", 5, 6, "a");
    expect(e.stills.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("the first track change writes out the default tracks", () => {
    const two = [...media, item("mic2", "audio")];
    expect(effectiveTracks(edit(), two).map((t) => t.media_id)).toEqual(["mic", "mic2"]);
    const e = setTrack(edit(), two, "mic2", { muted: true, gain_db: -3 });
    expect(e.tracks).toEqual([
      { media_id: "mic", gain_db: 0, muted: false },
      { media_id: "mic2", gain_db: -3, muted: true },
    ]);
  });

  test("with no audio-only files the first camera's audio is used", () => {
    expect(
      effectiveTracks(edit(), [item("camA", "video"), item("camB", "video")]).map(
        (t) => t.media_id,
      ),
    ).toEqual(["camA"]);
  });
});

describe("ordering", () => {
  test("cameras come first, then audio, then stills, by name", () => {
    const list = [
      item("z", "image"),
      item("b", "audio"),
      item("cam2", "video"),
      item("cam1", "video"),
    ];
    expect(sortMedia(list).map((m) => m.id)).toEqual(["cam1", "cam2", "b", "z"]);
  });
});

describe("history and formatting", () => {
  test("undo and redo", () => {
    let h = history.start(1);
    h = history.push(history.push(h, 2), 3);
    h = history.undo(h);
    expect(h.present).toBe(2);
    expect(history.redo(h).present).toBe(3);
    expect(history.push(h, 9).future).toEqual([]);
    expect(history.undo(history.start(1)).present).toBe(1);
  });

  test("formatTime", () => {
    expect(formatTime(75.34)).toBe("1:15.3");
    expect(formatTime(5, 0)).toBe("0:05");
    expect(formatTime(-3)).toBe("0:00.0");
  });
});
