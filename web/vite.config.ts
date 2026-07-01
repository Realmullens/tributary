import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4110,
    proxy: {
      "/api": { target: "http://localhost:4100", changeOrigin: false },
      "/ws": { target: "ws://localhost:4100", ws: true },
    },
  },
});
