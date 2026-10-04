import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le dossier dist/ peut être servi n'importe où (GitHub Pages, Netlify...).
  base: './',
  server: { host: true },
  // TensorFlow.js pèse environ 1,3 Mo minifié : c'est attendu.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
