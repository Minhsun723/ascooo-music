// Mirror the deployed library into the local `wrangler dev` state: the remote
// D1 database replaces the local one, and every album cover and artist photo
// it references is copied from the deployed site into the local R2 bucket.
// A new machine can then develop against the full library without scanning
// PikPak again.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { getPlatformProxy } from 'wrangler';

const DATABASE = 'ascooo-music';
const ARTWORK_ASSET_VERSION = 'v1';
const ARTWORK_SIZES = [512, 2000];
const DOWNLOAD_CONCURRENCY = 8;
const projectRoot = process.cwd();
const exportFile = resolve(projectRoot, '.sync-cache/remote-d1.sql');
const localD1State = resolve(projectRoot, '.wrangler/state/v3/d1');
const artworkOnly = process.argv.includes('--artwork-only');
const databaseOnly = process.argv.includes('--db-only');

try {
  process.loadEnvFile(resolve(projectRoot, '.dev.vars'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const remoteUrl = (process.env.SYNC_TARGET_URL?.trim() || 'https://music.ascooo.com').replace(/\/+$/, '');
const devUrl = (process.env.DEV_SYNC_TARGET_URL?.trim() || 'http://127.0.0.1:8787').replace(/\/+$/, '');

function wrangler(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`wrangler ${args[0]} ${args[1]} 失敗（exit ${code}）`)));
  });
}

async function devServerRunning() {
  try {
    await fetch(`${devUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function pullDatabase() {
  await mkdir(resolve(projectRoot, '.sync-cache'), { recursive: true });
  console.log(`匯出遠端 D1（${DATABASE}）…`);
  await wrangler(['d1', 'export', DATABASE, '--remote', '--output', exportFile]);
  // The export carries the schema and d1_migrations, so the local database is
  // rebuilt from scratch instead of applying it over local tables. The previous
  // local state is kept as d1.bak until the next pull.
  console.log('備份本機 D1 至 .wrangler/state/v3/d1.bak 並匯入…');
  await rm(`${localD1State}.bak`, { recursive: true, force: true });
  await rename(localD1State, `${localD1State}.bak`).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await wrangler(['d1', 'execute', DATABASE, '--local', '--file', exportFile]);
}

async function fetchArtwork(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status === 404) return null;
    if (attempt >= 5 || ![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${url} 回傳 HTTP ${response.status}`);
    }
    await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
  }
}

async function pullArtwork() {
  const { env, dispose } = await getPlatformProxy({ persist: true });
  try {
    const { results } = await env.DB.prepare(`
      SELECT id FROM artworks
      UNION SELECT artwork_id FROM tracks WHERE artwork_id IS NOT NULL
      UNION SELECT artwork_id FROM albums WHERE artwork_id IS NOT NULL
      UNION SELECT artwork_id FROM artists WHERE artwork_id IS NOT NULL
      UNION SELECT logo_artwork_id FROM artists WHERE logo_artwork_id IS NOT NULL
    `).all();
    const ids = results.map((row) => row.id).filter((id) => /^[a-f0-9]{40}$/.test(id));
    const jobs = ids.flatMap((id) => ARTWORK_SIZES.map((size) => ({ id, size, key: `art/${ARTWORK_ASSET_VERSION}/${id}/${size}.webp` })));
    console.log(`檢查 ${ids.length} 張圖片（${jobs.length} 個 R2 物件）…`);

    let copied = 0;
    let present = 0;
    const missing = [];
    let next = 0;
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (await env.ARTWORK.head(job.key)) {
          present++;
          continue;
        }
        const data = await fetchArtwork(`${remoteUrl}/api/art/${job.id}/${job.size}`);
        if (!data) {
          missing.push(job.key);
          continue;
        }
        const { width, height } = await sharp(data).metadata();
        await env.ARTWORK.put(job.key, data, {
          httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: {
            artworkId: job.id,
            checksum: createHash('sha256').update(data).digest('hex'),
            width: String(width ?? 0),
            height: String(height ?? 0),
          },
        });
        copied++;
        if (copied % 100 === 0) console.log(`  已下載 ${copied} 個…`);
      }
    }));
    console.log(`封面完成：新下載 ${copied}、本機已有 ${present}、遠端缺少 ${missing.length}`);
    for (const key of missing.slice(0, 20)) console.warn(`  遠端 R2 沒有 ${key}`);
  } finally {
    await dispose();
  }
}

if (!artworkOnly && await devServerRunning()) {
  console.error(`偵測到 ${devUrl} 上的 wrangler dev 仍在執行，請先停止它再重建本機 D1。`);
  process.exit(1);
}
if (!artworkOnly) await pullDatabase();
if (!databaseOnly) await pullArtwork();
console.log('本機音樂庫已與遠端同步。');
