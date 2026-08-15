# 共用資料 API + Web Push。node:sqlite 是 Node 24 內建；web-push 處理推播加密。
FROM node:24-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/index.js .
ENV DB_PATH=/data/jojo.db
EXPOSE 8787
CMD ["node", "index.js"]
