import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // The collector writes results and recordings here every few seconds; watching them reloads the page.
    // Only this project's data folder: the project itself lives under /data, so a bare **/data/** glob would ignore everything.
    watch: { ignored: [fileURLToPath(new URL('./data/**', import.meta.url))] },
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  build: {
    target: 'es2022', sourcemap: true,
    /*
     * Três documentos, um aplicativo: a TV na raiz, a Corrida e o Território.
     *
     * Eram cinco. A Visão geral e o Pelotão respondiam perguntas que a TV e a Corrida já
     * respondem melhor — e o Pelotão custava 540 KB de three.js para desenhar em pedestais o que
     * a tabela diz em números exatos. Cada tela que restou tem uma pergunta só dela: como está
     * tudo agora, como chegou até aqui, e onde.
     */
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      corrida: fileURLToPath(new URL('./corrida.html', import.meta.url)),
      territorio: fileURLToPath(new URL('./territorio.html', import.meta.url)),
    } },
  },
});
