import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", // 容器外連得進來
    port: 5173,
    watch: {
      usePolling: true, // 容器掛載環境下熱更新才可靠
    },
    proxy: {
      // 開發時把 /api 轉給共用資料 API（本機跑 `node server/index.js`，
      // 或 docker compose 裡的 api 服務，用 API_PROXY_TARGET 覆寫目標）
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
