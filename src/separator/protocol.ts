/** Demucs htdemucs_6s exportado para ONNX (licença MIT) — baixado uma vez e guardado no aparelho. */
export const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx'
export const MODEL_CACHE = 'demucs-model-v1'

export interface WorkerIn {
  left: Float32Array
  right: Float32Array
  bitrate: number
}

export type Phase = 'model' | 'loading' | 'separating'

export type WorkerOut =
  | { type: 'progress'; phase: Phase; progress: number; detail?: string; eta?: number }
  | { type: 'backend'; threads: number }
  | { type: 'done'; files: Record<string, Blob>; stems: string[] }
  | { type: 'error'; message: string }

export async function isModelCached(): Promise<boolean> {
  if (!('caches' in window)) return false
  return !!(await (await caches.open(MODEL_CACHE)).match(MODEL_URL))
}

export async function deleteModel() {
  await caches.delete(MODEL_CACHE)
}
