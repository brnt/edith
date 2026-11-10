const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const TOKEN = import.meta.env.VITE_API_TOKEN ?? "dev-token";

export interface Project {
  slug: string;
  name: string;
  created_at: string;
  needs_upgrade: boolean;
}

export type MediaKind = "video" | "audio" | "image";

export interface MediaItem {
  id: string;
  path: string;
  kind: MediaKind;
  label: string;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean;
  proxy_ready: boolean;
  /** False: found in the project folder but not part of the project until included (an edit). */
  included: boolean;
  /** The file is no longer where the project says it is (moved, deleted, drive unplugged). */
  missing: boolean;
  /** Its directory within the project folder (or its own directory if outside it). */
  folder: string;
  external: boolean;
  size_bytes: number | null;
}

export interface MediaDetails {
  container: string | null;
  size_bytes: number | null;
  duration_s: number | null;
  bit_rate: number | null;
  created: string | null;
  /** For a still: what is really in the file (JPEG, PNG, WebP, AVIF…). */
  image_format?: string | null;
  /** False when the file name's extension promises a different format than the one inside. */
  image_extension_matches?: boolean | null;
  video: {
    codec: string | null;
    profile: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    fps_variable: boolean;
    pix_fmt: string | null;
    bit_depth: number | null;
    color_space: string | null;
    color_range: string | null;
    color_transfer: string | null;
    bit_rate: number | null;
  } | null;
  audio: {
    codec: string | null;
    sample_rate: number | null;
    channels: number | null;
    channel_layout: string | null;
    bit_rate: number | null;
    bit_depth: number | null;
  } | null;
}

export interface SyncResult {
  status: "synced" | "low_confidence" | "unsynced";
  start_s: number | null;
  drift_ppm: number | null;
  tone_start_s: number | null;
  tone_end_s: number | null;
  score: number | null;
  interval_residual_s: number | null;
}

/** Where the registration sound comes from: a stretch of a recording, a text seed, or a file. */
export interface SyncTemplate {
  kind: "excerpt" | "seed" | "file";
  media_id?: string | null;
  start_s?: number | null;
  end_s?: number | null;
  seed?: string | null;
  path?: string | null;
}

export interface SyncState {
  template: SyncTemplate | null;
  results: Record<string, SyncResult>;
  nudges: Record<string, number>;
  needs_upgrade: boolean;
}

/** From `at_s` on, the output shows this channel: a camera or a still. null = default camera. */
export interface CameraSwitch {
  at_s: number;
  media_id: string | null;
}
export interface Cut {
  start_s: number;
  end_s: number;
}
export interface TrackSetting {
  media_id: string;
  gain_db: number;
  muted: boolean;
}

/** A stretch of one audio track at a different level: a gain change (added to the track) or a mute. */
export interface MixRegion {
  media_id: string;
  start_s: number;
  end_s: number;
  gain_db: number;
  muted: boolean;
}

export interface EditList {
  switches: CameraSwitch[];
  cuts: Cut[];
  tracks: TrackSetting[];
  mix: MixRegion[];
  /** Cameras and stills switched off in the Media tab (hidden from the grid, no number). */
  disabled: string[];
  range_in_s: number | null;
  range_out_s: number | null;
  fps_num: number;
  fps_den: number;
  width: number;
  height: number;
}

export interface Peaks {
  rate: number;
  floor_db: number;
  values: number[];
}

export interface Job {
  id: string;
  label: string;
  state: "running" | "done" | "error";
  progress: number;
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface Plan {
  duration_s: number;
  warnings: string[];
}

export interface LibraryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  kind: MediaKind | null;
  size: number | null;
}
export interface LibraryListing {
  dir: string;
  parent: string | null;
  entries: LibraryEntry[];
}

export type ExportFormat = "json" | "fcpxml" | "xmeml" | "edl";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; detail?: unknown };
      detail = body.message ?? (typeof body.detail === "string" ? body.detail : "");
    } catch {
      /* body was not JSON */
    }
    // The server's message is written for people; the status code only helps when there isn't one.
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

const p = (slug: string) => `/projects/${encodeURIComponent(slug)}`;

export const fetchProjects = () => request<Project[]>("/projects");
export const createProject = (name: string) =>
  request<Project>("/projects", json("POST", { name }));
export const fetchProject = (slug: string) => request<Project>(p(slug));
export const upgradeProject = (slug: string) =>
  request<Project>(`${p(slug)}/upgrade`, json("POST"));

export const fetchMedia = (slug: string) => request<MediaItem[]>(`${p(slug)}/media`);
export const addMedia = (slug: string, path: string) =>
  request<MediaItem>(`${p(slug)}/media`, json("POST", { path }));
export const removeMedia = (slug: string, id: string) =>
  request<void>(`${p(slug)}/media/${id}`, json("DELETE"));
export const startProxies = (slug: string) => request<Job>(`${p(slug)}/proxies`, json("POST"));
export const relinkMedia = (slug: string, id: string, path: string) =>
  request<MediaItem>(`${p(slug)}/media/${id}/relink`, json("POST", { path }));

export const fetchMediaDetails = (slug: string, id: string) =>
  request<MediaDetails>(`${p(slug)}/media/${id}/details`);

export const fetchPeaks = (slug: string, id: string) =>
  request<Peaks>(`${p(slug)}/media/${id}/peaks`);
export const thumbUrl = (slug: string, id: string) => `${BASE_URL}${p(slug)}/media/${id}/thumb`;
export const proxyUrl = (slug: string, id: string) => `${BASE_URL}${p(slug)}/media/${id}/proxy`;

export const fetchSync = (slug: string) => request<SyncState>(`${p(slug)}/sync`);
export const startSync = (slug: string, template: SyncTemplate) =>
  request<Job>(`${p(slug)}/sync`, json("POST", { template }));
export const registrationSoundUrl = (seed: string) =>
  `${BASE_URL}/registration/sound?seed=${encodeURIComponent(seed)}`;
export const putNudges = (slug: string, nudges: Record<string, number>) =>
  request<SyncState>(`${p(slug)}/sync/nudges`, json("PUT", { nudges }));

export const fetchEdit = (slug: string) =>
  request<{ edit: EditList; needs_upgrade: boolean }>(`${p(slug)}/edit`);
export const putEdit = (slug: string, edit: EditList) =>
  request<{ edit: EditList; needs_upgrade: boolean }>(`${p(slug)}/edit`, json("PUT", edit));
export const fetchPlan = (slug: string) => request<Plan>(`${p(slug)}/plan`);
export const fetchSilence = (slug: string, thresholdDb: number, minS: number, padS: number) =>
  request<{ cuts: Cut[] }>(
    `${p(slug)}/silence?threshold_db=${thresholdDb}&min_s=${minS}&pad_s=${padS}`,
  );

export const fetchJob = (id: string) => request<Job>(`/jobs/${id}`);
export const listLibrary = (dir = "") =>
  request<LibraryListing>(`/library/files?dir=${encodeURIComponent(dir)}`);
export const exportUrl = (slug: string, format: ExportFormat) =>
  `${BASE_URL}${p(slug)}/export/${format}`;

export interface RenderFile {
  name: string;
  size: number;
}
export const startRender = (slug: string) => request<Job>(`${p(slug)}/render`, json("POST"));
export const fetchRenders = (slug: string) => request<RenderFile[]>(`${p(slug)}/renders`);
export const renderUrl = (slug: string, name: string) =>
  `${BASE_URL}${p(slug)}/renders/${encodeURIComponent(name)}`;
