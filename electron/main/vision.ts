/**
 * 视觉模型：把一张图发给多模态模型，拿回一段中文描述。
 *
 * 为什么放在主进程：Key 只在这里解密，渲染进程和 DSH 子进程都碰不到。
 * 图片用 Electron 自带的 nativeImage 缩放 + 转 JPEG，不额外引依赖。
 */
import { nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'

export interface VisionConnection {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface VisionSource {
  /** 本地文件绝对路径（assets 里的图、渲染出来的帧） */
  path?: string
  /** 已经是 dataURL 的话直接给 */
  dataUrl?: string
}

const MAX_EDGE = 1280
const TIMEOUT_MS = 90_000

/** 压到最长边 1280 的 JPEG dataURL：省 token，也避开个别接口的体积上限 */
export function toVisionDataUrl(src: VisionSource): string {
  let img: NativeImage
  if (src.dataUrl) {
    img = nativeImage.createFromDataURL(src.dataUrl)
  } else if (src.path) {
    if (!existsSync(src.path)) throw new Error(`找不到图片 ${src.path}`)
    img = nativeImage.createFromPath(src.path)
  } else {
    throw new Error('没有图片：要么给 path，要么给 dataUrl')
  }
  if (img.isEmpty()) throw new Error('这张图读不出来（格式不支持或文件损坏）')

  const { width, height } = img.getSize()
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const out = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : img
  const jpeg = out.toJPEG(88)
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** 从各家五花八门的错误体里抠出人能看懂的一句话 */
function pickError(body: unknown, status: number): string {
  const anyBody = body as { error?: { message?: string; code?: string | number }; message?: string } | null
  const msg = anyBody?.error?.message ?? anyBody?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  return `HTTP ${status}`
}

/**
 * 让视觉模型描述一张图。
 * @param question 想问的问题，缺省是「客观描述画面，供后续复现」
 */
export async function describeImage(
  conn: VisionConnection,
  src: VisionSource,
  question?: string
): Promise<{ text: string; model: string; ms: number }> {
  const started = Date.now()
  const dataUrl = toVisionDataUrl(src)

  const ask =
    question?.trim() ||
    [
      '你是物理科普动画的美术指导。请客观描述这张图，供后续用代码复现：',
      '1) 画面主体是什么、在什么位置（用 左/中/右 + 上/中/下 描述）；',
      '2) 有哪些几何元素（线、圆、箭头、波形、网格、坐标轴…）及其相对大小；',
      '3) 配色（背景色、主色、强调色，能说出大致色相即可）；',
      '4) 有没有文字/公式，写的是什么；',
      '5) 如果是动画的一帧，推测这是什么物理过程。',
      '不要评价好看与否，只描述你看到的东西。控制在 300 字以内。'
    ].join('\n')

  const body = {
    model: conn.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    max_tokens: 800,
    stream: false
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(joinUrl(conn.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.apiKey}`
      },
      body: JSON.stringify(body),
      signal: ac.signal
    })
  } catch (e) {
    clearTimeout(timer)
    const msg = (e as Error).name === 'AbortError' ? `等了 ${TIMEOUT_MS / 1000}s 没返回` : (e as Error).message
    throw new Error(`连不上视觉模型（${conn.baseUrl}）：${msg}`)
  }
  clearTimeout(timer)

  const raw = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch { /* 有些中转站会返回纯文本错误 */ }

  if (!res.ok) {
    const detail = pickError(parsed, res.status)
    if (res.status === 401 || res.status === 403) {
      throw new Error(`视觉模型的 Key 不对或没权限（${res.status}）：${detail}。请到「模型设置」里检查。`)
    }
    if (/image|vision|multimodal|unsupported|不支持/i.test(detail)) {
      throw new Error(
        `「${conn.model}」好像不支持图片输入（${res.status}）：${detail}\n` +
          `请把「模型设置 → 视觉模型」换成一个多模态模型，比如 gpt-4o、qwen-vl-max、glm-4v。`
      )
    }
    throw new Error(`视觉模型报错（${res.status}）：${detail}`)
  }

  if (!parsed) {
    throw new Error(`视觉模型返回的不是 JSON：${raw.slice(0, 200)}`)
  }

  const data = parsed as {
    choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[]
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`视觉模型报错：${data.error.message}`)

  const content = data.choices?.[0]?.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(c => c?.text ?? '').join('').trim()
        : ''
  if (!text.trim()) throw new Error('视觉模型返回了空内容（可能是 max_tokens 太小，或这个模型不支持看图）')

  return { text: text.trim(), model: conn.model, ms: Date.now() - started }
}
