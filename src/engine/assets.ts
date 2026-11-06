/**
 * 图片资源缓存。
 *
 * 绘制代码是同步执行的，但 <img> 加载是异步的，所以先把场景里用到的图片
 * 全部 preload 完，再开始逐帧渲染；绘制时直接从缓存里取。
 */

export interface CachedImage {
  el: HTMLImageElement
  state: 'loading' | 'ok' | 'error'
  width: number
  height: number
  error?: string
}

const cache = new Map<string, CachedImage>()

/** 把 assets/xxx.png 之类的相对路径转成渲染进程能取的 URL */
export function assetUrl(name: string): string {
  const clean = String(name).replace(/^\.?\//, '')
  if (/^(https?:|data:|blob:|gewu:)/i.test(clean)) return clean
  return `gewu://workspace/${clean}`
}

function load(url: string): CachedImage {
  const hit = cache.get(url)
  if (hit) return hit
  const el = new Image()
  // 必须用 anonymous：否则画布会被判为跨域污染，toDataURL / getImageData 全废
  el.crossOrigin = 'anonymous'
  const entry: CachedImage = { el, state: 'loading', width: 0, height: 0 }
  cache.set(url, entry)
  el.decoding = 'sync'
  el.onload = () => {
    entry.state = 'ok'
    entry.width = el.naturalWidth
    entry.height = el.naturalHeight
  }
  el.onerror = () => {
    entry.state = 'error'
    entry.error = `无法加载图片 ${url}`
  }
  el.src = url
  return entry
}

/** 同步取图；没加载好返回 null，调用方应跳过绘制 */
export function imageFor(name: string): CachedImage | null {
  const entry = load(assetUrl(name))
  return entry.state === 'ok' ? entry : null
}

/** 给绘制代码用的 asset()：直接拿到 <img>，可喂给 ctx.drawImage */
export function assetImage(name: string): HTMLImageElement | null {
  return imageFor(name)?.el ?? null
}

/** 等一张图加载完并拿到原始尺寸（拖素材进画布时用） */
export async function measureImage(name: string, timeoutMs = 3000): Promise<{ width: number; height: number } | null> {
  const entry = load(assetUrl(name))
  if (entry.state === 'ok') return { width: entry.width, height: entry.height }
  if (entry.state === 'error') return null
  return new Promise(resolve => {
    let done = false
    const finish = (v: { width: number; height: number } | null) => {
      if (done) return
      done = true
      resolve(v)
    }
    entry.el.addEventListener('load', () => finish({ width: entry.el.naturalWidth, height: entry.el.naturalHeight }), { once: true })
    entry.el.addEventListener('error', () => finish(null), { once: true })
    setTimeout(() => finish(entry.state === 'ok' ? { width: entry.width, height: entry.height } : null), timeoutMs)
  })
}

/** 从绘制代码 / 图片元素里粗略扫出引用的资源名（含嵌套组合） */
export function scanAssetRefs(scene: { layers: SceneLayerLike[]; audio?: { src?: string }[] }): string[] {
  const found = new Set<string>()
  const re = /(?:asset\(\s*|g\.image\(\s*|g\.video\(\s*)['"`]([^'"`]+)['"`]/g
  const walk = (layers: SceneLayerLike[] | undefined) => {
    for (const layer of layers ?? []) {
      if (layer.image?.src && /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(layer.image.src)) found.add(layer.image.src)
      if (layer.draw) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(layer.draw))) {
          const name = m[1]
          if (!/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(name)) continue
          found.add(name)
        }
      }
      walk(layer.children)
    }
  }
  walk(scene.layers)
  return [...found]
}

interface SceneLayerLike {
  draw?: string
  image?: { src?: string }
  children?: SceneLayerLike[]
}

/** 等所有图片加载完（失败也算完，绘制时会画占位） */
export async function preloadAssets(names: string[]): Promise<void> {
  await Promise.all(
    names.map(name => {
      const entry = load(assetUrl(name))
      if (entry.state !== 'loading') return Promise.resolve()
      return new Promise<void>(resolve => {
        const done = () => resolve()
        entry.el.addEventListener('load', done, { once: true })
        entry.el.addEventListener('error', done, { once: true })
        // 兜底：2.5s 还没结果就放行，别让导出卡死
        setTimeout(done, 2500)
      })
    })
  )
}

/** 场景渲染前调用 */
export async function preloadScene(scene: Parameters<typeof scanAssetRefs>[0]): Promise<void> {
  await preloadAssets(scanAssetRefs(scene))
}

export function clearAssetCache(): void {
  cache.clear()
}
