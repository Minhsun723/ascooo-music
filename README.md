# Ascooo Music

Ascooo Music 是一個以 Cloudflare 與 PikPak 組成的私人音樂平台。

- `apps/web`：React + Vite，部署至 Cloudflare Pages
- `apps/worker`：Hono API，部署至 Cloudflare Workers
- D1：歌曲索引、歌詞、收藏、播放紀錄與播放清單
- PikPak WebDAV：原始 M4A、MP3、FLAC 與同名 LRC 檔案

## PikPak WebDAV 設定

PikPak 的「Client-1」會提供帳號專用的統一接入點、WebDAV 使用者名稱、密碼，以及可能提供的 Bearer Token。請把這些值放在 `apps/worker/.dev.vars`，不要寫入 `wrangler.toml` 或提交至 Git：

```dotenv
WEBDAV_URL=https://貼上-PikPak-顯示的完整統一接入點
MUSIC_ROOT=/Music
WEBDAV_USERNAME=貼上-Client-1-使用者名稱
WEBDAV_PASSWORD=貼上-Client-1-密碼
WEBDAV_BEARER_TOKEN=貼上-Bearer-Token
WEBDAV_AUTH_MODE=auto
JWT_SECRET=使用一組獨立且足夠長的隨機字串
```

`WEBDAV_AUTH_MODE` 支援：

- `auto`：建議值。先用 WebDAV 帳密（Basic），遇到 401 再改用 Bearer。
- `basic`：只使用 Client-1 使用者名稱與密碼。
- `bearer`：只使用 Bearer Token。

如果音樂就在接入點根目錄，將 `MUSIC_ROOT` 設為 `/`；如果放在 `Music` 資料夾則維持 `/Music`。Token 可接受純 token 或包含 `Bearer ` 前綴的完整值。

部署 Worker 時，請在 `apps/worker` 目錄分別設定 secrets：

```bash
npx wrangler secret put WEBDAV_URL
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
npx wrangler secret put WEBDAV_BEARER_TOKEN
npx wrangler secret put JWT_SECRET
```

## 本機開發

```bash
npm install
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

前端開發伺服器位於 `http://localhost:5173`，並會把 `/api` 代理到 `http://127.0.0.1:8787`。登入管理員帳號後，可在「設定」先檢查 PikPak 連線，再開始同步。

## 常用指令

```bash
npm run typecheck
npm run build -w apps/web
npm run db:migrate:remote
npm run deploy:api
npm run deploy:web
```

同步流程會掃描 WebDAV、讀取音訊標籤與歌詞、寫入 D1，最後清理已不存在的索引。

> Dolby Atmos 是否能呈現取決於音訊檔、瀏覽器、作業系統與實際播放裝置；平台會串流原始檔案，不宣稱對瀏覽器端做 Atmos 解碼。
