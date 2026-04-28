import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        timeout: 600000,
        proxyTimeout: 600000,
      },
      "/uploads": "http://localhost:8001",
    },
  },
});
