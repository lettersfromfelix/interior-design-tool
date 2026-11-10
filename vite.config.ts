import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localFsApi } from "./server/localFsApi.ts";
import { staticSite } from "./server/staticSite.ts";

export default defineConfig(({ command, isPreview }) => ({
  // the website lives at https://<user>.github.io/interior-design-tool/; locally (npm start) the app is at the root
  base: command === "build" || isPreview ? (process.env.SITE_BASE ?? "/interior-design-tool/") : "/",
  plugins: [react(), localFsApi(), staticSite()],
  // data/, catalogue/ and layouts/ are served from the repository root (the build copies them); there is no public/ folder.
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5180,
    watch: { ignored: ["**/reference/**", "**/tools/floorplan/out/**", "**/layouts/.trash/**"] },
  },
  preview: { host: "127.0.0.1", port: 5181 },
  build: { chunkSizeWarningLimit: 1500 }, // three.js is one large chunk; it is cached after the first visit
  optimizeDeps: { entries: ["index.html"] },
}));
