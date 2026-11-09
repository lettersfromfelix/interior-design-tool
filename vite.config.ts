import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localFsApi } from "./server/localFsApi.ts";

export default defineConfig({
  plugins: [react(), localFsApi()],
  // data/, catalogue/ and layouts/ are served from the repository root; there is no public/ folder.
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5180,
    watch: { ignored: ["**/reference/**", "**/tools/floorplan/out/**", "**/layouts/.trash/**"] },
  },
  optimizeDeps: { entries: ["index.html"] },
});
