import { defineConfig } from 'vite';

export default defineConfig({
  base: '/library-buddy/', // GitHub Pages repo path
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 3000
  }
});
