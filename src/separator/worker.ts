/// <reference lib="webworker" />
/**
 * Separa as faixas com o Demucs htdemucs_6s (ONNX) dentro do navegador e codifica cada uma em MP3.
 * Roda num Web Worker para não travar a interface.
 */
import { Mp3Encoder } from '@breezystack/lamejs'
import * as ort from 'onnxruntime-web'
import { MODEL_CACHE, MODEL_URL, type WorkerIn, type WorkerOut } from './protocol'

declare const self: DedicatedWorkerGlobalScope

const MODEL_SIZE = 136_428_532

// Saída do modelo, nesta ordem
const SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
const SEGMENT = 343_980 // 7,8 s a 44,1 kHz (tamanho fixo de entrada do modelo)
const OVERLAP = SEGMENT / 4
const STRIDE = SEGMENT - OVERLAP
const MP3_BLOCK = 1152 * 16

const post = (msg: WorkerOut) => self.postMessage(msg)

async function loadModel(): Promise<Uint8Array> {
  const cache = await caches.open(MODEL_CACHE)
  const cached = await cache.match(MODEL_URL)
  if (cached) {
    post({ type: 'progress', phase: 'loading', progress: 0 })
    return new Uint8Array(await cached.arrayBuffer())
  }
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o modelo de IA (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || MODEL_SIZE
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    post({ type: 'progress', phase: 'model', progress: received / total, detail: `${(received / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB` })
  }
  const blob = new Blob(chunks as BlobPart[])
  await cache.put(MODEL_URL, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }))
  return new Uint8Array(await blob.arrayBuffer())
}

function createSession(model: Uint8Array) {
  // Otimizações de grafo desligadas: com elas o WASM duplica os pesos e estoura a memória.
  return ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
  })
}

function fadeWindow(): Float32Array {
  const w = new Float32Array(SEGMENT).fill(1)
  for (let i = 0; i < OVERLAP; i++) {
    const v = i / (OVERLAP - 1)
    w[i] = v
    w[SEGMENT - 1 - i] = v
  }
  return w
}

class StemEncoder {
  private enc: Mp3Encoder
  private parts: Uint8Array[] = []
  private l = new Int16Array(MP3_BLOCK)
  private r = new Int16Array(MP3_BLOCK)

  constructor(bitrate: number) {
    this.enc = new Mp3Encoder(2, 44100, bitrate)
  }

  /** Recebe amostras float (-1..1), converte para 16 bits e codifica. */
  write(left: Float32Array, right: Float32Array) {
    for (let off = 0; off < left.length; off += MP3_BLOCK) {
      const n = Math.min(MP3_BLOCK, left.length - off)
      for (let i = 0; i < n; i++) {
        const a = left[off + i]
        const b = right[off + i]
        this.l[i] = (a > 1 ? 1 : a < -1 ? -1 : a) * 32767
        this.r[i] = (b > 1 ? 1 : b < -1 ? -1 : b) * 32767
      }
      const out = this.enc.encodeBuffer(this.l.subarray(0, n), this.r.subarray(0, n))
      if (out.length) this.parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice())
    }
  }

  finish(): Blob {
    const out = this.enc.flush()
    if (out.length) this.parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice())
    return new Blob(this.parts as BlobPart[], { type: 'audio/mpeg' })
  }
}

async function separate({ left, right, bitrate }: WorkerIn) {
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)) : 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = `${self.location.origin}/ort/`

  const model = await loadModel()
  post({ type: 'progress', phase: 'loading', progress: 0 })
  const session = await createSession(model)
  post({ type: 'backend', threads: ort.env.wasm.numThreads as number })

  const total = left.length
  const chunks = Math.max(1, Math.ceil(total / STRIDE))
  const win = fadeWindow()
  const input = new Float32Array(2 * SEGMENT)
  const acc = new Float32Array(SOURCES.length * 2 * SEGMENT) // soma ponderada a partir do início do bloco atual
  const weight = new Float32Array(SEGMENT)
  const encoders = Object.fromEntries([...SOURCES, 'original'].map((s) => [s, new StemEncoder(bitrate)]))
  const outL = new Float32Array(STRIDE)
  const outR = new Float32Array(STRIDE)
  const started = performance.now()

  for (let i = 0; i < chunks; i++) {
    const start = i * STRIDE
    const len = Math.min(SEGMENT, total - start)
    input.fill(0)
    input.set(left.subarray(start, start + len), 0)
    input.set(right.subarray(start, start + len), SEGMENT)

    const run = async () => {
      const tensor = new ort.Tensor('float32', input, [1, 2, SEGMENT])
      const result = await session.run({ mix: tensor })
      const data = (await result.stems.getData()) as Float32Array
      result.stems.dispose()
      return data
    }
    const stems = await run()

    for (let row = 0; row < SOURCES.length * 2; row++) {
      const base = row * SEGMENT
      for (let k = 0; k < len; k++) acc[base + k] += stems[base + k] * win[k]
    }
    for (let k = 0; k < len; k++) weight[k] += win[k]

    // As amostras antes do início do próximo bloco já estão completas: normaliza e codifica
    const last = i === chunks - 1
    const emit = last ? len : STRIDE
    SOURCES.forEach((name, s) => {
      const bl = s * 2 * SEGMENT
      const br = bl + SEGMENT
      for (let k = 0; k < emit; k++) {
        const w = weight[k] > 1e-8 ? weight[k] : 1e-8
        outL[k] = acc[bl + k] / w
        outR[k] = acc[br + k] / w
      }
      encoders[name].write(outL.subarray(0, emit), outR.subarray(0, emit))
    })
    encoders.original.write(left.subarray(start, start + emit), right.subarray(start, start + emit))

    // desloca a sobreposição para o começo do acumulador
    for (let row = 0; row < SOURCES.length * 2; row++) {
      const base = row * SEGMENT
      acc.copyWithin(base, base + STRIDE, base + SEGMENT)
      acc.fill(0, base + OVERLAP, base + SEGMENT)
    }
    weight.copyWithin(0, STRIDE, SEGMENT)
    weight.fill(0, OVERLAP)

    const elapsed = (performance.now() - started) / 1000
    post({
      type: 'progress',
      phase: 'separating',
      progress: (i + 1) / chunks,
      eta: (elapsed / (i + 1)) * (chunks - i - 1),
    })
  }

  await session.release()
  const files = Object.fromEntries(Object.entries(encoders).map(([name, enc]) => [name, enc.finish()]))
  post({ type: 'done', files, stems: SOURCES })
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  post({
    type: 'error',
    message: /bad_alloc|memory|Out of memory/i.test(message)
      ? 'Memória insuficiente neste aparelho para separar a música. Tente num computador ou feche outras abas.'
      : message,
  })
}

// erros que escapam do ONNX Runtime não podem deixar a fila esperando para sempre
self.onunhandledrejection = (e) => fail(e.reason)
self.onmessage = (e: MessageEvent<WorkerIn>) => {
  separate(e.data).catch(fail)
}
