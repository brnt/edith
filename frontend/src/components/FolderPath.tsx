const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;
const dirname = (path: string) => path.replace(/\/+$/, "").split("/").slice(0, -1).join("/");

/** A folder's absolute path, shortened from the left: the parents give way, its own name stays. */
export function FolderPath({ path, class: cls = "" }: { path: string; class?: string }) {
  return (
    <div class={`flex min-w-0 font-mono text-xs text-neutral-500 ${cls}`} title={path}>
      <span class="min-w-0 truncate text-neutral-600">{dirname(path)}/</span>
      <span class="shrink-0 text-neutral-400">{basename(path)}</span>
    </div>
  );
}
