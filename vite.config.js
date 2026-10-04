import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le dossier dist/ peut être servi n'importe où (GitHub Pages, Netlify...).
  base: './',
  server: { host: true },
  // TensorFlow.js pèse environ 1,3 Mo minifié : c'est attendu.
  build: {
    chunkSizeWarningLimit: 2000,
    // Deux pages : Geste Live (accueil) et le Studio (8 modes, apprentissage, données).
    rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
