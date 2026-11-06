/**
 * 本地知识库（物理 / 数学 / 剪辑分镜）。
 *
 * 为什么不在 AGENTS.md 里塞满知识：
 *  - AGENTS.md 每条消息都会进上下文，塞满会持续烧 token；
 *  - 知识库按需检索，只把命中的 1–2 条返回给模型，便宜且更聚焦。
 *
 * 文件格式：resources/knowledge/<topic>.md，每个 `## 标题 | 关键词` 是一条。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type KnowledgeTopic = 'physics' | 'math' | 'storyboard'

export interface KnowledgeSection {
  topic: KnowledgeTopic
  title: string
  keywords: string
  body: string
  file: string
}

export interface KnowledgeHit extends KnowledgeSection {
  score: number
}

const TOPIC_LABEL: Record<KnowledgeTopic, string> = {
  physics: '物理',
  math: '数学',
  storyboard: '分镜'
}

export class KnowledgeBase {
  private sections: KnowledgeSection[] = []
  private loaded = false

  async load(dir: string): Promise<void> {
    this.sections = []
    try {
      const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.md'))
      for (const file of files) {
        const topic = file.replace(/\.md$/i, '').toLowerCase() as KnowledgeTopic
        if (!TOPIC_LABEL[topic]) continue
        const text = await readFile(join(dir, file), 'utf8')
        this.sections.push(...parseSections(text, topic, file))
      }
    } catch {
      // 知识库缺失不致命：工具会返回「没有匹配条目」
    }
    this.loaded = true
  }

  get size(): number { return this.sections.length }

  topics(): string[] {
    return [...new Set(this.sections.map(s => `${TOPIC_LABEL[s.topic]} · ${s.title}`))]
  }

  search(query: string, topic?: KnowledgeTopic, limit = 2): KnowledgeHit[] {
    const q = query.trim()
    if (!q) return []
    const terms = buildTerms(q)
    const lowerQuery = q.toLowerCase()
    const hits: KnowledgeHit[] = []
    for (const section of this.sections) {
      if (topic && section.topic !== topic) continue
      const title = section.title.toLowerCase()
      const keywords = section.keywords.toLowerCase()
      const body = section.body.toLowerCase()
      let score = 0
      if (title.includes(lowerQuery)) score += 10
      if (keywords.includes(lowerQuery)) score += 8
      if (body.includes(lowerQuery)) score += 6
      for (const term of terms) {
        if (title.includes(term)) score += 6
        if (keywords.includes(term)) score += 5
        if (body.includes(term)) score += 1.5
      }
      if (score > 0) hits.push({ ...section, score: Math.round(score * 10) / 10 })
    }
    hits.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    return hits.slice(0, Math.max(1, Math.min(4, limit)))
  }

  /** 没命中时给模型一个可用的目录，方便它换词 */
  catalog(): string {
    if (!this.loaded) return '知识库还没加载'
    if (!this.sections.length) return '知识库为空'
    const byTopic = new Map<KnowledgeTopic, string[]>()
    for (const s of this.sections) {
      const list = byTopic.get(s.topic) ?? []
      list.push(s.title)
      byTopic.set(s.topic, list)
    }
    return [...byTopic.entries()]
      .map(([t, titles]) => `${TOPIC_LABEL[t]}：${titles.join(' / ')}`)
      .join('\n')
  }
}

function parseSections(text: string, topic: KnowledgeTopic, file: string): KnowledgeSection[] {
  const out: KnowledgeSection[] = []
  const lines = text.split(/\r?\n/)
  let current: { title: string; keywords: string; body: string[] } | null = null
  const flush = () => {
    if (!current) return
    const body = current.body.join('\n').trim()
    if (body) out.push({ topic, title: current.title, keywords: current.keywords, body, file })
    current = null
  }
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      const raw = m[1]
      const [title, keywords = ''] = raw.split('|').map(s => s.trim())
      current = { title: title || raw, keywords, body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  flush()
  return out
}

/** 中文按 2-gram 拆，英文按词；避免「马吕斯定律」只有一个长 token 匹配不上 */
function buildTerms(query: string): string[] {
  const out = new Set<string>()
  for (const raw of query.toLowerCase().split(/[\s,，。、;；:：/|()（）"“”'‘’]+/)) {
    const term = raw.trim()
    if (!term) continue
    out.add(term)
    if (/[\u4e00-\u9fa5]/.test(term)) {
      for (let i = 0; i + 1 < term.length; i++) out.add(term.slice(i, i + 2))
    }
  }
  return [...out].filter(t => t.length >= 2)
}
