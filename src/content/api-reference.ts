export const API_REFERENCE = `// 可用变量
ctx      CanvasRenderingContext2D（已按图层平移）
t        当前时间（秒）   p  归一化进度 0..1
duration 场景时长        width/height 设计尺寸（1920×1080）
cx, cy   画面中心         theme  主题色 { bg, fg, muted, accent, accent2, accent3, grid }
ease     缓动：linear inQuad outQuad inOutQuad inCubic outCubic inOutCubic outBack outElastic
         span(t,a,b) 区间 0→1   pulse(t,a,b) 区间 0→1→0
util     clamp lerp map rad(角度→弧度) deg(弧度→角度) rand(seed) wave(t,freq,phase) damped(t,amp,ω,λ,φ) time(sec)
g        绘图工具（见下）
asset(name)  资源 URL，如 asset('assets/foo.png')

// 注意：上面这些名字（ctx t p duration width height cx cy theme ease util g asset three）
// 已经在作用域里了，别再用 const/let 声明一遍，否则整层报
// "Identifier 'p' has already been declared" 并且什么都不画。坐标点用 p0 / pt / pos。

// 绘图工具
g.clear(color?)                     清屏
g.rect(x,y,w,h,{fill,stroke,width,dash,alpha,shadow,shadowBlur})
g.circle(x,y,r,{fill,stroke,width,alpha})
g.line(x1,y1,x2,y2,{stroke,width,dash,alpha,cap})
g.arrow(x1,y1,x2,y2,{stroke,width,head,fill,alpha})      带箭头尖
g.dim(x1,y1,x2,y2,label?,{offset,stroke,width})          尺寸标注
g.path(points,{stroke,width,fill,close,alpha})           points=[{x,y},...]
g.plot(fn,x0,x1,{stroke,width,step})                     y=fn(x)
g.text(s,x,y,{size,color,font,weight,align,baseline,alpha,maxWidth})
g.math(tex,x,y,{size,color,align})                       TeX 子集，居中于(x,y)
g.chip(s,x,y,{size,color,bg,pad,align})                  带底色标签
g.axes({x,y,w,h,xRange,yRange,xLabel,yLabel,ticks,color,grid,tickSize,labelSize})
g.vector(x,y,dx,dy,{label,stroke,width})                 从(x,y)起
g.dots(points,r,color)
g.grid(step?,color?)
g.glow(points,color,width?)                              发光折线
g.sineWave(x0,x1,y0,amp,cycles,phase,{stroke,width})
g.save() / g.restore() / g.clip(x,y,w,h,fn) / g.with({x,y,rotate,scale},fn)

// 3D（three.js 封装，渲染结果合成到当前画布）
const s = three.scene({fov?, pos:[4.2,3.2,5.6], look:[0,0,0]})
three.axes(s,{size,labels,color})                坐标轴（带 x/y/z 标签）
three.arrow(s,[0,0,0],[2,1,0],{color,radius,head,opacity})   3D 箭头
three.sphere(s,[x,y,z],r,{color,opacity,wireframe,seg})
three.box(s,[x,y,z],[w,h,d],{color,opacity,wireframe})
three.plane(s,[x,y,z],[w,h],{color,opacity,normal:[0,1,0]})
three.line(s,[[x,y,z],...],{color,width,radius,dashed})      radius>0 时是管子
three.tube(s,[[x,y,z],...],r,{color})
three.label(s,[x,y,z],'E',{color,size})          3D 空间里的文字标签
three.render(s,{bg?})                            必须最后调用；每帧重建 s，别跨帧缓存

// TeX 子集：\\frac{a}{b} \\sqrt{x} \\vec{v} \\hat{x} \\bar{x} x^2 x_i
// \\alpha..\\omega \\Gamma..\\Omega \\cdot \\times \\pm \\leq \\geq \\neq \\approx
// \\sum \\int \\partial \\nabla \\rightarrow \\Rightarrow \\infty \\text{中文}
`
