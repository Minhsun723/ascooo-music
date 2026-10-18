# Ascooo Music

Ascooo Music 是一個以 Cloudflare 與 PikPak 組成的私人音樂平台。

- `apps/web`：React + Vite，建置後作為 Worker Static Assets
- `apps/worker`：Hono API，處理同一網域下的 `/api/*`
- `wrangler.toml`：單一 Worker 的 Static Assets、D1 與自訂網域設定
- D1：歌曲索引、歌詞、收藏、播放紀錄與播放清單
- R2：本機壓縮後的 512 px／2000 px WebP 封面
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

建立封面使用的 R2 bucket（名稱已對應 `wrangler.toml`）：

```bash
npx wrangler r2 bucket create ascooo-music-artwork
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
SYNC_PARSE_CONCURRENCY=1

# Apple Music 只在本機同步階段使用
APPLE_MUSIC_ENABLED=true
APPLE_MUSIC_USER_TOKEN=你的-media-user-token
APPLE_MUSIC_STOREFRONT=jp
APPLE_MUSIC_LYRICS_STOREFRONT=tw
APPLE_MUSIC_LANGUAGE=ja-JP
APPLE_MUSIC_LYRICS_PATH=/ascooo-music/lyrics
APPLE_MUSIC_REFRESH_DAYS=90
```

`APPLE_MUSIC_USER_TOKEN` 必須來自你本人已登入且具有有效訂閱的 Apple Music 網頁工作階段。在瀏覽器開發者工具的 Network 面板播放一首歌或開啟歌詞，從 `amp-api.music.apple.com` 請求中複製 `media-user-token` 標頭值。它等同敏感的帳號工作階段憑證，只能放在已被 Git 忽略的 `.dev.vars`，不要放進 Worker secrets、D1、PikPak 或提交到 Git。公開的開發者 Bearer Token 預設會由同步器自動從 Apple Music 網頁取得；只有自動取得失效時才需要設定 `APPLE_MUSIC_DEVELOPER_TOKEN`。

歌詞使用的是 Apple Music 網頁播放器的未公開端點，沒有穩定性保證；同步器因此把它限制在本機、允許失敗降級，並以 PikPak 中既有的 TTML 作為後續同步來源。請只對自己的訂閱與私人音樂庫使用，公開提供歌詞前仍需自行確認授權。

同步器以日本 storefront 搜尋歌曲，並用歌曲時長、ISRC（音檔有提供時）、歌名、藝人與版本標記評分。只有 Apple 將歌曲標記為日文，且原始欄位是拉丁字母、日文結果包含日文文字時，才會套用日文顯示名稱；英文歌曲與原本已是中文／日文的名稱會保留。`APPLE_MUSIC_LYRICS_STOREFRONT` 則要設成 Apple Music 訂閱帳號的區域（台灣帳號使用 `tw`），與用來日文化名稱的 `jp` 分開。原始音檔標籤不會被修改。

部署含匯入 API 的最新版 Worker 後，在專案根目錄執行：

```bash
npm run sync:local
```

這個指令會依序：

1. 在本機並行掃描 PikPak WebDAV，解析新增或變動的音訊標籤、歌詞與封面。
2. 以 Apple Music 日本目錄配對歌曲，補上日文顯示名稱與藝人照片；配對結果只快取在本機及必要的 D1 欄位。
3. 使用你的訂閱 Token 取得 TTML。原始檔會以訂閱 storefront 的 Apple Music song ID 命名並寫入 PikPak `/ascooo-music/lyrics`，例如 `1446781787.ttml`；已存在的 TTML 會直接重用，同一輪有多首歌曲配到相同 ID 時也只會讀取或下載一次。
4. 專輯封面由 Sharp 產生 512 px 與 2000 px WebP；Apple CDN 已提供 WebP 的藝人照片則直接保存，只有 CDN 未回傳 WebP 時才轉檔。
5. 將完整結果寫到被 Git 忽略的 `.sync-cache/library.json`。
6. 登入部署站台，將圖片上傳到 R2、逐首寫入 D1 中繼資料及歌詞副本。
7. 所有歌曲上傳完成後，才清理由 PikPak 移除的遠端索引。

本機準備或上傳中斷都不會先清空線上音樂庫；重跑上傳具有冪等性。也可以分兩段執行：

```bash
npm run sync:local -- --prepare-only
npm run sync:local -- --upload-only
```

上傳遇到 `429` 或 `5xx` 會自動退避重試最多五次。同步會保留既有歌曲 ID、顯示／隱藏狀態、收藏、播放紀錄及播放清單。
解析預設一次處理 1 首，避免 PikPak 在密集 Range 請求時暫時回傳 404。`SYNC_PARSE_CONCURRENCY` 可設為 `1` 到 `8`，但使用 PikPak 時建議維持 `1`；若提高後出現 `404`、`429` 或 `503`，請立即降回 `1`。第二次以後會依音訊、LRC／TTML 與資料夾封面的簽章沿用未變動歌曲，不再重讀其音訊內容。Apple 配對預設 90 天才重新確認一次；修改 `APPLE_MUSIC_REFRESH_DAYS` 可調整週期。

網站不會在播放期間呼叫 Apple Music。D1 仍維持每首歌曲一筆中繼資料與一筆可選歌詞，藝人照片本體放在 R2，完整 Apple 配對結果保留在本機同步快取，因此不會為每次播放增加 D1 寫入。TTML 在前端解析，可顯示逐行及逐字／音節高亮；同名的本地 `.ttml` 仍優先於自動下載結果，接著才是 `.lrc` 與音檔內嵌歌詞。

封面網址帶有轉檔版本，Worker 會先讀 Cloudflare Edge Cache，再讀 R2；清單、播放列與網格共用 512 px，專輯主視覺與全螢幕播放使用 2000 px。內容雜湊相同的封面只會保存一組。從舊版同步快取第一次升級時會重新解析一次，之後恢復增量同步。

> Dolby Atmos 是否能呈現取決於音訊檔、瀏覽器、作業系統與實際播放裝置；平台會串流原始檔案，不宣稱對瀏覽器端做 Atmos 解碼。

### AAC 5.1 替代版本

Chrome、Firefox 等瀏覽器無法解碼 Dolby Atmos（EC-3）。可以把轉好的 AAC 5.1 檔案平放在 PikPak 的 `AAC51_ROOT`（預設 `/ascooo-music/Music-Transcode/aac51`），檔名必須與 `/Music` 中的原始檔完全相同，例如：

```
/Music/Korea/01. Pink Venom.m4a                       ← Dolby Atmos 原始檔
/ascooo-music/Music-Transcode/aac51/01. Pink Venom.m4a ← AAC 5.1
```

本機同步會依檔名（不分大小寫）把 AAC 5.1 掛到原始歌曲上，網頁仍只顯示一首歌，歌詞、封面、收藏與播放紀錄共用。播放時依設定頁的「環繞音效」選擇版本：「自動」在瀏覽器支援 EC-3 時播放杜比，否則播放 AAC 5.1；杜比版本解碼失敗時也會自動改播 AAC 5.1 並接續原本的進度。若 `/Music` 中有兩首歌檔名相同，或 AAC 資料夾中有檔案找不到原始檔，同步時會列出警告並略過配對。

轉檔範例（保留標籤與封面）：

```bash
ffmpeg -i in.m4a -map 0:a -map 0:v? -c copy -c:a aac -b:a 448k -map_metadata 0 -disposition:v attached_pic -movflags +faststart out.m4a
```
