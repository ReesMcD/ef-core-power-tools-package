import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web UI is served by efcpt-ui's local server from dist/web
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
});
