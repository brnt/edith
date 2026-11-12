const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const TOKEN = import.meta.env.VITE_API_TOKEN ?? "dev-token";

/** A project is a folder anywhere on disk; Edith remembers the ones you open in a recent list. */
export interface Project {
  slug: string;
  name: string;
  /** The project file (`.edith`): absolute path. */
  file: string;
  /** The folder it is in: absolute path. Media are named relative to it. */
  folder: string;
  created_at: string | null;
  needs_upgrade: boolean;
  /** False: the folder can't be found right now (a drive unplugged, a folder moved). */
  available: boolean;
  last_opened: string | null;
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
  /** Its preview is queued or being made (done in the background as media is detected). */
  proxy_building: boolean;
  /** False: found in the project folder but not part of the project until included (an edit). */
  included: boolean;
  /** The file is no longer where the project says it is (moved, deleted, drive unplugged). */
  missing: boolean;
  /** Its directory within the project folder ("" for the folder itself). */
  folder: string;
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

export interface FolderEntry {
  name: string;
  /** Absolute. */
  path: string;
  /** How many projects (`.edith` files) it holds. */
  edith_files: number;
  is_project: boolean;
}
export interface FileEntry {
  name: string;
  path: string;
}
export interface FolderListing {
  dir: string;
  parent: string | null;
  entries: FolderEntry[];
  /** The `.edith` project files in the listed folder. */
  files: FileEntry[];
  is_project: boolean;
}
export interface Place {
  name: string;
  path: string;
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
export const createProject = (name: string, folder: string) =>
  request<Project>("/projects", json("POST", { name, folder }));
/** Open a project: a `.edith` file, or a folder that has exactly one. */
export const openProject = (path: string) =>
  request<Project>("/projects/open", json("POST", { path }));
/** Note that a project was just opened (it goes to the top of the recent list). */
export const touchProject = (slug: string) => request<void>(`${p(slug)}/opened`, json("POST"));
export const forgetProject = (slug: string) => request<void>(`${p(slug)}/recent`, json("DELETE"));
export const fetchProject = (slug: string) => request<Project>(p(slug));
export const upgradeProject = (slug: string) =>
  request<Project>(`${p(slug)}/upgrade`, json("POST"));

export const fetchMedia = (slug: string) => request<MediaItem[]>(`${p(slug)}/media`);
/** Make a file of the project folder part of the project (the edit that writes it). */
export const includeMedia = (slug: string, path: string) =>
  request<MediaItem>(`${p(slug)}/media`, json("POST", { path }));
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
/** Dead stretches to cut, within `within` (the selection) or the whole timeline. */
export const fetchSilence = (
  slug: string,
  thresholdDb: number,
  minS: number,
  padS: number,
  within?: [number, number] | null,
) =>
  request<{ cuts: Cut[] }>(
    `${p(slug)}/silence?threshold_db=${thresholdDb}&min_s=${minS}&pad_s=${padS}` +
      (within ? `&from_s=${within[0]}&to_s=${within[1]}` : ""),
  );

export const fetchJob = (id: string) => request<Job>(`/jobs/${id}`);
export const listFolders = (dir = "") =>
  request<FolderListing>(`/fs/folders?dir=${encodeURIComponent(dir)}`);
export const fetchPlaces = () => request<Place[]>("/fs/places");
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
