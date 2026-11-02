import * as THREE from 'three'
import type { Ctx2D } from './types'
import type { SceneTheme } from '../shared/scene'

/**
 * 3D 图层能力：给绘制代码一个极简的 three 封装。
 *
 * 设计原则：
 *  1. 模型只需要「建场景 → 摆东西 → 渲染」，不需要懂 three 的材质/光照/矩阵。
 *  2. 每帧重建，渲染完立刻释放显存，避免导出 360 帧把 GPU 撑爆。
 *  3. 全部只依赖 t，不允许随机，保证导出可复现。
 */

export interface ThreeOpts {
  color?: string
  opacity?: number
  wireframe?: boolean
  dashed?: boolean
}

export interface ThreeScene {
  group: THREE.Group
  camera: THREE.PerspectiveCamera
  /** 渲染后需要释放的资源 */
  trash: Array<{ dispose(): void }>
}

export interface Three3D {
  scene(opts?: { fov?: number; pos?: [number, number, number]; look?: [number, number, number] }): ThreeScene
  axes(s: ThreeScene, opts?: { size?: number; labels?: boolean; color?: string }): void
  arrow(s: ThreeScene, from: Vec3, to: Vec3, opts?: ThreeOpts & { head?: number; radius?: number }): void
  sphere(s: ThreeScene, at: Vec3, r: number, opts?: ThreeOpts & { seg?: number }): void
  box(s: ThreeScene, at: Vec3, size: Vec3, opts?: ThreeOpts): void
  line(s: ThreeScene, points: Vec3[], opts?: ThreeOpts & { radius?: number }): void
  tube(s: ThreeScene, points: Vec3[], r: number, opts?: ThreeOpts): void
  label(s: ThreeScene, at: Vec3, text: string, opts?: { color?: string; size?: number }): void
  plane(s: ThreeScene, at: Vec3, size: [number, number], opts?: ThreeOpts & { normal?: Vec3 }): void
  render(s: ThreeScene, opts?: { bg?: string }): void
}

export type Vec3 = [number, number, number]

let renderer: THREE.WebGLRenderer | null = null
let rendererFailed = false

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer
  if (rendererFailed) return null
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    })
    renderer.setPixelRatio(1)
    renderer.setSize(1920, 1080, false)
    renderer.setClearAlpha(0)
    return renderer
  } catch {
    rendererFailed = true
    return null
  }
}

function toColor(c: string | undefined, fallback: string): THREE.Color {
  try {
    return new THREE.Color(c ?? fallback)
  } catch {
    return new THREE.Color(fallback)
  }
}

export function createThree3D(o: { width: number; height: number; theme: SceneTheme; ctx: Ctx2D }): Three3D {
  const W = o.width
  const H = o.height

  function mat(opts: ThreeOpts | undefined, fallback: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: toColor(opts?.color, fallback),
      roughness: 0.45,
      metalness: 0.05,
      transparent: opts?.opacity !== undefined && opts.opacity < 1,
      opacity: opts?.opacity ?? 1,
      wireframe: opts?.wireframe === true,
      side: THREE.DoubleSide
    })
  }

  function add(s: ThreeScene, obj: THREE.Object3D): void {
    s.group.add(obj)
  }

  function track(s: ThreeScene, obj: THREE.Object3D): void {
    obj.traverse(child => {
      const m = child as THREE.Mesh
      if (m.geometry) s.trash.push(m.geometry)
      const material = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (Array.isArray(material)) material.forEach(x => s.trash.push(x))
      else if (material) s.trash.push(material)
    })
  }

  function lineMaterial(color: string, dashed: boolean, opacity = 1): THREE.LineBasicMaterial {
    if (dashed) {
      return new THREE.LineDashedMaterial({
        color: toColor(color, '#9fb3c8'),
        transparent: opacity < 1,
        opacity,
        dashSize: 0.09,
        gapSize: 0.06
      }) as unknown as THREE.LineBasicMaterial
    }
    return new THREE.LineBasicMaterial({
      color: toColor(color, '#9fb3c8'),
      transparent: opacity < 1,
      opacity
    })
  }

  const api: Three3D = {
    scene(opts) {
      const group = new THREE.Group()
      const camera = new THREE.PerspectiveCamera(opts?.fov ?? 45, W / H, 0.1, 200)
      const pos = opts?.pos ?? [4.2, 3.2, 5.6]
      const look = opts?.look ?? [0, 0, 0]
      camera.position.set(pos[0], pos[1], pos[2])
      camera.lookAt(new THREE.Vector3(look[0], look[1], look[2]))

      // 固定光照：保证模型不用管打光也有立体感，同时别让背光面黑成一团（物理示意图要看得清）
      const ambient = new THREE.AmbientLight(0xffffff, 0.85)
      const hemi = new THREE.HemisphereLight(0xffffff, 0x4a5a6a, 0.9)
      const key = new THREE.DirectionalLight(0xffffff, 1.25)
      key.position.set(4, 7, 6)
      const fill = new THREE.DirectionalLight(0x9fc0ff, 0.6)
      fill.position.set(-5, -3, -4)
      group.add(ambient, hemi, key, fill)

      return { group, camera, trash: [] }
    },

    axes(s, opts) {
      const size = opts?.size ?? 2.2
      const color = opts?.color ?? '#7f8fa3'
      const defs: Array<{ dir: Vec3; color: string; label: string }> = [
        { dir: [1, 0, 0], color: '#e06c75', label: 'x' },
        { dir: [0, 1, 0], color: '#98c379', label: 'y' },
        { dir: [0, 0, 1], color: '#61afef', label: 'z' }
      ]
      for (const d of defs) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-size * d.dir[0], -size * d.dir[1], -size * d.dir[2]),
          new THREE.Vector3(size * d.dir[0], size * d.dir[1], size * d.dir[2])
        ])
        const material = lineMaterial(opts?.color ? color : d.color, false, 0.55)
        const line = new THREE.Line(geo, material)
        add(s, line)
        track(s, line)
        if (opts?.labels !== false) {
          api.label(s, [size * d.dir[0] * 1.08, size * d.dir[1] * 1.08, size * d.dir[2] * 1.08], d.label, {
            color: opts?.color ?? d.color,
            size: 0.28
          })
        }
      }
    },

    arrow(s, from, to, opts) {
      const a = new THREE.Vector3(...from)
      const b = new THREE.Vector3(...to)
      const dir = new THREE.Vector3().subVectors(b, a)
      const len = dir.length()
      if (len < 1e-6) return
      const radius = opts?.radius ?? Math.max(0.018, len * 0.018)
      const head = opts?.head ?? Math.max(0.06, Math.min(0.28, len * 0.14))
      const color = opts?.color ?? o.theme.accent ?? '#4fc3d9'

      const shaft = new THREE.CylinderGeometry(radius, radius, Math.max(0.001, len - head), 14)
      const shaftMesh = new THREE.Mesh(shaft, mat(opts, color))
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      shaftMesh.quaternion.copy(quat)
      shaftMesh.position.copy(a).add(dir.clone().multiplyScalar((len - head) / 2))
      add(s, shaftMesh)
      track(s, shaftMesh)

      const cone = new THREE.ConeGeometry(head * 0.45, head, 18)
      const coneMesh = new THREE.Mesh(cone, mat(opts, color))
      coneMesh.quaternion.copy(quat)
      coneMesh.position.copy(b).addScaledVector(dir.clone().normalize(), -head / 2)
      add(s, coneMesh)
      track(s, coneMesh)
    },

    sphere(s, at, r, opts) {
      const geo = new THREE.SphereGeometry(r, opts?.seg ?? 32, opts?.seg ? Math.round(opts.seg / 2) : 20)
      const mesh = new THREE.Mesh(geo, mat(opts, o.theme.accent ?? '#4fc3d9'))
      mesh.position.set(at[0], at[1], at[2])
      add(s, mesh)
      track(s, mesh)
    },

    box(s, at, size, opts) {
      const geo = new THREE.BoxGeometry(size[0], size[1], size[2])
      const mesh = new THREE.Mesh(geo, mat(opts, '#8aa0b8'))
      mesh.position.set(at[0], at[1], at[2])
      add(s, mesh)
      track(s, mesh)
    },

    plane(s, at, size, opts) {
      const geo = new THREE.PlaneGeometry(size[0], size[1])
      const mesh = new THREE.Mesh(geo, mat(opts, '#5f7d99'))
      mesh.position.set(at[0], at[1], at[2])
      if (opts?.normal) {
        const n = new THREE.Vector3(...opts.normal).normalize()
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      }
      add(s, mesh)
      track(s, mesh)
    },

    line(s, points, opts) {
      if (points.length < 2) return
      const radius = opts?.radius
      if (radius && radius > 0) {
        const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
        const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), radius, 10, false)
        const mesh = new THREE.Mesh(geo, mat(opts, o.theme.accent ?? '#4fc3d9'))
        add(s, mesh)
        track(s, mesh)
        return
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
      const line = new THREE.Line(geo, lineMaterial(opts?.color ?? o.theme.accent ?? '#4fc3d9', opts?.dashed === true, opts?.opacity ?? 1))
      if (opts?.dashed) line.computeLineDistances()
      add(s, line)
      track(s, line)
    },

    tube(s, points, r, opts) {
      api.line(s, points, { ...opts, radius: r })
    },

    label(s, at, text, opts) {
      const px = 128
      const canvas = document.createElement('canvas')
      canvas.width = px * Math.max(1, Math.min(4, text.length))
      canvas.height = px
      const c = canvas.getContext('2d')
      if (!c) return
      c.clearRect(0, 0, canvas.width, canvas.height)
      c.font = `600 ${Math.round(px * 0.62)}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillStyle = opts?.color ?? '#ffffff'
      c.fillText(text, canvas.width / 2, canvas.height / 2)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(material)
      const h = opts?.size ?? 0.3
      sprite.scale.set((h * canvas.width) / canvas.height, h, 1)
      sprite.position.set(at[0], at[1], at[2])
      sprite.renderOrder = 999
      add(s, sprite)
      s.trash.push(tex, material)
    },

    render(s, opts) {
      const r = getRenderer()
      if (!r) {
        o.ctx.save()
        o.ctx.fillStyle = 'rgba(224,108,117,.14)'
        o.ctx.fillRect(0, 0, W, H)
        o.ctx.restore()
        throw new Error('WebGL 不可用，3D 图层无法渲染')
      }
      r.setSize(1920, 1080, false)
      r.setClearColor(0x000000, 0)
      r.clear()
      r.render(s.group, s.camera)
      if (opts?.bg) {
        o.ctx.save()
        o.ctx.globalCompositeOperation = 'destination-over'
        o.ctx.fillStyle = opts.bg
        o.ctx.fillRect(0, 0, W, H)
        o.ctx.restore()
      }
      o.ctx.drawImage(r.domElement, 0, 0, W, H)
      for (const d of s.trash) {
        try {
          d.dispose()
        } catch {
          /* 释放失败不影响画面 */
        }
      }
      s.trash.length = 0
      s.group.clear()
    }
  }

  return api
}
