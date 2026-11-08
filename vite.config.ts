import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    // Local check-in Worker (`npm run checkins:worker`) so /api and the session
    // cookie stay same-origin during `npm run dev`.
    proxy: {
      "/api": { target: "http://127.0.0.1:8787" },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
  },
  build: {
    target: "es2022",
  },
});
