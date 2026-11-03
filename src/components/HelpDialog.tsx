import { useEffect, useState } from 'react'

type Tab = 'start' | 'canvas' | 'group' | 'timeline' | 'draft' | 'keys'

const TABS: { id: Tab; label: string }[] = [
  { id: 'start', label: '快速上手' },
  { id: 'canvas', label: '画布' },
  { id: 'group', label: '组合' },
  { id: 'timeline', label: '时间轴' },
  { id: 'draft', label: '草稿与导出' },
  { id: 'keys', label: '快捷键' }
]

/** 键位/按钮的小标签 */
function K({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>
}

function Row({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="help-row">
      <div className="help-row-k">{k}</div>
      <div className="help-row-v">{children}</div>
    </div>
  )
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('start')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal hdlg">
        <div className="modal-head">
          <div>
            <h2>使用说明</h2>
            <p className="tiny muted">
              手工剪辑怎么用。看不懂「组合」就先看第三个标签——它是这套编辑器里最反直觉的东西。
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭（Esc）">×</button>
        </div>

        <div className="modal-tabs">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="help-body">
          {tab === 'start' && (
            <>
              <h3>五步做出一段视频</h3>
              <ol className="help-steps">
                <li>
                  <b>放素材</b>：左边「素材」里的图片/音频，拖到<b>画布</b> = 放到画面上；
                  拖到<b>时间轴</b> = 变成一条剪辑（决定什么时候出现）。
                </li>
                <li>
                  <b>摆位置</b>：点画布上的元素 → 出现选框 + 8 个手柄，拖动改位置、拖四角改大小、拖顶部圆点旋转。
                  双击文字直接改字，<K>Ctrl</K>+<K>Enter</K> 提交。
                </li>
                <li>
                  <b>成组</b>：一块画面里有很多元素（底、标题、箭头…）时，把它们全选再 <K>Ctrl</K>+<K>G</K>，
                  变成一个<b>组合</b>——以后整组一起挪、一起调时间。
                </li>
                <li>
                  <b>排时间</b>：时间轴上拖整条 = 改出现时间，拖两端 = 裁短。拖动时右上角显示起止秒数。
                </li>
                <li>
                  <b>导出</b>：右上角「导出」→ 选位置和文件名，出 mp4。
                </li>
              </ol>
              <div className="help-tip">
                想让 AI 直接做画面？在右边对话框描述就行（例如「画一个单摆，周期 2 秒」）。
                想只重画一小块：<K>Shift</K>+拖动框出那块，点「让 AI 重画这块」。
              </div>
            </>
          )}

          {tab === 'canvas' && (
            <>
              <h3>选中</h3>
              <Row k="单击">选中鼠标下最里层的那个元素</Row>
              <Row k={<><K>Ctrl</K> + 单击</>}>加选 / 减选（多选后画布顶部会出现对齐条）</Row>
              <Row k={<><K>Alt</K> + 单击</>}>直接选中它所在的<b>组合</b>（不用一层层点）</Row>
              <Row k="空白处拖">框选；按住 <K>Shift</K> 拖 = 框一块发给 AI 重画</Row>

              <h3>移动 / 缩放 / 旋转</h3>
              <Row k="拖动">移动，会自动吸附画布中线、其他元素的边与中心、你自己拉的参考线</Row>
              <Row k="8 个手柄">缩放（拖四角同时改宽高）</Row>
              <Row k="顶部圆点">旋转，按住 <K>Shift</K> 以 15° 为单位吸附</Row>
              <Row k="方向键">微调 1px，加 <K>Shift</K> 是 10px</Row>

              <h3>对齐与参考线</h3>
              <Row k="对齐条">
                多选后画布顶部出现：左 / 水平居中 / 右 / 顶 / 垂直居中 / 底 + 水平等距 / 垂直等距（右键菜单里也有）
              </Row>
              <Row k="标尺">工具栏「标尺」打开，从顶部标尺往下拖 = 横参考线，从左边往右拖 = 竖参考线</Row>
              <Row k="参考线">拖它移动、双击删除；元素拖动时会吸附上去</Row>

              <h3>视图</h3>
              <Row k={<>空格 + 拖</>}>平移画布（中键拖也行）</Row>
              <Row k={<><K>Ctrl</K> + 滚轮</>}>以光标为中心缩放；直接滚轮 = 平移</Row>
              <Row k="右键">
                副本 / 删除 / 组合 / 解组 / 对齐 / 上移下移 / 锁定 / 隐藏 / 让 AI 改这个元素 / 参考线 / 标尺
              </Row>
            </>
          )}

          {tab === 'group' && (
            <>
              <h3>组合是什么</h3>
              <p className="help-p">
                一个<b>带自己盒子的容器图层</b>。它把「底、标题、箭头」这些元素装在一起，
                里面的子元素坐标是<b>相对组合左上角</b>的——所以整组移动时子元素自动跟着走，不用一个个改。
                AI 生成复杂画面时也会自动拆成组合；老场景只有「一层代码」，要先用属性面板里的
                「让 AI 拆成组合」拆一次，之后才能单独改里面的元素。
              </p>

              <h3>怎么建 / 怎么拆</h3>
              <Row k={<><K>Ctrl</K> + <K>G</K></>}>把选中的元素合成一个组合（至少 2 个）</Row>
              <Row k={<><K>Ctrl</K> + <K>Shift</K> + <K>G</K></>}>解组：子元素回到根层级，位置不变</Row>
              <Row k="图层树拖动">把元素拖到组合那一行上 = 变成它的子元素（坐标自动换算，画面不会跳）</Row>

              <h3>怎么进出组合</h3>
              <Row k="单击">选中最里面的子元素，直接改它</Row>
              <Row k={<><K>Alt</K> + 单击</>}>选中整个组合，整组挪动</Row>
              <Row k="图层树 / 时间轴">组合前面有箭头，点开看里面的子元素</Row>

              <h3>组合会裁剪子元素的时间（最容易懵的一点）</h3>
              <p className="help-p">
                组合有自己的起止时间。子元素超出这个范围的部分<b>看不见</b>。
                拖组合整条时子元素一起移动；单独改子元素的起止，只在组合范围内生效——
                时间轴上那一行会标一个 <span className="help-clip">✂</span> 提醒你「被组合裁掉了」，
                属性面板的「时间」区也会写出组合范围。
              </p>

              <h3>在组合里复制粘贴</h3>
              <p className="help-p">
                选中子元素 <K>Ctrl</K>+<K>C</K> / <K>Ctrl</K>+<K>V</K>，粘贴体会回到<b>同一个组合</b>里
                （不会掉到根层级），并相对原件偏移 24px。
              </p>
            </>
          )}

          {tab === 'timeline' && (
            <>
              <h3>一行是什么</h3>
              <Row k="图层行">画布上的一个元素（组合行可以折叠，里面是子元素）</Row>
              <Row k="音频行">旁白 / 配乐，拖两端裁掉多余部分</Row>
              <Row k="字幕行">一句话一条，双击名栏能改文字和时间</Row>

              <h3>剪辑</h3>
              <Row k="拖整条">移动出现时间</Row>
              <Row k="拖左右边缘">裁剪（裁短只影响显示，素材文件不动）</Row>
              <Row k="满时长的条">从 0 到结尾的条拖不动——它已经没有可移动的空间了，只能裁</Row>
              <Row k="拖动时">右上角显示起止秒数；<K>Alt</K>+拖 = 复制一条再拖</Row>
              <Row k="双击剪辑块">选中这个元素，并把播放头移到它开头</Row>

              <h3>框选与定位</h3>
              <Row k="空白处单击">播放头跳到这里</Row>
              <Row k="空白处按住拖">框选多个剪辑块（锁定的图层不会被框到）</Row>
              <Row k="名栏">眼睛 = 显示/隐藏，锁 = 锁定（锁了不能拖、不能改）</Row>

              <h3>播放与缩放</h3>
              <Row k={<K>空格</K>}>播放 / 暂停</Row>
              <Row k={<><K>←</K> / <K>→</K></>}>逐帧步进，加 <K>Shift</K> 是 10 帧；<K>Home</K> / <K>End</K> 跳首尾</Row>
              <Row k="右下角 − / ＋">缩放轨道；「时长」输入框改整段长度</Row>
            </>
          )}

          {tab === 'draft' && (
            <>
              <h3>草稿是怎么存的</h3>
              <p className="help-p">
                每个草稿 = 一个文件夹（<span className="mono">%APPDATA%\gewu-video\drafts\&lt;id&gt;\</span>），里面有
                <span className="mono">scene.json</span>（画面）、<span className="mono">assets\</span>（素材）、
                <span className="mono">exports\</span>（导出）和对话记录。所以切草稿 = 换一整套东西，互不干扰。
              </p>
              <Row k="自动保存">改完停手约 0.6 秒就写进 scene.json，不用手动存；<K>Ctrl</K>+<K>S</K> 也能立刻存</Row>
              <Row k="切草稿">标题栏中间的草稿名下拉 = 最近 8 个</Row>
              <Row k="草稿库">右上「草稿库」开独立窗口：全部草稿、改名、复制、置顶、搜索</Row>
              <Row k="删除">是软删除，挪进 <span className="mono">trash\</span>，不会真删文件</Row>

              <h3>导出</h3>
              <Row k="右上「导出」">选目录、文件名、「整段」或「只导一段」</Row>
              <Row k="默认目录">在「模型设置 → 导出与保存」里定，导出时还能临时改</Row>
              <Row k="格式">固定 1920×1080 / 30fps / H.264（有配音就带 AAC）</Row>
              <Row k="同名文件">自动加 -1、-2，不会覆盖你已有的成片</Row>
            </>
          )}

          {tab === 'keys' && (
            <>
              <h3>编辑</h3>
              <Row k={<><K>Ctrl</K>+<K>Z</K></>}>撤销</Row>
              <Row k={<><K>Ctrl</K>+<K>Shift</K>+<K>Z</K></>}>重做</Row>
              <Row k={<><K>Ctrl</K>+<K>C</K> / <K>Ctrl</K>+<K>V</K></>}>复制 / 粘贴（组合内也能用）</Row>
              <Row k={<><K>Ctrl</K>+<K>D</K></>}>创建副本</Row>
              <Row k={<><K>Ctrl</K>+<K>G</K></>}>成组</Row>
              <Row k={<><K>Ctrl</K>+<K>Shift</K>+<K>G</K></>}>解组</Row>
              <Row k={<><K>Ctrl</K>+<K>]</K> / <K>Ctrl</K>+<K>[</K></>}>上移 / 下移一层</Row>
              <Row k={<K>Del</K>}>删除选中元素</Row>
              <Row k={<K>Esc</K>}>取消编辑 / 关闭菜单和弹窗</Row>

              <h3>时间轴</h3>
              <Row k={<K>空格</K>}>播放 / 暂停</Row>
              <Row k={<><K>←</K> / <K>→</K></>}>逐帧（<K>Shift</K> 10 帧）</Row>
              <Row k={<><K>Home</K> / <K>End</K></>}>跳到开头 / 结尾</Row>
              <Row k={<><K>Ctrl</K>+<K>S</K></>}>立刻保存</Row>

              <h3>画布</h3>
              <Row k="方向键">微调 1px（<K>Shift</K> 10px）</Row>
              <Row k="空格 + 拖">平移</Row>
              <Row k={<><K>Ctrl</K> + 滚轮</>}>缩放</Row>
              <Row k={<><K>Ctrl</K> + 单击</>}>多选</Row>
              <Row k={<><K>Alt</K> + 单击</>}>选中父组合</Row>
            </>
          )}
        </div>

        <div className="help-foot">
          <span className="tiny muted">这些操作都有探针回归，改坏了会被测出来；手感问题直接跟我说。</span>
          <button className="btn sm" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  )
}
