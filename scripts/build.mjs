import { build } from 'esbuild';
await build({
  entryPoints: ['src/desktop/main.ts'],
  outfile: 'build/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'chokidar', 'pdf-parse'],
});
await build({
  entryPoints: ['src/desktop/preload.ts'],
  outfile: 'build/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
