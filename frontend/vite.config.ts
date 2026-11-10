/// <reference types="vitest/config" />
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    // The SPA talks to /api/*; strip the prefix on the way to the backend (nginx does the
    // same in production).
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
