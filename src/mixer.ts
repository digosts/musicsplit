import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from './types'

export interface StemState {
  volume: number // 0..1.5
  muted: boolean
  solo: boolean
  pan: number // -1..1
}

export interface LoopState {
  enabled: boolean
  a: number | null
  b: number | null
}

interface Channel {
  name: string
  el: HTMLAudioElement
  gain: GainNode
  pan: StereoPannerNode
}

let sharedCtx: AudioContext | null = null
const getCtx = () => (sharedCtx ??= new AudioContext({ latencyHint: 'playback' }))

const READY = HTMLMediaElement.HAVE_FUTURE_DATA

/**
 * Toca várias faixas (<audio>) em sincronia, cada uma com seu ganho e pan no Web Audio.
 * Usar <audio> em vez de AudioBuffer mantém o consumo de memória baixo e permite
 * mudar a velocidade sem alterar o tom (preservesPitch).
 */
class MixEngine {
  readonly channels: Channel[]
  readonly master: GainNode
  private rate = 1
  private wantPlaying = false
  private timer: number
  private tickCount = 0
  loop: LoopState = { enabled: false, a: null, b: null }
  onState: () => void = () => {}
  onEnded: () => void = () => {}
  buffering = false

  constructor(sources: Record<string, string>) {
    const ctx = getCtx()
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.channels = Object.entries(sources).map(([name, url]) => {
      const el = new Audio()
      el.preload = 'auto'
      el.preservesPitch = true
      el.src = url
      const gain = ctx.createGain()
      const pan = ctx.createStereoPanner()
      ctx.createMediaElementSource(el).connect(gain).connect(pan).connect(this.master)
      el.addEventListener('waiting', this.handleWaiting)
      el.addEventListener('canplay', this.handleCanPlay)
      el.addEventListener('loadedmetadata', () => this.onState())
      return { name, el, gain, pan }
    })
    this.channels[0].el.addEventListener('ended', () => {
      this.wantPlaying = false
      this.pauseAll()
      this.onState()
      this.onEnded()
    })
    this.timer = window.setInterval(this.tick, 40)
  }

  get ref() {
    return this.channels[0].el
  }
  get time() {
    return this.ref.currentTime
  }
  get duration() {
    return this.ref.duration || 0
  }
  get playing() {
    return this.wantPlaying
  }
  get loadedCount() {
    return this.channels.filter((c) => c.el.readyState >= READY).length
  }

  private allReady = () => this.channels.every((c) => c.el.readyState >= READY)

  private pauseAll() {
    this.channels.forEach((c) => c.el.pause())
  }

  private handleWaiting = () => {
    if (!this.wantPlaying) return
    this.buffering = true
    this.pauseAll()
    this.onState()
  }

  private handleCanPlay = () => {
    this.onState()
    if (this.wantPlaying && this.buffering && this.allReady()) void this.startAll()
  }

  private async startAll() {
    if (!this.allReady()) {
      this.buffering = true
      this.onState()
      return
    }
    this.buffering = false
    const t = this.time
    this.channels.forEach((c) => {
      if (Math.abs(c.el.currentTime - t) > 0.02) c.el.currentTime = t
      c.el.playbackRate = this.rate
    })
    try {
      await Promise.all(this.channels.map((c) => c.el.play()))
    } catch (err) {
      console.warn(err)
    }
    this.onState()
  }

  async play() {
    await getCtx().resume()
    if (this.ref.ended) this.seek(0)
    this.wantPlaying = true
    await this.startAll()
  }

  pause() {
    this.wantPlaying = false
    this.buffering = false
    this.pauseAll()
    this.onState()
  }

  seek(t: number) {
    const time = Math.min(Math.max(0, t), this.duration || t)
    this.channels.forEach((c) => (c.el.currentTime = time))
    this.onState()
  }

  setRate(rate: number) {
    this.rate = rate
    this.channels.forEach((c) => (c.el.playbackRate = rate))
  }

  setGain(name: string, value: number) {
    const c = this.channels.find((ch) => ch.name === name)
    c?.gain.gain.setTargetAtTime(value, getCtx().currentTime, 0.015)
  }

  setPan(name: string, value: number) {
    const c = this.channels.find((ch) => ch.name === name)
    c?.pan.pan.setTargetAtTime(value, getCtx().currentTime, 0.015)
  }

  setMaster(value: number) {
    this.master.gain.setTargetAtTime(value, getCtx().currentTime, 0.015)
  }

  private tick = () => {
    if (!this.wantPlaying || this.buffering) return
    const { enabled, a, b } = this.loop
    if (enabled && a != null && b != null && b > a && this.time >= b) {
      this.seek(a)
      return
    }
    // Correção de deriva: ajusta levemente a velocidade de cada faixa em relação à de referência.
    if (++this.tickCount % 3 !== 0) return
    const t = this.time
    for (const c of this.channels.slice(1)) {
      const diff = c.el.currentTime - t
      if (Math.abs(diff) > 0.25) c.el.currentTime = t
      else if (Math.abs(diff) > 0.012) c.el.playbackRate = this.rate * (1 - Math.max(-0.05, Math.min(0.05, diff)))
      else if (c.el.playbackRate !== this.rate) c.el.playbackRate = this.rate
    }
  }

  destroy() {
    window.clearInterval(this.timer)
    this.wantPlaying = false
    this.channels.forEach((c) => {
      c.el.pause()
      c.el.removeAttribute('src')
      c.el.load()
      c.gain.disconnect()
      c.pan.disconnect()
    })
    this.master.disconnect()
  }
}

// ------------------------------------------------------------------ hook

const ORIGINAL = 'original'
const defaultStem = (): StemState => ({ volume: 1, muted: false, solo: false, pan: 0 })

function loadMix(track: Track): Record<string, StemState> {
  let saved: Record<string, StemState> = {}
  try {
    saved = JSON.parse(localStorage.getItem(`mix:${track.id}`) ?? '{}')
  } catch {
    /* sem mix salvo */
  }
  return Object.fromEntries(track.stems.map((s) => [s, { ...defaultStem(), ...saved[s] }]))
}

export function useMixer(track: Track | null, urls: Record<string, string> | null, onEnded: () => void) {
  const engineRef = useRef<MixEngine | null>(null)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])
  const [time, setTime] = useState(0)
  const [stems, setStems] = useState<Record<string, StemState>>({})
  const [master, setMasterState] = useState(1)
  const [rate, setRateState] = useState(1)
  const [original, setOriginal] = useState(false)
  const [loop, setLoopState] = useState<LoopState>({ enabled: false, a: null, b: null })
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  // cria o motor quando a música muda
  useEffect(() => {
    if (!track || !urls) return
    // a faixa de referência (relógio) é a primeira; o original entra por último
    const ordered = Object.fromEntries([...track.stems, ORIGINAL].filter((n) => urls[n]).map((n) => [n, urls[n]]))
    const engine = new MixEngine(ordered)
    engine.onState = rerender
    engine.onEnded = () => onEndedRef.current()
    engineRef.current = engine
    setStems(loadMix(track))
    setTime(0)
    setOriginal(false)
    setLoopState({ enabled: false, a: null, b: null })
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [track, urls, rerender])

  // relógio da interface
  useEffect(() => {
    let raf = 0
    const loopFn = () => {
      if (engineRef.current) setTime(engineRef.current.time)
      raf = requestAnimationFrame(loopFn)
    }
    raf = requestAnimationFrame(loopFn)
    return () => cancelAnimationFrame(raf)
  }, [])

  // aplica ganhos (volume / mute / solo / original)
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !track) return
    const anySolo = Object.values(stems).some((s) => s.solo)
    for (const name of track.stems) {
      const s = stems[name]
      if (!s) continue
      const audible = !original && !s.muted && (!anySolo || s.solo)
      engine.setGain(name, audible ? s.volume : 0)
      engine.setPan(name, s.pan)
    }
    engine.setGain(ORIGINAL, original ? 1 : 0)
    if (Object.keys(stems).length) localStorage.setItem(`mix:${track.id}`, JSON.stringify(stems))
  }, [stems, original, track, urls])

  useEffect(() => engineRef.current?.setMaster(master), [master, urls])
  useEffect(() => engineRef.current?.setRate(rate), [rate, urls])
  useEffect(() => {
    if (engineRef.current) engineRef.current.loop = loop
  }, [loop, urls])

  const engine = engineRef.current
  const updateStem = useCallback(
    (name: string, patch: Partial<StemState>) => setStems((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } })),
    [],
  )

  return {
    ready: !!engine && engine.loadedCount === engine.channels.length,
    loaded: engine?.loadedCount ?? 0,
    total: engine?.channels.length ?? 0,
    playing: engine?.playing ?? false,
    buffering: engine?.buffering ?? false,
    time,
    duration: engine?.duration ?? track?.duration ?? 0,
    stems,
    master,
    rate,
    original,
    loop,
    play: () => engineRef.current?.play(),
    pause: () => engineRef.current?.pause(),
    toggle: () => (engineRef.current?.playing ? engineRef.current.pause() : engineRef.current?.play()),
    seek: (t: number) => {
      engineRef.current?.seek(t)
      setTime(t)
    },
    updateStem,
    resetMix: () => track && setStems(Object.fromEntries(track.stems.map((s) => [s, defaultStem()]))),
    soloOnly: (name: string) =>
      track &&
      setStems((prev) => {
        const already = prev[name]?.solo && Object.values(prev).filter((s) => s.solo).length === 1
        return Object.fromEntries(track.stems.map((s) => [s, { ...prev[s], solo: !already && s === name }]))
      }),
    setMaster: setMasterState,
    setRate: setRateState,
    setOriginal,
    setLoop: setLoopState,
  }
}

export type Mixer = ReturnType<typeof useMixer>
