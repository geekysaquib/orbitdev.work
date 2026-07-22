import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Playwright's trace/screenshot output (.playwright-artifacts) and raw
    // test JSON (test-results) live inside the project root — without this,
    // every file Playwright writes during an E2E run triggers a Vite page
    // reload, and a heavy run can destabilize (even crash) the dev server.
    watch: { ignored: ["**/.playwright-artifacts/**", "**/test-results/**"] },
  },
});
