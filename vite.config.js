import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: './index.html'  // 以 index.html 作为入口点，而不是 index.ts
    }
  },
  server: {
    port: 10890,
    open: true
  }
});
