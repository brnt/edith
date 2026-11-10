import { useEffect, useRef } from "preact/hooks";

import { proxyUrl, type EditList, type MediaItem } from "../lib/api";
import { effectiveTracks, frameState, trackGainDb } from "../lib/timeline";

interface Props {
  slug: string;
  media: MediaItem[];
  offsets: Record<string, number>;
  edit: EditList;
  t: number;
  playing: boolean;
  /** Registry of the media elements, shared with the camera tiles. */
  elements: { current: Record<string, HTMLMediaElement | null> };
}

interface Audio {
  ctx: AudioContext;
  gains: Map<string, GainNode>;
}

/** Keeps one hidden <video>/<audio> per proxy in step with the playhead; shows the active one. */
export function Player({ slug, media, offsets, edit, t, playing, elements }: Props) {
  const audio = useRef<Audio | null>(null);
  const tracks = effectiveTracks(edit, media);
  const state = frameState(t, edit, media, offsets);
  // A camera switched off in the Media tab is not decoded, unless the output needs it right now:
  // it is the one on screen, or its own audio is in the mix.
  const off = new Set(edit.disabled);
  const needed = (m: MediaItem) =>
    !off.has(m.id) || m.id === state.channel || tracks.some((x) => x.media_id === m.id && !x.muted);
  const playable = media.filter((m) => m.kind !== "image" && m.proxy_ready && needed(m));
  const shown = media.find((m) => m.id === state.channel);
  const still = shown?.kind === "image" ? shown : null;

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

  // Levels follow the playhead: a track's own gain plus any mix region at this moment, or silence.
  useEffect(() => {
    const Ctx = typeof AudioContext === "undefined" ? null : AudioContext;
    for (const m of playable) {
      const el = elements.current[m.id];
      if (!el) continue;
      const inOutput = tracks.some((tr) => tr.media_id === m.id);
      const level = trackGainDb(edit, media, m.id, t);
      const linear = level === null ? 0 : 10 ** (level / 20);
      if (!Ctx || !inOutput) {
        // No Web Audio (or not an output track): the element's own mute and volume (max 1).
        el.muted = !inOutput || level === null;
        el.volume = Math.min(1, linear);
        continue;
      }
      el.muted = false;
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
  }, [t, playing, edit.tracks, edit.mix, playable.length]);

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
            class={`absolute inset-0 h-full w-full object-contain ${state.channel === m.id ? "opacity-100" : "opacity-0"}`}
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
      {!state.channel && (
        <div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
          No camera
        </div>
      )}
    </div>
  );
}
