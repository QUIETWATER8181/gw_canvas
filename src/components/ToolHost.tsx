import { useEffect } from 'react'
import { useEditor } from '../state/editor'
import { SceneRenderer } from '../engine/preview'
import { exportScene } from '../engine/export'
import { preloadAssets } from '../engine/assets'
import { compareImages, describeImage } from '../engine/image-inspect'

interface Props {
  onExport(args: Record<string, unknown>): Promise<{ path: string; frames: number; seconds: number }>
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

/** 接收主进程转来的工具调用（agent 要渲染/导出时） */
export function ToolHost({ onExport, onToast }: Props) {
  const editor = useEditor()

  useEffect(() => {
    const off = window.gewu.onToolInvoke(async inv => {
      if (inv.name === 'render_frame') {
        const t = Number((inv.args as { t?: number }).t ?? 0)
        const scene = editor.state.scene
        const renderer = new SceneRenderer(scene.canvas.width, scene.canvas.height)
        await renderer.prepare(scene)
        const result = renderer.capture(scene, t)
        const base64 = result.dataUrl.split(',')[1] ?? ''
        const name = `preview-${t.toFixed(2).replace('.', '_')}.png`
        const saved = await window.gewu.writeAsset(name, base64ToBytes(base64))
        const boxLines = result.boxes.length
          ? result.boxes.map(b => `- ${b.id}（${b.name}）x=${b.x} y=${b.y} w=${b.w} h=${b.h} 覆盖 ${b.coverage}%`).join('\n')
          : '（当前帧没有任何可见内容）'
        const errorText = result.errors.length
          ? `\n\n【图层报错】\n${result.errors.map(e => `- ${e.layerId}: ${e.error}`).join('\n')}`
          : ''
        const plain = result.preview.replace(/\x1b\[[0-9;]*m/g, '')
        return {
          path: saved.path,
          size: result.size,
          errors: result.errors,
          preview:
            `画面预览（${result.size}×${Math.round((result.size * scene.canvas.height) / scene.canvas.width)}，` +
            `96 列，一格≈20×48 像素，亮度已归一化，暗→亮：空格 . : - = + * # % @）\n` +
            plain +
            `\n\n【各图层实际占据范围】（设计坐标 ${scene.canvas.width}×${scene.canvas.height}，覆盖=该层像素占全画布比例）\n` +
            boxLines +
            `\n\nPNG: ${saved.path}` +
            errorText
        }
      }
      if (inv.name === 'export_video') {
        const args = inv.args as { name?: string; from?: number; to?: number }
        const out = await onExport(args as Record<string, unknown>)
        return out
      }
      if (inv.name === 'check_scene') {
        const scene = editor.state.scene
        const samples = Number((inv.args as { samples?: number }).samples ?? 8)
        const renderer = new SceneRenderer(scene.canvas.width, scene.canvas.height)
        await renderer.prepare(scene)
        const problems: string[] = []
        for (let i = 0; i < samples; i++) {
          const t = (scene.canvas.duration * i) / Math.max(1, samples - 1)
          renderer.render(scene, t)
          for (const e of renderer.lastErrors) {
            const line = `t=${t.toFixed(2)}s 图层 ${e.layerId}: ${e.error}`
            if (!problems.includes(line)) problems.push(line)
          }
        }
        return problems.length ? problems.join('\n') : `已抽样 ${samples} 个时间点，所有图层均无运行时错误。`
      }
      if (inv.name === 'image_inspect') {
        const args = inv.args as { path?: string; cols?: number }
        const path = String(args.path ?? '')
        if (!path) throw new Error('缺少 path')
        await preloadAssets([path])
        const d = describeImage(path, Number(args.cols ?? 64))
        if (!d) throw new Error(`读不到图片 ${path}：确认文件在 assets/ 下，或先用 asset_import 导入`)
        const gridText = d.grid.map((row, i) => `  第 ${i + 1} 行 ${row.join(' ')}`).join('\n')
        return (
          `图片 ${path}（采样 ${d.width}×${d.height}）\n\n` +
          `【字符预览】${Number(args.cols ?? 64)} 列，暗→亮：空格 . : - = + * # % @\n` +
          d.preview.replace(/\x1b\[[0-9;]*m/g, '') +
          `\n\n【主色】${d.palette.join('  ')}\n` +
          `【平均亮度】${d.brightness.toFixed(0)}/255　【细节密度】${(d.detail * 100).toFixed(0)}%（越高元素越多）\n` +
          `【分区平均色】8 列 × 5 行，从左到右、从上到下\n${gridText}`
        )
      }
      if (inv.name === 'image_compare') {
        const args = inv.args as { first?: string; last?: string }
        const first = String(args.first ?? '')
        const last = String(args.last ?? '')
        if (!first || !last) throw new Error('需要 first 和 last 两个路径')
        await preloadAssets([first, last])
        const diff = compareImages(first, last)
        if (!diff) throw new Error('读不到图片：确认两个文件都在 assets/ 下')
        if (!diff.bbox) {
          return `两帧几乎完全一样（变化像素 ${(diff.changedRatio * 100).toFixed(1)}%）。如果这是首尾帧，说明中间几乎没有动作。`
        }
        const b = diff.bbox
        const shift = diff.centroidShift
        const dir = shift
          ? `${Math.abs(shift.dx) < 0.01 && Math.abs(shift.dy) < 0.01
              ? '基本没移动（更像是在原地变化）'
              : `内容整体向${shift.dx > 0.01 ? '右' : shift.dx < -0.01 ? '左' : ''}${shift.dy > 0.01 ? '下' : shift.dy < -0.01 ? '上' : ''}移动` +
                `（Δx=${(shift.dx * 100).toFixed(1)}% 宽 ≈ ${Math.round(shift.dx * 1920)}px，` +
                `Δy=${(shift.dy * 100).toFixed(1)}% 高 ≈ ${Math.round(shift.dy * 1080)}px）`}`
          : '无法判断位移（可能是整体明暗变化）'
        return (
          `【首尾帧差异】${first} → ${last}\n` +
          `变化像素占比 ${(diff.changedRatio * 100).toFixed(1)}%，平均色差 ${diff.meanDelta.toFixed(0)}/255\n` +
          `变化区域包围盒（按图片比例 0–1）：x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.w.toFixed(2)} h=${b.h.toFixed(2)}\n` +
          `→ 换算到 1920×1080 设计坐标：x=${Math.round(b.x * 1920)} y=${Math.round(b.y * 1080)} w=${Math.round(b.w * 1920)} h=${Math.round(b.h * 1080)}\n` +
          `整体位移：${dir}\n\n` +
          `【变化强度图】12 列 × 7 行，0=没变 9=变化最大\n` +
          diff.map.map((row, i) => `  第 ${i + 1} 行 ${row.split('').join(' ')}`).join('\n')
        )
      }
      throw new Error(`渲染进程不支持工具 ${inv.name}`)
    })
    return off
  }, [editor, onExport])

  void onToast
  return null
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
