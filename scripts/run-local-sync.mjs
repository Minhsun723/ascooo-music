import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ascooo-music-sync-'));
const output = join(temporaryDirectory, 'local-sync.mjs');

try {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./local-sync.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
  });
  await writeFile(output, result.outputFiles[0].contents);
  await import(pathToFileURL(output).href);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
