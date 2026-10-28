import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev, the browser talks to :5173 and Vite forwards /api/* to the backend.
    // Same origin => no CORS problems, and no backend URL hard-coded in the UI code.
    // Order matters: the more specific /api/v1/ai goes to the Python AI service, everything else to the Node API.
    proxy: {
      "/api/v1/ai": "http://localhost:8000",
      "/api": "http://localhost:4000",
    },
  },
});
