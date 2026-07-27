# 開發用 Dockerfile。正式部署見 README 的「正式版」段落。
FROM node:20-alpine

WORKDIR /app

# 先只複製依賴清單，利用 Docker 快取：package.json 沒變就不重裝
COPY package.json package-lock.json* ./
RUN npm install

# 原始碼在 compose 用 volume 掛載進來，這裡不 COPY，
# 這樣改檔案容器內立即看到（配合 vite 的 polling 做熱更新）。

EXPOSE 5173

CMD ["npm", "run", "dev"]
