import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
export default defineConfig({
  root: 'src/studio',
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    ),
  },
  build: { outDir: '../../build/renderer', emptyOutDir: true },
});
