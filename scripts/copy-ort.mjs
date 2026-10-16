// Copia o runtime do ONNX Runtime Web para public/ort (servido pelo próprio site e guardado offline pelo PWA).
import { copyFileSync, mkdirSync } from 'node:fs'

const files = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']
mkdirSync('public/ort', { recursive: true })
for (const f of files) copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/ort/${f}`)
console.log('onnxruntime-web copiado para public/ort')
