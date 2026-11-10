# 0004. A project is a self-contained folder, found by opening it

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

Projects started as sub-folders of a single *library* folder, each holding `project.edith` and a
visible `cache/`, with media named by path relative to the library and added one by one ("Add
media…"). That made a project depend on where the library was mounted and on files scattered
elsewhere in it, and gave no way to see or choose a project's location. The goal is a workflow that
is seamless and portable: the media you shoot sits in one folder, and that folder *is* the project.

## Decision

- A project is a `.edith` file in a folder anywhere on disk, with the media (subfolders included),
  `renders/`, and a hidden `.edith/` cache. Moving or copying the folder moves the project. A
  folder can hold several `.edith` files (two cuts of one shoot); they share media and cache.
- Media paths in the project file are relative to the project folder. Footage kept elsewhere is
  linked into the folder. There is no *Add media* or *Remove*: dropping a file in the folder
  makes it available (discovery polls the folder), and including it is the edit that writes it.
  A missing file that nothing uses just drops off the list.
- There is no library root and no scanning. A project's id is its `.edith` file's absolute path; the app
  keeps a **recent-projects list** (`STATE_DIR`, absolute paths) and offers *New project…* (choose
  the media folder) and *Open project…* (select a `.edith` file, or a folder with exactly one). A recent whose
  folder is gone (a drive unplugged) stays, marked, until forgotten.
- Existing projects are converted once at startup (`LEGACY_LIBRARY_DIR`): a project's own
  prefix is dropped from its media paths, other folders of the old library are linked into the
  project folder under the same name (so paths and media ids are unchanged), `cache/` becomes
  `.edith/`, and a backup of the old file is kept. Shared footage is linked, not copied.

## Consequences

- Portable by construction; the on-disk format stays one SQLite file (ADR 0001), with a `layout`
  marker in `meta`.
- The API can browse and read any folder the server can. That is fine for a local single-user tool
  (and is how a project folder is chosen) but means the API must stay on localhost. Under Docker
  only what is mounted is visible, mounted at the same path as on the host so exported file paths
  are the editing machine's.
- Moving a media file to another subfolder makes it look missing until relinked (the same-name
  suggestion makes that one click). Linked footage in a copied project folder needs the links to
  resolve on the new machine (relative links to a sibling folder keep working if the siblings come
  along).

## Alternatives considered

- **Keep a library root and scan it.** Rejected: a library is meaningless for portable projects,
  and any scan is either shallow (misses projects) or expensive (drives, symlinked trees).
- **A registry of projects.** Rejected: a second source of truth that goes stale when folders move
  and doesn't travel with the project; the recent list is a convenience, never required.
- **Library-relative media paths.** Rejected: break when a folder moves; media paths relative to
  the project folder are what makes it portable.
