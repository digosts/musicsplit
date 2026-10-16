import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Isolamento entre origens: libera SharedArrayBuffer para a IA usar vários núcleos da CPU
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Stems Studio',
        short_name: 'Stems',
        description: 'Separe as faixas de qualquer música para estudar',
        lang: 'pt-BR',
        theme_color: '#12121a',
        background_color: '#12121a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // o áudio fica no IndexedDB e o modelo no Cache Storage; aqui só o app e o runtime da IA (.wasm)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest,wasm}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    // versão do ONNX Runtime que carrega o runtime (.mjs/.wasm) de /ort/ — necessária para as threads funcionarem
    alias: [{ find: /^onnxruntime-web$/, replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)) }],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { headers: isolation },
  preview: { headers: isolation },
})
