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

前端開發伺服器位於 `http://localhost:5173`，並會把 `/api` 代理到 `http://127.0.0.1:8787`。
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

## 本機優先同步

同步不再要求線上 Worker 從 PikPak 讀取及解析整首音訊。先在 `.dev.vars` 填入本機 WebDAV 設定與部署站台的管理員登入資料：

```dotenv
SYNC_TARGET_URL=https://music.ascooo.com
SYNC_ADMIN_USERNAME=管理員帳號
SYNC_ADMIN_PASSWORD=管理員密碼
SYNC_PARSE_CONCURRENCY=4
```

部署含匯入 API 的最新版 Worker 後，在專案根目錄執行：

```bash
npm run sync:local
```

這個指令會依序：

1. 在本機並行掃描 PikPak WebDAV，解析新增或變動的音訊標籤、歌詞與封面。
2. 將完整結果寫到被 Git 忽略的 `.sync-cache/library.json`。
3. 登入部署站台，逐張上傳封面、逐首寫入中繼資料。
4. 所有歌曲上傳完成後，才清理由 PikPak 移除的遠端索引。

本機準備或上傳中斷都不會先清空線上音樂庫；重跑上傳具有冪等性。也可以分兩段執行：

```bash
npm run sync:local -- --prepare-only
npm run sync:local -- --upload-only
```

上傳遇到 `429` 或 `5xx` 會自動退避重試最多五次。同步會保留既有歌曲 ID、顯示／隱藏狀態、收藏、播放紀錄及播放清單。
解析預設同時處理 4 首，`SYNC_PARSE_CONCURRENCY` 可設為 `1` 到 `8`；網路穩定時可提高到 `6` 或 `8`，若 PikPak 開始回應 `429`／`503` 則調低。第二次以後會依音訊、LRC 與資料夾封面的簽章沿用未變動歌曲，不再重讀其音訊內容。

> Dolby Atmos 是否能呈現取決於音訊檔、瀏覽器、作業系統與實際播放裝置；平台會串流原始檔案，不宣稱對瀏覽器端做 Atmos 解碼。
