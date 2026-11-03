# 格物 · 物理科普视频智能体

把一句物理描述变成能播的动画。形态和「星云」一样：Electron 桌面端 + 内嵌 DSH 智能体，
但工作台从聊天换成了**视频画布**——左边素材、中间画面、下面时间轴、右边图层和 AI 对话。

核心思路：**视频不是画出来的，是写出来的**。每个场景是一份 `scene.json`，
每个图层带一段 Canvas 2D 绘制代码；AI 写代码、渲染自检、再改。
好处是画面完全可复现、可逐帧导出、可精细调整，而不是靠抽卡。

---

## 跑起来

```bash
pnpm install        # 已装好可跳过
pnpm dev            # 开发模式（热更新）
pnpm build          # 打包到 out/
pnpm start          # 预览打包结果
pnpm typecheck      # 类型检查
```

Windows 下如果启动报 `Cannot read properties of undefined (reading 'isPackaged')`，
说明环境里有 `ELECTRON_RUN_AS_NODE=1`，先执行：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

## 第一次用：配模型

点右上角 **⋯ → 模型设置**，选一个预设填 Key：

| 预设 | 接口地址 | 说明 |
| --- | --- | --- |
| DeepSeek 官方 | `https://api.deepseek.com/v1` | 推荐 `deepseek-chat` |
| 同济网关 | 按学校给的地址填 | 一般也是 OpenAI 兼容 |
| 中转站 | `https://xxx/v1` | GPT / Claude 都能接，模型名照抄 |

**Key 不会进入 AI 子进程**：主进程起一个本机 HTTP 代理，子进程只拿到一次性 token。
Key 用系统 `safeStorage` 加密后存在 `%APPDATA%\gewu-video\config.json`。

## 界面

```
┌ 标题栏 ── 草稿名▾ · 状态 · 草稿库 · 新会话 · 导出 ────────┐
├ 左栏 264 ┬──── 画布 ────┬ 右栏 380 ──┤
│ 开始     │  实时预览     │ AI 助手     │
│ 素材     │  可框选区域   │ 图层        │
│ 参考图   │              │ 属性/代码   │
├──────────┴── 时间轴 ────┴────────────┤
```

- **标题栏「草稿名」**：点开是最近的草稿列表（置顶的带 ★），可直接切换或新建；旁边的「草稿库」开独立窗口。
- **左栏「开始」**：6 个物理预设（偏振、法拉第、波动、抛体、透镜、场），点一下就把需求发给 AI。
- **画布**：拖动空白处可以框选一块区域，松手后自动把这块的设计坐标发给 AI，让它只改这里。
- **时间轴**：拖播放头预览；图层条可拖动改时间区间、拖两端裁剪。
- **右栏「图层」**：点选图层 → 「属性」改名字/时间/透明度/混合模式，「代码」直接改绘制代码，`Ctrl+Enter` 应用。
- **导出**：右上角按钮先弹对话框（文件名 / 目录 / 整段或一段），确认后逐帧渲染 → WebCodecs 编码 → mp4（含音频和字幕）。

## 现在能做什么

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 文生视频 | ✅ 可用 | 描述现象 → AI 写多层代码 → 自己渲染自检 → 出片（写/渲染/检查/导出四步已端到端验证） |
| 选区修改 | ✅ 可用 | 画布框选 → 只重画这块 → 其他图层不动；选区坐标与播放头时刻会一起发给 AI |
| 图生视频 | ✅ 可用 | 左栏「图生视频」：选首帧 + 尾帧 + 时长 → agent 自己看图、算运动向量、补出中间过程 |
| 多草稿 | ✅ 可用 | 标题栏下拉快速切换，**独立「草稿库」窗口**搜索/排序/置顶/改名/复制/删除（软删除进 `trash/`）；每个草稿有自己的场景、素材、对话和成片 |
| 导出位置 | ✅ 可用 | 导出对话框里选目录、记住最近 8 个、同名自动 `-1` 不覆盖；设置里可以固定一个目录「以后都放这里」 |
| 配音 | ✅ 可用 | 素材里的音频可加音轨；也能用系统 SAPI 离线合成（字幕一键配音，agent 可调 `tts_speak`） |
| 字幕 | ✅ 可用 | `scene.subtitles` 能渲染能导出，有增删改 UI；没有逐句对齐工具 |
| Three.js 三维 | ✅ 可用 | `three.*` 原语 + 一个真 3D 样板场景；作者说先放一放 |

## 目录

```
electron/
  main/
    index.ts            两个窗口、gewu:// 协议、单实例锁、生命周期
    store.ts            模型连接配置（Key 加密）+ 导出设置
    draft-store.ts      草稿（一个草稿 = 一个工作区目录）、索引、软删除、对话
    scene-store.ts      scene.json 读写、校验、文件监听
    atomic.ts           原子写（临时文件 + rename），防止半截 JSON
    ipc.ts              所有 IPC handler
    agent/
      bridge.ts         会话编排：代理 + 网关 + 子进程
      acp-process.ts    拉起 DSH 运行时，stdio 上的 JSON-RPC
      model-proxy.ts    本机模型代理（Key 隔离）
      tool-gateway.ts   命名管道工具网关
  preload/index.ts      contextBridge 暴露 window.gewu
src/
  engine/
    draw.ts             绘图工具箱（g.*）
    math.ts             轻量 TeX 子集排版
    render.ts           场景 → Canvas
    preview.ts          字符预览 + 图层包围盒（AI 的“眼睛”）
    export.ts           WebCodecs + mp4-muxer 导出
  state/editor.ts       编辑器状态（撤销/重做/持久化）
  components/           UI
    DraftLibrary.tsx    草稿库窗口（drafts.html 的根组件）
    ExportDialog.tsx    导出位置/范围选择
  drafts-main.tsx       草稿库窗口入口
resources/
  AGENTS.md             AI 的场景 DSL 说明书（会拷进工作区）
  gewu-tools.mjs        AI 能调用的 14 个工具
vendor/dsh-runtime/     隔离的 DSH 运行时（Node 22 + @deepseek-ai/dsh）
```

## 场景格式

```jsonc
{
  "canvas": { "width": 1920, "height": 1080, "fps": 30, "duration": 12 },
  "layers": [
    {
      "id": "wave", "name": "光波", "start": 0, "end": 12,
      "draw": "for (let x = 0; x < width; x += 4) { ... }"
    }
  ]
}
```

`draw` 是**函数体**，可以直接用 `ctx t p duration width height cx cy theme ease util g asset`。
完整 API 见 `resources/AGENTS.md` 或界面右下角「API 速查」。

硬约束：**画面只能依赖 `t`**（导出是逐帧渲染，不能有状态漂移）。

图片用 `g.image('assets/foo.png', cx, cy, 640, 360)`，或 `ctx.drawImage(asset('assets/foo.png'), …)`
（`asset()` 返回的是已加载好的 `<img>`，场景渲染前会自动预加载）。

## 图生视频：AI 怎么看图

左栏第三个 tab 是「图生视频」，两个格子分别是首帧和尾帧。选好两张图、填时长（默认 6 秒），
点「补出中间过程」，前端会把两个绝对路径、时长、画布尺寸和一套流程要求拼成 prompt 发出去。

模型是纯文本的，所以「看」图靠三个工具：

| 工具 | 给 AI 什么 |
| --- | --- |
| `image_inspect` | 字符预览（和渲染自检同一套）+ 主色占比 + 平均亮度 + 细节密度 + 8×5 分区平均色 |
| `image_compare` | 首尾帧的变化包围盒、变化占比、**运动向量**（变暗处→变亮处，直接给出「往右 900px」这种结论）、12×7 变化强度图 |
| `asset_import` | 把用户给的本地图片拷进 `assets/` |

运动向量是实测校准过的：合成一张「圆从 x=160 移到 x=460（640 宽）」的首尾帧，
工具报 `Δx=46.9% 宽 ≈ 900px`，与真实位移（300/640 = 46.875%）一致。

拿到运动向量后，agent 自己判断做法：矢量元素就代码重建并插值，照片类就 `g.image` 交叉淡入
再叠代码画的元素承担运动。整个过程（7 次工具调用 → 出片）已用假模型端到端跑通。

## 每轮发给 AI 的上下文

用户每次发消息，主进程会把编辑器的当前状态拼进 `<scene-state>`：

```
图层（11）：
  2. id=title name="标题" time=0–12s  ← 用户当前选中
用户播放头停在 t=5.40s（说「这里/这一帧/现在」指的就是这个时刻）
用户选中的图层：title（标题）
用户在画布上框选了设计坐标区域 x=640 y=320 w=480 h=260
```

所以「把这里往左挪一点」「这块重画」这类话不需要反问，AI 知道「这里」是哪个时刻、哪一层、哪块区域。

## 撤销与导出

- AI 一次改动（同一轮里的多次 `scene_set_layer`）在撤销栈里**合并成一条**，Ctrl+Z 一次就回到 AI 动手之前。
- 用户点「导出」会弹保存对话框；AI 调用 `scene_export_video` 则直接写进
  `%APPDATA%\gewu-video\workspace\exports\`，不打断用户。

## AI 写错时的反馈

模型写场景十有八九第一次会写错点什么。静默修正会让它反复犯同一个错，所以写入前会做静态检查，
把问题原样回给模型：

```
{"ok":true,"layers":8,"warnings":[
  "第 4 层（箭头函数）的 draw 写成了箭头函数，应该只写函数体",
  "第 5 层（用了随机）用了被禁用的全局（…Math.random 等），画面必须只依赖 t",
  "第 6 层（时间倒序）的 end(1) 不大于 start(3)，这层永远不显示",
  "第 8 层（没有 draw）没有 draw 字符串，这一层将是空白",
  "画布宽度 1280 不是 1920，坐标会整体缩放，建议改成 1920"]}
```

`check_scene` 也会附带同一套静态检查（id 重复、非法 id、`return`、`function` 声明、画布尺寸…）。

## 开发者：不花钱测整条链路

`scripts/mock-openai.mjs` 是一个假的 OpenAI 兼容服务，用来在没有 Key 的情况下
验证「DSH 运行时 → ACP → 模型代理 → 工具网关 → 渲染进程」：

```powershell
# 1. 起假模型（可选 text / inspect / frame / write / export / scene 六种模式）
#    scene 模式最完整：写场景 → 渲染自检 → 抽样检查 → 导出，一轮跑完
$env:MOCK_MODE='scene'; node scripts/mock-openai.mjs 8787

# 2. 写一份指向它的配置到 %APPDATA%\gewu-video\config.json
#    { "version": 1, "activeConnectionId": "mock",
#      "connections": [{ "id": "mock", "name": "Mock", "kind": "openai-compatible",
#                        "baseUrl": "http://127.0.0.1:8787/v1", "model": "mock-deepseek",
#                        "key": "plain:bW9jaw==" }] }

# 3. 让 app 直接发一条消息（--exit-after 表示结束后退出）
#    加 --prompt-ui 会附带合成的编辑器上下文，用来验证上下文注入
node_modules\electron\dist\electron.exe . --prompt=hello --prompt-ui --exit-after
```

`--selftest` 会渲染 t=2/5/10 三帧到 `_preview-*.txt` / `_frame-*.png`，
再导出一段 4 秒 mp4 到 `_selftest.mp4`，用于回归；加 `--full` 则导出整段 `demo.mp4`。

想看模型实际收到什么 prompt，加 `MOCK_DUMP`：

```powershell
$env:MOCK_MODE='text'; $env:MOCK_DUMP="$PWD\_dump.json"; node scripts/mock-openai.mjs 8787
```

`_dump.json` 里是完整的 system / 场景说明 / 场景状态 / 工具 schema，排查「AI 为什么不听话」时非常有用。

## 安全边界

- 运行时里所有宿主工具（bash/pwsh/fs/skill/subagent/workflow/web）都在 `gewu-acp.patch.yml` 里关掉了。
- AI 只能通过工具网关碰 `scene.json` 和 `assets/`，没有 shell、没有网络、读不到系统文件。
- 子进程跑在 `DSH_PERMISSION_MODE=danger-full-access`：**不是放权，而是已经没东西可放**——
  所有能产生文件/命令副作用的能力都摘掉了，留着 `read-only` 只会往 prompt 里塞「你无法修改文件」这种与事实相反的提示。
- 渲染进程必须开 `'unsafe-eval'`——「代码即画面」是这个产品的设计前提，不是疏漏。
