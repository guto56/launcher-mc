import { defineConfig } from 'vite';

// Em Tauri o frontend é servido a partir de arquivos estáticos dentro do binário,
// então usamos relative base e desativamos o servidor de dev (a webview conecta
// ao Tauri via IPC, não via HTTP).
export default defineConfig({
  root: 'src',
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2021',
  },
});
