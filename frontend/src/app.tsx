import { useEffect, useState } from "preact/hooks";

import { ProjectList } from "./components/ProjectList";
import { Workspace } from "./components/Workspace";

function currentSlug(): string | null {
  const match = /^#\/p\/([^/]+)/.exec(window.location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

export function App() {
  const [slug, setSlug] = useState(currentSlug());

  useEffect(() => {
    const onHash = () => setSlug(currentSlug());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div class="min-h-screen bg-neutral-950 text-neutral-200">
      {slug ? <Workspace key={slug} slug={slug} /> : <ProjectList />}
    </div>
  );
}
