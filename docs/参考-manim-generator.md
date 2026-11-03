# 参考项目：manim-generator 读后笔记

> 2026-11-03 应作者要求从 GitHub 拉下来读的。仓库在 `_refs/manim-generator/`（`_refs/` 不进 git）。
> 同名项目有两个，这个是最对口的（Python，119 star，`makefinks/manim-generator`）。
> 另一个 `rohitg00/manim-video-generator`（TS，308 star）是更简单的「prompt → Manim 代码 → 渲染」，
> 没有反馈环，参考价值小。

## 它是什么

LLM 生成 Manim（Python 动画库）代码 → 渲染成视频。核心不是「一次生成就对」，
而是**两个角色来回迭代**：`Code Writer` 写代码，`Code Reviewer` 看着渲染结果挑毛病。

```
video_data（文字需求）
   ↓
[Writer] 生成初版代码  ──→ 跑 Manim ──→ 成功/失败 + 日志 + 抽出的几帧画面
   ↓                                          ↓
[Reviewer] 看 代码 + 日志 + 画面  ──────→ 一份 Markdown 评审意见
   ↓
[Writer] 按意见改代码 ──→ 再跑 ──→ …（review_cycles 轮，默认 3）
```

关键点：**Reviewer 能看到渲染出来的画面**（`convert_frames_to_message_format()` 把帧转成
`{"type":"image_url","image_url":{"url": dataURL}}` 喂给多模态模型）。

## 对我们有用的四条

### 1. 让模型看自己的输出，而不是看自己的代码

它最值钱的设计是这个。我们的 `image_describe` / `scene_render_frame({describe:true})`
就是这条，只是做成**按需调用**而不是每轮强制——因为我们的渲染是毫秒级、迭代次数多，
每轮都调视觉模型又慢又贵。它那边 Manim 渲染一次几十秒，多花一次视觉调用不心疼。

### 2. 评审意见要带上「之前说过什么」

`review_prompt.txt` 里有：

> IMPORTANT: Do not include things that were already mentioned in `<previous_reviews>`.
> Except for things that were not fixed.

不这么做，模型会连着三轮说同一句「建议加点动画」。如果我们以后加「自查-修改」循环，
这条必须抄。

### 3. 代码能跑通之后，评审重心要换档

它有两个 prompt：`review_prompt.txt`（有场景渲染失败时，先修 bug）和
`review_prompt_enhanced.txt`（全部跑通时，只谈视觉提升）。切换依据是
`calculate_scene_success_rate()`。

我们现在的 `check_scene` 已经在做「有没有运行时错误」这件事，
但**没有「跑通了之后还要不要更好看」这一档**。这是可以加的：
`check_scene` 全绿之后，提示 agent 用 `scene_render_frame({describe:true})` 看一眼，
再决定要不要调构图。

### 4. 抽帧策略

`extract_frames_from_video()` 两种模式：
- `fixed_count`：整段均匀抽 N 帧（默认 3）
- `highest_density`：先均匀抽一批，选「非黑像素占比最高」的那一帧——即**内容最满的一帧**

`highest_density` 这个思路我们用不上（我们是代码渲染，知道每一帧画了什么），
但「均匀抽 + 选内容最满」这个组合，在我们做**导出后质检**时可能有用：
导出成片后抽 3 帧丢给视觉模型，比逐帧检查便宜得多。

## 它做得比我们好的地方

| 方面 | 它 | 我们 |
| --- | --- | --- |
| 自动迭代 | 内置 review 循环，跑完自动改 3 轮 | agent 自己决定改几轮（更灵活，但不保证） |
| 多模型对比 | LiteLLM 路由，writer/reviewer 可以用不同模型 | 单 agent 单模型 + 独立的视觉模型 |
| 评测基准 | 有 Manim Bench 榜单，prompt 集在 `bench_prompts/` | 无 |

## 我们做得比它好的地方

| 方面 | 它 | 我们 |
| --- | --- | --- |
| 交互 | 纯 CLI，跑完看结果 | 画布实时预览 + 时间轴 + 图层点选 + 代码检查器 |
| 修改粒度 | 只能整份代码重生成 | 可以只改一个图层、只改框选区域 |
| 依赖 | 要 Python + Manim + LaTeX + ffmpeg | 一个 Electron 包，画布是浏览器 Canvas |
| 音视频 | 只有画面 | 画面 + 字幕 + 音轨，一起编码进 mp4 |

## 可以借鉴但**现在不做**的

- **自动 review 循环**：我们的 agent 本来就能自己迭代，硬加一个循环会跟 agent 抢控制权。
  如果要加，应该是「在 AGENTS.md 里把自查写得更硬」，而不是在外面套一层编排。
- **Manim 那样的场景 DSL**：我们用的是「每层一段 JS 函数体」，比 Manim 的
  Python 类体系更自由，但也更容易写出跑不动的代码。用 `check_scene` 兜底。
- **benchmark**：等真实模型接上、有 20 个以上真实场景之后再说。

## 一句话结论

它证明了「**让模型看到渲染结果**」是这类工具的分水岭——这正是作者说「需要视觉模型」时
要补的那块。剩下的（review 循环、benchmark）是它作为研究项目的形态，
我们作为给人用的工具不需要照抄。
