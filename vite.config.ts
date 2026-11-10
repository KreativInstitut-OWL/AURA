// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// DRAFT ONLY — build timestamp badge, remove before merging.
// Rewrites src/lib/build-time.ts on server start, production build and every source change.
const BUILD_TIME_FILE = resolve(__dirname, "src/lib/build-time.ts");
function stampBuildTime() {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const next = `// DRAFT ONLY — auto-generated, remove before merging.\nexport const BUILD_TIME = ${JSON.stringify(ts)};\n`;
  let prev = "";
  try { prev = readFileSync(BUILD_TIME_FILE, "utf8"); } catch {}
  if (prev !== next) writeFileSync(BUILD_TIME_FILE, next);
}
stampBuildTime();
const buildTimePlugin = {
  name: "draft-build-time",
  buildStart() { stampBuildTime(); },
  watchChange(id: string) {
    if (id.includes("/src/") && !id.endsWith("build-time.ts")) stampBuildTime();
  },
  configureServer(server: { watcher: { on: (e: string, cb: (f: string) => void) => void } }) {
    server.watcher.on("change", (f) => {
      if (f.includes("/src/") && !f.endsWith("build-time.ts") && !f.endsWith("routeTree.gen.ts")) stampBuildTime();
    });
  },
};

export default defineConfig({
  vite: { plugins: [buildTimePlugin] },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
