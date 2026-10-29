/**
 * Rebuild tracks/albums/artists.search_key for existing rows. The Worker keeps
 * keys current on every write; run this once after migration 0010, or again
 * after changing the rules in apps/worker/src/lib/search.ts.
 *
 *   npm run db:search-keys -- --remote
 *   npm run db:search-keys -- --local
 *
 * Only rows whose key actually changes are written.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { artistSearchKey, parseAliases, searchKey, trackSearchKey } from '../apps/worker/src/lib/search.ts';

const target = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null;
if (!target) {
  console.error('請指定 --remote 或 --local');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

function d1(args: string[]): string {
  return execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ascooo-music', target!, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function query<T>(sql: string): T[] {
  const output = d1(['--json', '--command', sql]);
  return (JSON.parse(output.slice(output.indexOf('['))) as { results: T[] }[])[0].results;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const updates: string[] = [];

type TrackRow = { id: number; title: string; display_title: string | null; artist: string | null; display_artist: string | null; search_key: string | null };
for (const t of query<TrackRow>('SELECT id, title, display_title, artist, display_artist, search_key FROM tracks')) {
  const key = trackSearchKey({ title: t.title, displayTitle: t.display_title, artist: t.artist, displayArtist: t.display_artist });
  if (key !== t.search_key) updates.push(`UPDATE tracks SET search_key = ${quote(key)} WHERE id = ${t.id};`);
}

type AlbumRow = { id: number; title: string; search_key: string | null };
for (const a of query<AlbumRow>('SELECT id, title, search_key FROM albums')) {
  const key = searchKey(a.title);
  if (key !== a.search_key) updates.push(`UPDATE albums SET search_key = ${quote(key)} WHERE id = ${a.id};`);
}

type ArtistRow = { id: number; name: string; display_name: string | null; aliases: string | null; search_key: string | null };
for (const a of query<ArtistRow>('SELECT id, name, display_name, aliases, search_key FROM artists')) {
  const key = artistSearchKey(a.name, a.display_name, parseAliases(a.aliases));
  if (key !== a.search_key) updates.push(`UPDATE artists SET search_key = ${quote(key)} WHERE id = ${a.id};`);
}

if (!updates.length) {
  console.log('搜尋索引已是最新，不需要更新。');
  process.exit(0);
}

const cache = fileURLToPath(new URL('../.sync-cache/', import.meta.url));
mkdirSync(cache, { recursive: true });
const file = `${cache}search-keys.sql`;
writeFileSync(file, updates.join('\n') + '\n');
d1(['--yes', '--file', file]);
console.log(`已更新 ${updates.length} 筆搜尋索引。`);
