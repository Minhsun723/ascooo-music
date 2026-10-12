# Ascooo Music

Ascooo Music 是一個以 Cloudflare 與 PikPak 組成的私人音樂平台。

- `apps/web`：React + Vite，建置後作為 Worker Static Assets
- `apps/worker`：Hono API，處理同一網域下的 `/api/*`
- `wrangler.toml`：單一 Worker 的 Static Assets、D1 與自訂網域設定
- D1：歌曲索引、歌詞、收藏、播放紀錄與播放清單
- PikPak WebDAV：原始 M4A、MP3、FLAC 與同名 LRC 檔案

生產環境只有一個 Cloudflare Worker 專案：靜態檔案由 Worker Static Assets 直接傳送，API 則由同一個 Worker 執行。不需要 Pages 專案或 Pages Function 轉發層。

## Cloudflare 初次設定

安裝依賴並登入 Cloudflare：

```bash
npm install
npx wrangler login
```

建立 D1：

```bash
npx wrangler d1 create ascooo-music
```

將指令回傳的 `database_id` 填入專案根目錄的 `wrangler.toml`，再套用 migration：

```bash
npm run db:migrate:remote
```

`wrangler.toml` 已將自訂網域設為 `music.ascooo.com`。該網域必須在同一個 Cloudflare 帳戶中。

## PikPak WebDAV 設定

PikPak 的「Client-1」會提供帳號專用的統一接入點、WebDAV 使用者名稱、密碼，以及可能提供的 Bearer Token。本機開發時先複製專案根目錄的範例檔：

```bash
cp .dev.vars.example .dev.vars
```

再把實際值寫入 `.dev.vars`，不要寫入 `wrangler.toml` 或提交至 Git：

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

部署 Worker 時，請在專案根目錄分別設定 secrets：

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
`dev:api` 會先產生 Static Assets 需要的 `apps/web/dist`；之後前端修改由 Vite 即時更新。

若要在本機以單一 Worker 模式檢查建置後的前後端：

```bash
npm run dev:integrated
```

它會先建置 React，再由 `http://localhost:8787` 同時提供網頁與 API。

## 常用指令

```bash
npm run typecheck
npm run build
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` 會先建置 React，再將 `apps/web/dist`、Hono Worker 與 bindings 一次部署到 `music.ascooo.com`。

同步流程會掃描 WebDAV、讀取音訊標籤與歌詞、寫入 D1，最後清理已不存在的索引。

> Dolby Atmos 是否能呈現取決於音訊檔、瀏覽器、作業系統與實際播放裝置；平台會串流原始檔案，不宣稱對瀏覽器端做 Atmos 解碼。
