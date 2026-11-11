import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 4000, reportCompressedSize: false },
  server: { port: 5173 },
});
