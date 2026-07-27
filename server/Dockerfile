# 共用資料 API：零 npm 依賴（node:sqlite 是 Node 24 內建），
# 不用 npm install、不用編譯原生模組，ARM64（Pi 5）直接可用。
FROM node:24-alpine
WORKDIR /app
COPY server/index.js .
ENV DB_PATH=/data/jojo.db
EXPOSE 8787
CMD ["node", "index.js"]
