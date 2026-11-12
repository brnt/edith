import { describe, expect, test } from "vitest";

import type { EditList, MediaItem, SyncState } from "./api";
import {
  addCuts,
  addMix,
  removeCut,
  setAudioIncluded,
  deleteSegment,
  insideCuts,
  moveSelectionEdge,
  overlapsCut,
  uncut,
  moveSegmentEdge,
  renameMedia,
  setAllEnabled,
  setCamera,
  showOver,
  setCut,
  setEnabled,
  setTrack,
} from "./editOps";
import * as history from "./history";
import {
  activeChannel,
  nudgeStep,
  advancePlayhead,
  boundaryPreview,
  groupMedia,
  usedChannelIds,
  stageLayout,
  movedSwitches,
  segments,
  channelsOf,
  effectiveTracks,
  firstKeptMoment,
  fitPxPerSec,
  formatTime,
  frameState,
  keepIntervals,
  mediaOffsets,
  mergeRanges,
  outputToTimeline,
  playbackEnd,
  skipCuts,
  sortMedia,
  timelineToOutput,
  trackGainDb,
  trackIncluded,
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
  proxy_building: false,
  included: true,
  missing: false,
  folder: "",
  size_bytes: null,
});

const edit = (patch: Partial<EditList> = {}): EditList => ({
  switches: [],
  cuts: [],
  tracks: [],
  mix: [],
  disabled: [],
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

describe("where the playhead starts", () => {
  test("the first kept moment: after a leading cut, otherwise the start of the range", () => {
    expect(firstKeptMoment(keepIntervals(0, 60, [[0, 14]]), 0)).toBe(14);
    expect(firstKeptMoment(keepIntervals(0, 60, [[20, 30]]), 0)).toBe(0);
    expect(firstKeptMoment(keepIntervals(5, 60, [[5, 9]]), 5)).toBe(9);
    expect(firstKeptMoment([], 3)).toBe(3); // nothing kept: stay at the start
  });
});

describe("advancing the playhead", () => {
  const keeps = keepIntervals(0, 20, [
    [5, 10],
    [15, 20],
  ]); // keeps 0-5 and 10-15; a trailing cut

  test("moves forward and jumps a cut", () => {
    expect(advancePlayhead(4.9, 0.2, keeps)).toEqual({ t: 10, ended: false });
    expect(advancePlayhead(1, 0.5, keeps)).toEqual({ t: 1.5, ended: false });
  });

  test("ends at the last kept moment, never inside a trailing cut", () => {
    expect(playbackEnd(keeps)).toBe(15);
    expect(advancePlayhead(14.9, 0.2, keeps)).toEqual({ t: 15, ended: true });
    expect(advancePlayhead(15, 0.016, keeps)).toEqual({ t: 15, ended: true });
  });

  test("a trailing cut that reaches the end of the range does not strand the playhead", () => {
    // Regression: the playhead stopped at the cut line while playback carried on.
    const trailing = keepIntervals(0, 57.84, [[52.74, 57.84]]);
    expect(advancePlayhead(52.7, 0.05, trailing).ended).toBe(true);
  });

  test("with nothing kept, playback ends immediately", () => {
    expect(advancePlayhead(0, 0.1, [])).toEqual({ t: 0, ended: true });
  });
});

describe("offsets and frame state", () => {
  test("offsets are the sync start plus the nudge; unsynced falls back to the nudge", () => {
    expect(mediaOffsets(media, sync)).toEqual({ camA: 5, camB: 0.5, mic: 0 });
  });

  test("the default camera is the earliest started; switches override from their time", () => {
    const offsets = mediaOffsets(media, sync);
    expect(activeChannel([], 10, "camB")).toBe("camB");
    const e = edit({ switches: [{ at_s: 20, media_id: "camA" }] });
    expect(frameState(10, e, media, offsets).channel).toBe("camB");
    expect(frameState(25, e, media, offsets).channel).toBe("camA");
  });

  test("local times are null outside a file's footage", () => {
    const state = frameState(3, edit(), media, mediaOffsets(media, sync));
    expect(state.local.camA).toBeNull(); // starts at 5
    expect(state.local.mic).toBe(3);
  });
});

describe("segments", () => {
  test("segments follow the switches, from the opening default camera to the end", () => {
    const switches = [
      { at_s: 30, media_id: "camA" },
      { at_s: 10, media_id: "camB" },
    ]; // unordered on purpose
    expect(segments(switches, "camA", 50)).toEqual([
      { index: -1, channel: "camA", start: 0, end: 10 },
      { index: 0, channel: "camB", start: 10, end: 30 },
      { index: 1, channel: "camA", start: 30, end: 50 },
    ]);
  });

  test("no opening segment when a switch is at 0; a null switch is the default camera", () => {
    expect(segments([{ at_s: 0, media_id: null }], "camA", 20)).toEqual([
      { index: 0, channel: "camA", start: 0, end: 20 },
    ]);
    expect(segments([], "camA", 20)).toEqual([{ index: -1, channel: "camA", start: 0, end: 20 }]);
  });

  test("a moved switch can't pass its neighbours or leave the timeline", () => {
    const switches = [
      { at_s: 10, media_id: "camB" },
      { at_s: 30, media_id: "camA" },
    ];
    expect(movedSwitches(switches, 0, 20, 50)[0].at_s).toBe(20);
    expect(movedSwitches(switches, 0, 99, 50)[0].at_s).toBeCloseTo(29.9);
    expect(movedSwitches(switches, 1, 0, 50)[1].at_s).toBeCloseTo(10.1);
    expect(movedSwitches(switches, 0, -5, 50)[0].at_s).toBe(0);
    expect(movedSwitches(switches, 1, 99, 50)[1].at_s).toBe(50);
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

  test("setCut moves an edge, and a cut dragged over another merges with it", () => {
    const e = edit({
      cuts: [
        { start_s: 5, end_s: 10 },
        { start_s: 20, end_s: 25 },
      ],
    });
    expect(setCut(e, 0, 4, 10).cuts).toEqual([
      { start_s: 4, end_s: 10 },
      { start_s: 20, end_s: 25 },
    ]);
    expect(setCut(e, 0, 5, 22).cuts).toEqual([{ start_s: 5, end_s: 25 }]);
    expect(setCut(e, 1, 12, 25).cuts[1]).toEqual({ start_s: 12, end_s: 25 });
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

describe("fitting the timeline to the window", () => {
  test("the lanes (window minus borders and the label column) span the whole timeline", () => {
    expect(fitPxPerSec(1178, 100)).toBe(10);
    expect(fitPxPerSec(1178, 50)).toBe(20);
  });

  test("falls back to a sane default before the width or length is known", () => {
    expect(fitPxPerSec(0, 100)).toBe(20);
    expect(fitPxPerSec(1178, 0)).toBe(20);
    expect(fitPxPerSec(100, 100)).toBe(20); // narrower than the label column
  });
});

describe("channels: cameras and stills", () => {
  const many = [
    item("z-cam", "video"),
    item("a-cam", "video"),
    item("mic", "audio"),
    ...Array.from({ length: 9 }, (_, i) => item(`still${i}`, "image")),
  ];

  test("cameras are numbered first, then stills, each by name; audio gets no number", () => {
    const channels = channelsOf([
      item("car", "image"),
      item("b-cam", "video"),
      item("mic", "audio"),
      item("a-cam", "video"),
    ]);
    expect(channels.map((c) => [c.item.id, c.number])).toEqual([
      ["a-cam", 1],
      ["b-cam", 2],
      ["car", 3],
    ]);
  });

  test("only the first nine channels get a number", () => {
    const channels = channelsOf(many);
    expect(channels.filter((c) => c.number !== null)).toHaveLength(9);
    expect(channels[8].item.id).toBe("still6"); // 2 cameras + 7 stills
    expect(channels[9].number).toBeNull();
    expect(channels.slice(0, 2).every((c) => c.item.kind === "video")).toBe(true);
  });

  test("a switch to a still shows it until the next switch, like a camera", () => {
    const e = edit({
      switches: [
        { at_s: 20, media_id: "car" },
        { at_s: 30, media_id: "camA" },
      ],
    });
    expect(activeChannel(e.switches, 25, "camA")).toBe("car");
    expect(activeChannel(e.switches, 35, "camA")).toBe("camA");
    expect(segments(e.switches, "camA", 60).map((x) => [x.channel, x.start, x.end])).toEqual([
      ["camA", 0, 20],
      ["car", 20, 30],
      ["camA", 30, 60],
    ]);
  });

  test("a null switch means the default camera", () => {
    const switches = [
      { at_s: 10, media_id: "car" },
      { at_s: 20, media_id: null },
    ];
    expect(activeChannel(switches, 15, "camA")).toBe("car");
    expect(activeChannel(switches, 25, "camA")).toBe("camA");
  });
});

describe("showOver", () => {
  test("shows a channel over a range and returns to what was showing at its end", () => {
    const base = edit({ switches: [{ at_s: 5, media_id: "camB" }] });
    expect(showOver(base, "camA", "car", 10, 14).switches).toEqual([
      { at_s: 5, media_id: "camB" },
      { at_s: 10, media_id: "car" },
      { at_s: 14, media_id: "camB" },
    ]);
  });

  test("drops switches hidden under the range but returns to the one in force at its end", () => {
    const base = edit({
      switches: [
        { at_s: 5, media_id: "camB" },
        { at_s: 12, media_id: "camA" },
      ],
    });
    expect(showOver(base, "camB", "car", 10, 14).switches).toEqual([
      { at_s: 5, media_id: "camB" },
      { at_s: 10, media_id: "car" },
      { at_s: 14, media_id: "camA" },
    ]);
  });

  test("with no earlier switch returns to the default camera", () => {
    expect(showOver(edit(), "camA", "camB", 10, 14).switches).toEqual([
      { at_s: 10, media_id: "camB" },
      { at_s: 14, media_id: "camA" },
    ]);
  });
});

describe("boundaryPreview", () => {
  const isVideo = (id: string) => id.startsWith("cam");
  const f = 1 / 30;
  const at = (
    before: string | null,
    after: string | null,
    resizing: "before" | "after" = "after",
  ) => boundaryPreview({ before, after, at: 10, resizing, isVideo, frameS: f });

  test("two different videos are compared side by side, the frame either side of the boundary", () => {
    const { t, compare } = at("camA", "camB");
    expect(t).toBe(10);
    expect(compare).toEqual({ before: "camA", after: "camB", tBefore: 10 - f, tAfter: 10 });
  });

  test("a video next to a still shows the video, whichever side it is on", () => {
    expect(at("car", "camB", "before")).toEqual({ t: 10, compare: null }); // its first frame
    expect(at("camA", "car", "after")).toEqual({ t: 10 - f, compare: null }); // its last frame
  });

  test("two stills show the one being resized", () => {
    expect(at("car", "logo", "after")).toEqual({ t: 10, compare: null });
    expect(at("car", "logo", "before")).toEqual({ t: 10 - f, compare: null });
  });

  test("one camera on both sides has nothing to compare: it shows the one being resized", () => {
    expect(at("camA", "camA", "before")).toEqual({ t: 10 - f, compare: null });
  });
});

describe("usedChannelIds", () => {
  test("a channel is used when some segment shows it, the opening default camera included", () => {
    const used = usedChannelIds([{ at_s: 10, media_id: "camB" }], "camA", 50);
    expect([...used].sort()).toEqual(["camA", "camB"]);
    expect(usedChannelIds([], "camA", 50)).toEqual(new Set(["camA"]));
  });

  test("a switch at the very start leaves no opening segment for the default camera", () => {
    expect(usedChannelIds([{ at_s: 0, media_id: "car" }], "camA", 50)).toEqual(new Set(["car"]));
  });
});

describe("groupMedia", () => {
  const m = (label: string, folder: string, kind: "video" | "audio" | "image" = "video") =>
    ({ id: label, path: `${folder}/${label}`, label, kind, folder }) as unknown as MediaItem;

  test("the project folder first, then its subfolders in natural order", () => {
    const groups = groupMedia([m("a.mp4", "day 10"), m("b.mp4", ""), m("c.mp4", "day 2/cam A")]);
    expect(groups.map((g) => g.title)).toEqual(["", "day 2 / cam A", "day 10"]);
  });

  test("within a folder: cameras, then audio, then stills, by name", () => {
    const [group] = groupMedia([
      m("car.png", "", "image"),
      m("mic.wav", "", "audio"),
      m("b.mp4", ""),
      m("a.mp4", ""),
    ]);
    expect(group.items.map((i) => i.label)).toEqual(["a.mp4", "b.mp4", "mic.wav", "car.png"]);
  });
});

describe("stageLayout", () => {
  // A 1400 x 1000 stage: padding 24, gap 8, 48px under the view; two thirds of the width in 16:9
  // is a 1376 * 2/3 * 9/16 = 516px-tall view.
  const base = { stageW: 1400, padX: 24, padY: 24, gap: 8, below: 48 };

  test("the view takes what it can use first; the timeline gets the rest", () => {
    // usable 968; the full view row is 516 + 48 = 564, leaving 404 for a 308px timeline.
    const l = stageLayout({ ...base, stageH: 1000, naturalTimeline: 308 });
    expect(l).toEqual({ boxH: 308, playerH: 516 });
  });

  test("more rows never shrink a view that is at full size: the timeline scrolls instead", () => {
    const few = stageLayout({ ...base, stageH: 800, naturalTimeline: 150 });
    const many = stageLayout({ ...base, stageH: 800, naturalTimeline: 400 });
    expect(few.playerH).toBe(516); // 768 usable - (516 + 48) = 204 room: all 150 fit
    expect(many.playerH).toBe(516); // the same view...
    expect(many.boxH).toBe(204); // ...and the timeline stops at its leftover and scrolls
  });

  test("fewer rows let the view grow back, up to its limit", () => {
    const tall = stageLayout({ ...base, stageH: 600, naturalTimeline: 400 });
    const short = stageLayout({ ...base, stageH: 600, naturalTimeline: 168 });
    expect(tall.boxH).toBe(168);
    expect(short.playerH).toBeGreaterThanOrEqual(tall.playerH);
    // 568 usable: with the 168 minimum timeline the view is 568 - 168 - 48 = 352.
    expect(tall.playerH).toBe(352);
  });

  test("the timeline is never shorter than about four rows, and the view never below its minimum", () => {
    const l = stageLayout({ ...base, stageH: 300, naturalTimeline: 500 });
    expect(l.boxH).toBe(168);
    expect(l.playerH).toBe(140);
  });
});

describe("renameMedia", () => {
  test("every reference to a relinked file follows it to the new id", () => {
    const e = edit({
      switches: [
        { at_s: 5, media_id: "old" },
        { at_s: 9, media_id: null },
      ],
      tracks: [{ media_id: "old", gain_db: -3, muted: false }],
      mix: [{ media_id: "old", start_s: 1, end_s: 2, gain_db: 0, muted: true }],
      disabled: ["old", "other"],
    });
    const r = renameMedia(e, "old", "new");
    expect(r.switches.map((s) => s.media_id)).toEqual(["new", null]);
    expect(r.tracks[0].media_id).toBe("new");
    expect(r.mix[0].media_id).toBe("new");
    expect(r.disabled).toEqual(["new", "other"]);
  });

  test("an edit that doesn't mention it comes back as the very same object", () => {
    const e = edit();
    expect(renameMedia(e, "old", "new")).toBe(e);
  });
});

describe("setAllEnabled", () => {
  const cam = (id: string, kind: "video" | "audio" | "image" = "video") =>
    ({ id, kind, label: id, has_audio: kind === "audio" }) as MediaItem;

  test("shows or hides a set of cameras and stills at once, and uses or drops audio", () => {
    const items = [cam("a"), cam("car", "image"), cam("mic", "audio")];
    const off = setAllEnabled(edit(), items, items, false);
    expect(off.disabled.sort()).toEqual(["a", "car"]);
    expect(off.tracks.find((t) => t.media_id === "mic")?.muted).toBe(true); // audio is on by default
    const on = setAllEnabled(off, items, items, true);
    expect(on.disabled).toEqual([]);
    expect(on.tracks.find((t) => t.media_id === "mic")?.muted).toBe(false);
  });
});

describe("segment operations", () => {
  const two = edit({
    switches: [
      { at_s: 10, media_id: "camB" },
      { at_s: 30, media_id: "camA" },
    ],
  });

  test("deleting a segment lets the one before it carry on", () => {
    // camB's segment goes; camA (the opening default) continues, and the camA switch at 30 merges in.
    expect(deleteSegment(two, 0).switches).toEqual([{ at_s: 30, media_id: "camA" }]);
    expect(deleteSegment(two, 1).switches).toEqual([{ at_s: 10, media_id: "camB" }]);
    expect(deleteSegment(two, -1)).toBe(two); // the opening stretch has no switch to delete
  });

  test("deleting between two segments of one channel merges them", () => {
    const e = edit({
      switches: [
        { at_s: 5, media_id: "camB" },
        { at_s: 10, media_id: "car" },
        { at_s: 20, media_id: "camB" },
      ],
    });
    expect(deleteSegment(e, 1).switches).toEqual([{ at_s: 5, media_id: "camB" }]);
  });

  test("moving an edge changes both neighbours: one grows, one shrinks", () => {
    const moved = moveSegmentEdge(two, 1, 25, 50);
    expect(segments(moved.switches, "camA", 50).map((x) => [x.channel, x.start, x.end])).toEqual([
      ["camA", 0, 10],
      ["camB", 10, 25],
      ["camA", 25, 50],
    ]);
  });
});

describe("mixing", () => {
  const withTracks = (patch: Partial<EditList> = {}) => edit(patch);
  const region = (start: number, end: number, gain_db = 0, muted = false, media_id = "mic") => ({
    media_id,
    start_s: start,
    end_s: end,
    gain_db,
    muted,
  });

  test("a track's level at a moment is its gain plus the region there; muted regions are silent", () => {
    const e = withTracks({
      tracks: [{ media_id: "mic", gain_db: -3, muted: false }],
      mix: [region(10, 20, -6), region(30, 40, 0, true)],
    });
    expect(trackGainDb(e, media, "mic", 5)).toBe(-3);
    expect(trackGainDb(e, media, "mic", 15)).toBe(-9);
    expect(trackGainDb(e, media, "mic", 20)).toBe(-3); // a region ends exclusively
    expect(trackGainDb(e, media, "mic", 35)).toBeNull();
  });

  test("a track that is not in the output has no level", () => {
    const e = withTracks({ tracks: [{ media_id: "mic", gain_db: 0, muted: true }] });
    expect(trackGainDb(e, media, "mic", 5)).toBeNull();
    expect(trackGainDb(edit(), media, "camA", 5)).toBeNull(); // camera audio is off by default
  });

  test("where regions overlap, the later one wins", () => {
    const e = withTracks({
      tracks: [{ media_id: "mic", gain_db: 0, muted: false }],
      mix: [region(0, 20, -10), region(5, 10, 4)],
    });
    expect(trackGainDb(e, media, "mic", 7)).toBe(4);
    expect(trackGainDb(e, media, "mic", 15)).toBe(-10);
  });

  test("addMix paints over what was there: overlapped regions are trimmed or split", () => {
    const base = withTracks({
      mix: [region(0, 20, -10), region(30, 40, -2), region(5, 6, 1, false, "other")],
    });
    const next = addMix(base, region(5, 10, 3));
    expect(next.mix.map((r) => [r.media_id, r.start_s, r.end_s, r.gain_db])).toEqual([
      ["mic", 0, 5, -10],
      ["other", 5, 6, 1], // another track is untouched
      ["mic", 5, 10, 3],
      ["mic", 10, 20, -10],
      ["mic", 30, 40, -2],
    ]);
    expect(
      addMix(base, region(0, 20, 0, true)).mix.filter((r) => r.media_id === "mic"),
    ).toHaveLength(2);
  });

  test("including a file's audio: camera audio is off until you include it", () => {
    expect(trackIncluded(edit(), media, "mic")).toBe(true); // audio-only files are in by default
    expect(trackIncluded(edit(), media, "camA")).toBe(false);

    const withCam = setAudioIncluded(edit(), media, "camA", true);
    expect(trackIncluded(withCam, media, "camA")).toBe(true);
    expect(trackIncluded(withCam, media, "mic")).toBe(true); // the default track is kept

    const muted = setAudioIncluded(edit(), media, "mic", false);
    expect(trackIncluded(muted, media, "mic")).toBe(false);
    expect(muted.tracks).toEqual([{ media_id: "mic", gain_db: 0, muted: true }]);
    expect(setAudioIncluded(edit(), media, "camA", false)).toEqual(edit()); // nothing to turn off
  });
});

describe("disabled channels", () => {
  const cams = [item("a", "video"), item("b", "video"), item("c", "video"), item("car", "image")];

  test("a disabled channel gets no number and the rest renumber, so numbers match the grid", () => {
    const channels = channelsOf(cams, ["b"]);
    expect(channels.map((c) => [c.item.id, c.number, c.enabled])).toEqual([
      ["a", 1, true],
      ["b", null, false],
      ["c", 2, true], // moved up into b's number
      ["car", 3, true],
    ]);
  });

  test("the nine-number limit counts enabled channels only", () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      item(`cam${String(i).padStart(2, "0")}`, "video"),
    );
    const withOff = channelsOf(many, ["cam00", "cam01"]);
    expect(withOff.filter((c) => c.number !== null)).toHaveLength(9);
    expect(withOff[2].number).toBe(1); // the first enabled camera is camera 1
    expect(withOff[0].number).toBeNull();
  });

  test("nothing disabled changes nothing", () => {
    expect(channelsOf(cams, []).map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(channelsOf(cams).every((c) => c.enabled)).toBe(true);
  });

  test("setEnabled turns a channel off and on, without duplicates", () => {
    const off = setEnabled(edit(), "a", false);
    expect(off.disabled).toEqual(["a"]);
    expect(setEnabled(off, "a", false).disabled).toEqual(["a"]);
    expect(setEnabled(off, "a", true).disabled).toEqual([]);
    expect(setEnabled(setEnabled(edit(), "a", false), "b", false).disabled).toEqual(["a", "b"]);
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

describe("nudgeStep", () => {
  const keys = { ctrlKey: false, altKey: false, metaKey: false };
  test("Ctrl is a frame, Option 0.1 s, none 1 s, Cmd 10 s: smaller to the left on the keyboard", () => {
    const frame = 1001 / 30000;
    expect(nudgeStep({ ...keys, ctrlKey: true }, frame)).toBe(frame);
    expect(nudgeStep({ ...keys, altKey: true }, frame)).toBe(0.1);
    expect(nudgeStep(keys, frame)).toBe(1);
    expect(nudgeStep({ ...keys, metaKey: true }, frame)).toBe(10);
  });
});

describe("moveSelectionEdge", () => {
  const sel: [number, number] = [10, 50];
  test("moves one edge and leaves the other", () => {
    expect(moveSelectionEdge(sel, 0, 12, 100)).toEqual([12, 50]);
    expect(moveSelectionEdge(sel, 1, 60, 100)).toEqual([10, 60]);
  });
  test("keeps the edges on the timeline and apart", () => {
    expect(moveSelectionEdge(sel, 0, -5, 100)[0]).toBe(0);
    expect(moveSelectionEdge(sel, 0, 70, 100)[0]).toBeCloseTo(49.9);
    expect(moveSelectionEdge(sel, 1, 500, 100)[1]).toBe(100);
    expect(moveSelectionEdge(sel, 1, 3, 100)[1]).toBeCloseTo(10.1);
  });
});

describe("uncut", () => {
  const cutEdit = edit({ cuts: [{ start_s: 10, end_s: 30 }] });
  test("splits a cut around a stretch inside it", () => {
    expect(uncut(cutEdit, 15, 20).cuts).toEqual([
      { start_s: 10, end_s: 15 },
      { start_s: 20, end_s: 30 },
    ]);
  });
  test("trims a cut from either side, or removes it entirely", () => {
    expect(uncut(cutEdit, 5, 15).cuts).toEqual([{ start_s: 15, end_s: 30 }]);
    expect(uncut(cutEdit, 25, 40).cuts).toEqual([{ start_s: 10, end_s: 25 }]);
    expect(uncut(cutEdit, 0, 40).cuts).toEqual([]);
  });
  test("leaves cuts it doesn't touch, and says whether it touches any", () => {
    expect(uncut(cutEdit, 40, 50).cuts).toEqual(cutEdit.cuts);
    expect(overlapsCut(cutEdit, [5, 15])).toBe(true);
    expect(overlapsCut(cutEdit, [30, 40])).toBe(false);
  });
  test("a selection wholly inside a cut has nothing left to cut", () => {
    expect(insideCuts(cutEdit, [12, 25])).toBe(true);
    expect(insideCuts(cutEdit, [5, 15])).toBe(false);
    expect(insideCuts(cutEdit, [25, 35])).toBe(false);
  });
});
