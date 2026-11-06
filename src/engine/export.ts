import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Scene } from '../shared/scene'
import { renderScene } from './render'
import { assetImage, preloadScene } from './assets'

export interface ExportOptions {
  scene: Scene
  from?: number
  to?: number
  fps?: number
  /** 输出分辨率（缺省用场景设计尺寸）；只用于导出，不改 scene */
  width?: number
  height?: number
  /** 目标码率（bps）；缺省按清晰度自动算 */
  bitrate?: number
  /** 清晰度预设：high 更清晰、small 更小 */
  quality?: 'high' | 'balanced' | 'small'
  onProgress?: (frame: number, total: number, phase: 'render' | 'encode' | 'mux') => void
  signal?: AbortSignal
}

export interface ExportResult {
  bytes: Uint8Array
  frames: number
  seconds: number
  container: 'mp4' | 'webm'
  width: number
  height: number
  fps: number
  bitrate: number
}

const AUDIO_SAMPLE_RATE = 48000
const AUDIO_CHANNELS = 2

function audioMime(): string { return 'audio/mp4;codecs=mp4a.40.2' }

/** 把场景里的音频轨混成一段 PCM（from > 0 时按导出区间裁掉开头） */
async function mixAudio(scene: Scene, duration: number, from = 0): Promise<AudioBuffer | null> {
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
      const volume = track.volume ?? (track.kind === 'sfx' ? 0.8 : 1)
      const total = track.dur ?? decoded.duration
      // 导出区间从 from 开始时：轨道的 audible 部分从 offset 处切入
      const offset = Math.max(0, Math.min(total, from - track.start))
      const when = Math.max(0, track.start - from)
      const span = Math.max(0.01, total - offset)
      if (when >= duration || span <= 0) continue
      const fadeIn = Math.max(0, Math.min(span / 2, track.fadeIn ?? 0))
      const fadeOut = Math.max(0, Math.min(span / 2, track.fadeOut ?? 0))
      gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : volume, when)
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(volume, when + fadeIn)
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(volume, Math.max(when + fadeIn, when + span - fadeOut))
        gain.gain.linearRampToValueAtTime(0.0001, when + span)
      }
      src.connect(gain).connect(ctx.destination)
      src.start(when, offset)
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
  const fps = Math.max(1, Math.round(opts.fps ?? scene.canvas.fps))
  const from = Math.max(0, opts.from ?? 0)
  const to = Math.min(scene.canvas.duration, opts.to ?? scene.canvas.duration)
  const duration = Math.max(0.1, to - from)
  const totalFrames = Math.max(1, Math.round(duration * fps))
  // 设计尺寸 vs 输出尺寸：画面代码永远用 1920×1080 设计坐标，
  // 输出分辨率只是最后一步缩放，避免 AI 写的坐标随分辨率漂移。
  const designW = scene.canvas.width
  const designH = scene.canvas.height
  const width = Math.max(64, Math.round(opts.width ?? designW))
  const height = Math.max(64, Math.round(opts.height ?? designH))
  const bitrate = resolveBitrate(opts, width, height, fps)

  if (typeof VideoEncoder === 'undefined') throw new Error('当前环境不支持 WebCodecs，无法导出视频')

  // 图片必须先加载完，否则前几帧会画成占位框
  await preloadScene(scene)

  // H.264 按 level 从高到低试：4K/150fps 需要 6.x；4K 通常 5.1/5.2；1080p 5.0 就够。
  const codecCandidates = [
    { codec: 'avc1.64003e', container: 'mp4' as const }, // High 6.2
    { codec: 'avc1.64003d', container: 'mp4' as const }, // High 6.1
    { codec: 'avc1.64003c', container: 'mp4' as const }, // High 6.0
    { codec: 'avc1.640034', container: 'mp4' as const }, // High 5.2
    { codec: 'avc1.640033', container: 'mp4' as const }, // High 5.1
    { codec: 'avc1.640032', container: 'mp4' as const }, // High 5.0
    { codec: 'avc1.4d0032', container: 'mp4' as const }, // Main 5.0
    { codec: 'avc1.4d0028', container: 'mp4' as const }, // Main 4.0
    { codec: 'avc1.42001f', container: 'mp4' as const }, // Baseline 3.1
    { codec: 'vp09.00.62.08', container: 'webm' as const }, // VP9 level 6.2
    { codec: 'vp09.00.51.08', container: 'webm' as const }, // VP9 level 5.1
    { codec: 'vp09.00.10.08', container: 'webm' as const }
  ]
  let chosen: { codec: string; container: 'mp4' | 'webm' } | null = null
  for (const c of codecCandidates) {
    const support = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate, framerate: fps }).catch(() => null)
    if (support?.supported) { chosen = c; break }
  }
  if (!chosen) {
    throw new Error(
      `没有可用的编码器支持 ${width}×${height}@${fps}fps。` +
      '4K 建议 ≤60fps，150fps 建议 ≤1080p；也可以把码率调低一档再试。'
    )
  }

  const audioBuffer = await mixAudio(scene, duration, from)
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
  encoder.configure({ codec: chosen.codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' })

  // 直接按输出分辨率渲染：4K 时用 ctx.scale(2,2) 画设计坐标，
  // 文字/矢量保持清晰，而不是先画 1080p 再放大。
  const frameCanvas = document.createElement('canvas')
  frameCanvas.width = width
  frameCanvas.height = height
  const frameCtx = frameCanvas.getContext('2d', { alpha: false })!
  frameCtx.imageSmoothingEnabled = true
  frameCtx.imageSmoothingQuality = 'high'
  const scaleX = width / designW
  const scaleY = height / designH
  const frameDurationUs = Math.round(1_000_000 / fps)

  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) { encoder.close(); throw new Error('已取消导出') }
    const t = from + i / fps
    frameCtx.setTransform(1, 0, 0, 1, 0, 0)
    frameCtx.clearRect(0, 0, width, height)
    frameCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    renderScene({
      scene,
      ctx: frameCtx,
      width: designW,
      height: designH,
      t,
      asset: assetImage
    })
    const frame = new VideoFrame(frameCanvas, { timestamp: i * frameDurationUs, duration: frameDurationUs })
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
  return { bytes: new Uint8Array(target.buffer), frames: totalFrames, seconds: duration, container: chosen.container, width, height, fps, bitrate }
}

/** 码率：用户给了就用；否则按分辨率/帧率/清晰度估算 */
function resolveBitrate(opts: ExportOptions, width: number, height: number, fps: number): number {
  if (opts.bitrate && Number.isFinite(opts.bitrate) && opts.bitrate > 0) {
    return Math.round(Math.max(300_000, Math.min(120_000_000, opts.bitrate)))
  }
  const factor = opts.quality === 'high' ? 0.2 : opts.quality === 'small' ? 0.06 : 0.12
  return Math.round(Math.max(1_500_000, Math.min(120_000_000, width * height * fps * factor)))
}

export { audioMime }
