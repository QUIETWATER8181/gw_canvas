import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 临时文件名必须唯一：同毫秒内两次保存曾撞名，两个 writeFile 交错写出半截 JSON */
let seq = 0
function tempName(file: string): string {
  seq = (seq + 1) % 1_000_000
  return `${file}.tmp-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 原子写：先写同目录临时文件，再 rename 覆盖。
 *
 * 为什么需要：配置/索引/场景都是「整份 JSON 覆盖写」。直接 writeFile 时如果进程被杀、
 * 或者两个实例同时写，文件会变成半截 JSON —— 实测过一次 config.json 尾部多出一段
 * 上次的残留，JSON.parse 直接抛，load() 的 catch 把配置吞成空，界面报「未配置模型连接」，
 * 而文件本身看起来「有内容」。rename 在同盘上是原子的，最坏情况是丢掉一次写入，
 * 不会留下坏文件。
 */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = tempName(file)
  await writeFile(tmp, data)
  try {
    await rename(tmp, file)
  } catch (error) {
    // rename 失败（被占用/跨盘）就退回直写，至少不丢这次内容
    await writeFile(file, data)
    throw error
  }
}

/** 同步版本：退出、切草稿这类「不能等 await」的场合用 */
export function atomicWriteSync(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = tempName(file)
  writeFileSync(tmp, data)
  try {
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, data)
  }
}

/**
 * 清理上次被强杀留下的临时文件（进程在 writeFile 和 rename 之间退出）。
 * 只在启动时对少数几个目录做一次，别扫整盘。
 */
export async function cleanupTempFiles(dir: string): Promise<void> {
  try {
    for (const f of await readdir(dir)) {
      if (!f.includes('.tmp-')) continue
      await unlink(join(dir, f)).catch(() => undefined)
    }
  } catch { /* 目录不存在就算了 */ }
}

/** 同上，同步版（退出时用） */
export function cleanupTempFilesSync(dir: string): void {
  try {
    for (const f of readdirSync(dir)) {
      if (!f.includes('.tmp-')) continue
      try { unlinkSync(join(dir, f)) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
