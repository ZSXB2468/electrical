import {defineConfig} from 'vite';

export default defineConfig({
    root: './',
    base: './',
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: './index.html'
        }
    },
    server: {
        port: 10890,
        open: true
    }
});
