import { useEffect, useRef } from "preact/hooks";

import { proxyUrl, type EditList, type MediaItem } from "../lib/api";
import { effectiveTracks, frameState } from "../lib/timeline";

interface Props {
  slug: string;
  media: MediaItem[];
  offsets: Record<string, number>;
  edit: EditList;
  t: number;
  playing: boolean;
}

interface Audio {
  ctx: AudioContext;
  gains: Map<string, GainNode>;
}

/** Keeps one hidden <video>/<audio> per proxy in step with the playhead; shows the active one. */
export function Player({ slug, media, offsets, edit, t, playing }: Props) {
  const elements = useRef<Record<string, HTMLMediaElement | null>>({});
  const audio = useRef<Audio | null>(null);
  const playable = media.filter((m) => m.kind !== "image" && m.proxy_ready);
  const tracks = effectiveTracks(edit, media);
  const state = frameState(t, edit, media, offsets);
  const still = state.still && media.find((m) => m.id === state.still?.media_id);

  useEffect(() => {
    for (const m of playable) {
      const el = elements.current[m.id];
      const local = state.local[m.id];
      if (!el) continue;
      if (local === null || local === undefined) {
        if (!el.paused) el.pause();
        continue;
      }
      const drift = Math.abs(el.currentTime - local);
      if (playing) {
        if (drift > 0.25 || el.paused) el.currentTime = local;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (drift > 0.04) el.currentTime = local;
      }
    }
  }, [t, playing, playable.length]);

  useEffect(() => {
    const Ctx = typeof AudioContext === "undefined" ? null : AudioContext;
    for (const m of playable) {
      const el = elements.current[m.id];
      if (!el) continue;
      const track = tracks.find((tr) => tr.media_id === m.id);
      const linear = track && !track.muted ? 10 ** (track.gain_db / 20) : 0;
      el.muted = !track || track.muted;
      if (!Ctx || !track) continue;
      if (!audio.current) audio.current = { ctx: new Ctx(), gains: new Map() };
      if (!audio.current.gains.has(m.id)) {
        const gain = audio.current.ctx.createGain();
        audio.current.ctx
          .createMediaElementSource(el)
          .connect(gain)
          .connect(audio.current.ctx.destination);
        audio.current.gains.set(m.id, gain);
      }
      audio.current.gains.get(m.id)!.gain.value = linear;
    }
    if (playing) void audio.current?.ctx.resume();
  }, [playing, edit.tracks, playable.length]);

  if (playable.length === 0) {
    return (
      <div class="flex h-full w-full items-center justify-center rounded bg-black text-sm text-neutral-500">
        Build preview proxies to play the edit.
      </div>
    );
  }

  return (
    <div class="relative h-full w-full overflow-hidden rounded bg-black" data-testid="player">
      {playable.map((m) =>
        m.kind === "video" ? (
          <video
            key={m.id}
            ref={(el) => {
              elements.current[m.id] = el;
            }}
            src={proxyUrl(slug, m.id)}
            preload="auto"
            playsInline
            muted
            class={`absolute inset-0 h-full w-full object-contain ${!still && state.camera === m.id ? "opacity-100" : "opacity-0"}`}
          />
        ) : (
          <audio
            key={m.id}
            ref={(el) => {
              elements.current[m.id] = el;
            }}
            src={proxyUrl(slug, m.id)}
            preload="auto"
          />
        ),
      )}
      {still && still.proxy_ready && (
        <img
          src={proxyUrl(slug, still.id)}
          alt={still.label}
          class="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {!state.camera && !still && (
        <div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
          No camera
        </div>
      )}
    </div>
  );
}
