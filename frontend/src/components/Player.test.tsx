import { render } from "@testing-library/preact";
import { expect, test } from "vitest";

import type { EditList, MediaItem } from "../lib/api";
import { Player } from "./Player";

const cam = (id: string, has_audio = false): MediaItem => ({
  id,
  path: `${id}.mp4`,
  kind: "video",
  label: id,
  duration_s: 100,
  width: 1,
  height: 1,
  fps: 30,
  has_audio,
  proxy_ready: true,
  proxy_building: false,
  included: true,
  missing: false,
  folder: "",
  size_bytes: null,
});
const mic: MediaItem = { ...cam("mic", true), kind: "audio" };

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

const media = [cam("a"), cam("b"), cam("c", true), mic];
const offsets = { a: 0, b: 0, c: 0, mic: 0 };

function videos(e: EditList): string[] {
  const { container } = render(
    <Player
      slug="s"
      media={media}
      offsets={offsets}
      edit={e}
      t={5}
      playing={false}
      elements={{ current: {} }}
    />,
  );
  return [...container.querySelectorAll("video")].map((v) => v.src.split("/").slice(-2)[0]).sort();
}

test("every camera is decoded when none is disabled", () => {
  expect(videos(edit())).toEqual(["a", "b", "c"]);
});

test("a disabled camera is not decoded, so it costs nothing while it is off", () => {
  expect(videos(edit({ disabled: ["b"] }))).toEqual(["a", "c"]);
});

test("but a disabled camera is still played if it is the one the edit has on screen", () => {
  const onScreen = edit({ disabled: ["b"], switches: [{ at_s: 0, media_id: "b" }] });
  expect(videos(onScreen)).toEqual(["a", "b", "c"]);
});

test("and if its own audio is in the mix, because the audio needs the player", () => {
  // Camera c's audio is used; it is switched off in the grid but must still play for its sound.
  const audioOn = edit({ disabled: ["c"], tracks: [{ media_id: "c", gain_db: 0, muted: false }] });
  expect(videos(audioOn)).toContain("c");
  const audioMuted = edit({
    disabled: ["c"],
    tracks: [{ media_id: "c", gain_db: 0, muted: true }],
  });
  expect(videos(audioMuted)).not.toContain("c");
});

test("a comparison shows two videos side by side, before on the left, each at its own moment", () => {
  const elements: { current: Record<string, HTMLMediaElement | null> } = { current: {} };
  const { container, getAllByTestId } = render(
    <Player
      slug="s"
      media={media}
      offsets={{ a: 0, b: 2, c: 0, mic: 0 }}
      edit={edit()}
      t={10}
      playing={false}
      compare={{ before: "a", after: "b", tBefore: 9.97, tAfter: 10 }}
      elements={elements}
    />,
  );
  const cls = (id: string) =>
    [...container.querySelectorAll("video")].find((v) => v.src.includes(`/${id}/`))!.className;
  expect(cls("a")).toContain("left-0 w-1/2 opacity-100");
  expect(cls("b")).toContain("right-0 w-1/2 opacity-100");
  expect(cls("c")).toContain("opacity-0");
  expect(getAllByTestId("compare-label").map((l) => l.textContent)).toEqual([
    "a · last frame",
    "b · first frame",
  ]);
  // b starts 2 s into the timeline, so its first frame at 10 s is 8 s into the file.
  expect(elements.current.a?.currentTime).toBeCloseTo(9.97);
  expect(elements.current.b?.currentTime).toBeCloseTo(8);
});

test("a still shows in the viewer even though its proxy hasn't been built (it is made on demand)", () => {
  const car = { ...cam("car"), kind: "image" as const, has_audio: false, proxy_ready: false };
  const { container } = render(
    <Player
      slug="s"
      media={[cam("a"), car]}
      offsets={{ a: 0 }}
      edit={edit({ switches: [{ at_s: 0, media_id: "car" }] })}
      t={5}
      playing={false}
      elements={{ current: {} }}
    />,
  );
  const picture = container.querySelector("img");
  expect(picture).not.toBeNull();
  expect(picture!.getAttribute("src")).toContain("/media/car/proxy");
});
