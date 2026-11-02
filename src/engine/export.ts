import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Scene } from '../shared/scene'
import { SceneRenderer } from './preview'
import { preloadScene } from './assets'

export interface ExportOptions {
  scene: Scene
  from?: number
  to?: number
  fps?: number
  onProgress?: (frame: number, total: number, phase: 'render' | 'encode' | 'mux') => void
  signal?: AbortSignal
}

export interface ExportResult {
  bytes: Uint8Array
  frames: number
  seconds: number
  container: 'mp4' | 'webm'
}

const AUDIO_SAMPLE_RATE = 48000
const AUDIO_CHANNELS = 2

function audioMime(): string { return 'audio/mp4;codecs=mp4a.40.2' }

/** 把场景里的音频轨混成一段 PCM */
async function mixAudio(scene: Scene, duration: number): Promise<AudioBuffer | null> {
  if (!scene.audio.length) return null
  const ctx = new OfflineAudioContext(AUDIO_CHANNELS, Math.ceil(duration * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE)
  let any = false
  for (const track of scene.audio) {
    try {
      const res = await fetch(`gewu://workspace/${track.src}`)
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      const decoded = await ctx.decodeAudioData(buf)
      const src = ctx.createBufferSource()
      src.buffer = decoded
      const gain = ctx.createGain()
      gain.gain.value = track.volume ?? 1
      src.connect(gain).connect(ctx.destination)
      src.start(Math.max(0, track.start))
      any = true
    } catch {
      // 单个音频失败不影响导出
    }
  }
  if (!any) return null
  return await ctx.startRendering()
}

async function encodeAudio(buffer: AudioBuffer): Promise<{ chunks: EncodedAudioChunk[]; meta: EncodedAudioChunkMetadata | undefined } | null> {
  if (typeof AudioEncoder === 'undefined') return null
  const support = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: 192_000
  }).catch(() => null)
  if (!support?.supported) return null
  const chunks: EncodedAudioChunk[] = []
  let meta: EncodedAudioChunkMetadata | undefined
  const encoder = new AudioEncoder({
    output: (chunk, m) => { chunks.push(chunk); if (m?.decoderConfig) meta = m },
    error: e => console.error('audio encode', e)
  })
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: 192_000 })
  const block = 1024
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
  for (let i = 0; i < buffer.length; i += block) {
    const n = Math.min(block, buffer.length - i)
    const data = new Float32Array(n * AUDIO_CHANNELS)
    for (let j = 0; j < n; j++) {
      data[j * AUDIO_CHANNELS] = ch0[i + j]
      data[j * AUDIO_CHANNELS + 1] = ch1[i + j]
    }
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: AUDIO_CHANNELS,
      timestamp: Math.round((i / AUDIO_SAMPLE_RATE) * 1_000_000),
      data
    })
    encoder.encode(ad)
    ad.close()
  }
  await encoder.flush()
  encoder.close()
  return chunks.length ? { chunks, meta } : null
}

export async function exportScene(opts: ExportOptions): Promise<ExportResult> {
  const { scene } = opts
  const fps = opts.fps ?? scene.canvas.fps
  const from = Math.max(0, opts.from ?? 0)
  const to = Math.min(scene.canvas.duration, opts.to ?? scene.canvas.duration)
  const duration = Math.max(0.1, to - from)
  const totalFrames = Math.max(1, Math.round(duration * fps))
  const width = scene.canvas.width
  const height = scene.canvas.height

  if (typeof VideoEncoder === 'undefined') throw new Error('当前环境不支持 WebCodecs，无法导出视频')

  // 图片必须先加载完，否则前几帧会画成占位框
  await preloadScene(scene)

  const codecCandidates = [
    { codec: 'avc1.42001f', container: 'mp4' as const },
    { codec: 'avc1.4d0028', container: 'mp4' as const },
    { codec: 'vp09.00.10.08', container: 'webm' as const }
  ]
  let chosen: { codec: string; container: 'mp4' | 'webm' } | null = null
  for (const c of codecCandidates) {
    const support = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: 8_000_000, framerate: fps }).catch(() => null)
    if (support?.supported) { chosen = c; break }
  }
  if (!chosen) throw new Error('没有可用的视频编码器（H.264/VP9 均不可用）')

  const audioBuffer = await mixAudio(scene, duration)
  const audio = audioBuffer ? await encodeAudio(audioBuffer) : null

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: chosen.container === 'mp4' ? 'avc' : 'vp9', width, height, frameRate: fps },
    ...(audio ? { audio: { codec: 'aac', numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
    fastStart: 'in-memory'
  })

  let encodeError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encodeError = e instanceof Error ? e : new Error(String(e)) }
  })
  encoder.configure({ codec: chosen.codec, width, height, bitrate: Math.max(4_000_000, Math.round(width * height * fps * 0.12)), framerate: fps, latencyMode: 'quality' })

  const renderer = new SceneRenderer(width, height)
  const frameDurationUs = Math.round(1_000_000 / fps)

  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) { encoder.close(); throw new Error('已取消导出') }
    const t = from + i / fps
    renderer.render(scene, t)
    const frame = new VideoFrame(renderer.element, { timestamp: i * frameDurationUs, duration: frameDurationUs })
    encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 })
    frame.close()
    if (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0))
    opts.onProgress?.(i + 1, totalFrames, 'render')
    if (i % 4 === 0) await new Promise(r => setTimeout(r, 0))
  }

  opts.onProgress?.(totalFrames, totalFrames, 'encode')
  await encoder.flush()
  encoder.close()
  if (encodeError) throw encodeError

  if (audio) {
    for (const chunk of audio.chunks) muxer.addAudioChunk(chunk, audio.meta)
  }

  opts.onProgress?.(totalFrames, totalFrames, 'mux')
  muxer.finalize()
  return { bytes: new Uint8Array(target.buffer), frames: totalFrames, seconds: duration, container: chosen.container }
}

export { audioMime }
