import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'src/studio',
  base: './',
  plugins: [react()],
  build: { outDir: '../../build/renderer', emptyOutDir: true },
});
