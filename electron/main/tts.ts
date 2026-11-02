/**
 * 离线配音：用 Windows 自带的 SAPI（System.Speech）把文字合成成 wav。
 *
 * 为什么走 SAPI 而不是云 TTS：
 *  - 不需要任何 API Key，格物社的同学装上就能用
 *  - 不联网，字幕内容不出本机
 *  - 系统里通常已经装了中文音色（本机是 Microsoft Huihui Desktop）
 *
 * 已知局限：音色偏「播报」，情绪和停顿不如云端；多音字按 SAPI 的读法。
 * 想要更自然的声音，以后可以在这个接口后面换成云 TTS，上层不用改。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 必须保持 ASCII：Windows PowerShell 会把无 BOM 的 UTF-8 当 ANSI 读。 */
const SYNTH_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$TextFile,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$Voice = '',
  [int]$Rate = 0,
  [int]$Volume = 100
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) { $s.SelectVoice($Voice) }
  $s.Rate = $Rate
  $s.Volume = $Volume
  $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
  if (-not $text.Trim()) { throw 'text is empty' }
  $s.SetOutputToWaveFile($OutFile)
  $s.Speak($text)
} finally {
  $s.Dispose()
}
`

const VOICES_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $s.GetInstalledVoices() | ForEach-Object {
    if ($_.Enabled) { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }
  }
} finally {
  $s.Dispose()
}
`

export interface TtsVoice {
  name: string
  culture: string
}

export interface TtsOptions {
  voice?: string
  /** -10（很慢）~ 10（很快） */
  rate?: number
  /** 0~100 */
  volume?: number
}

export interface TtsResult {
  wav: Buffer
  durationSec: number
}

const POWERSHELL = 'powershell.exe'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'gewu-tts-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 列出系统里可用的音色（只返回启用的） */
export async function listVoices(): Promise<TtsVoice[]> {
  return withTempDir(async dir => {
    const script = join(dir, 'voices.ps1')
    await writeFile(script, VOICES_SCRIPT, 'utf8')
    const { stdout } = await run(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 20_000, maxBuffer: 1 << 20 }
    )
    return stdout
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const [name, culture = ''] = line.split('|')
        return { name: name.trim(), culture: culture.trim() }
      })
      .filter(v => v.name)
  })
}

/** 把一段文字合成为 wav。 */
export async function synthesize(text: string, opts: TtsOptions = {}): Promise<TtsResult> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('文字是空的，没什么可读的')

  return withTempDir(async dir => {
    const script = join(dir, 'synth.ps1')
    const textFile = join(dir, 'text.txt')
    const outFile = join(dir, 'out.wav')
    await writeFile(script, SYNTH_SCRIPT, 'utf8')
    await writeFile(textFile, trimmed, 'utf8')

    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-TextFile', textFile,
      '-OutFile', outFile,
      '-Rate', String(clamp(Math.round(opts.rate ?? 0), -10, 10)),
      '-Volume', String(clamp(Math.round(opts.volume ?? 100), 0, 100))
    ]
    if (opts.voice) args.push('-Voice', opts.voice)

    try {
      await run(POWERSHELL, args, { windowsHide: true, timeout: 120_000, maxBuffer: 1 << 20 })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`调用系统语音失败：${detail}`)
    }

    let wav: Buffer
    try {
      wav = await readFile(outFile)
    } catch {
      throw new Error('系统语音没有生成音频文件（可能是没有装中文音色）')
    }
    if (wav.length < 44) throw new Error('生成的音频是空的')

    const durationSec = wavDuration(wav)
    return { wav, durationSec }
  })
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

/**
 * 读 WAV 头算时长：RIFF 里找 fmt 的 byteRate 和 data 的字节数。
 * SAPI 输出的是标准 PCM WAV，够用。
 */
export function wavDuration(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return 0
  }
  let byteRate = 0
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8)
    } else if (id === 'data') {
      // 有些写入器把 size 写成 0 或超过文件长度，兜一下
      dataSize = Math.min(size, buf.length - body)
      if (byteRate > 0) break
    }
    offset = body + size + (size % 2)
    if (size === 0 && id !== 'data') break
  }
  if (!byteRate || !dataSize) return 0
  return Math.round((dataSize / byteRate) * 1000) / 1000
}
