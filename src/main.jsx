import React from "react";
import ReactDOM from "react-dom/client";
import JojoLog from "./JojoLog.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <JojoLog />
  </React.StrictMode>
);

// PWA：註冊 service worker（推播與加入主畫面需要；http 區網環境會靜默失敗，不影響其他功能）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
