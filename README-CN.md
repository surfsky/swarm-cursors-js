# Swarm Cursors


[GitHub](https://github.com/surfsky/swarm-cursors-js) · [演示](https://surfsky.github.io/swarm-cursors-js/) · [English](README.md)

把任意页面快照成一份蓝图，擦空，再让一群多人协作光标把它一砖一瓦重新搭起来：拖出盒子、逐字打字、钢笔连线、⌥ 拖拽复制。你看到的是重建过程，不是回放录像。

零依赖，单个 ESM 文件（`src/swarm-cursors.js`，约 49 kB，含中文注释）。灵感与动效语言来自 [Joel Califa 的 Swarm](https://califa.github.io/swarm-site/)，以及 [DhvanilPatel 的 swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors) 扩展；本仓库是独立实现的通用 JS 版。

![演示](demo/preview.png)

## 快速开始

**看效果**：Demo 不做打包，页面直接 `import` 库源码。浏览器不允许 `file://` 页面导入 ES 模块，所以在项目根目录起一个静态服务：

```bash
python3 -m http.server 8080
```

然后打开 <http://localhost:8080/demo/index.html>。直接双击 `demo/index.html` 时页面会显示同样的提示，不会白屏。

**当库用**：

```js
import { SwarmCursors } from './src/swarm-cursors.js'

const swarm = new SwarmCursors({
  target: '#site',       // 要快照的元素，或选择器
  cursors: 8,
  speed: 1,
  background: '#FBF7F0',  // 擦空后画布的底色
  startOnLoad: true,      // 挂载即自动开演
  showControlPanel: true, // 右下角控制面板
  restoreOnFinish: true,  // 建完自动还原真实页面
})

await swarm.play()       // 快照 → 擦空 → 重建 → （可选）自动还原
```

`target` 元素需要能被 `overflow` 收束（不要给它自己加滚动条）。库只改它的 `position`（static → relative）和子元素的 `visibility`，`stop()` 时逐项还原，不动你的 DOM 结构。

## API

| 成员 | 说明 |
| --- | --- |
| `new SwarmCursors(opts)` | 见下方选项表 |
| `play()` | 快照并开始重建，返回 Promise（视觉重建本身是同步启动的） |
| `replay()` | 停掉当前这轮再来一次 |
| `stop()` | 移除画布与光标，还原真实页面 |
| `destroy()` | `stop()` 之后再卸掉内置控制面板 |
| `advance(ms)` | 同步快进 N 毫秒，不依赖 rAF。录屏、截图、调试用 |
| `setSpeed(n)` | 0.25 – 4，重建倍速 |
| `setSound(bool)` | Web Audio 合成的点击 / 打字声，默认关 |
| `on(event, fn)` | `ready` / `start` / `progress` / `done` / `restored` |

### 选项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `target` | `document.body` | 快照范围 |
| `background` | `#F1F2F3` | 擦空后的画布底色 |
| `cursors` | `8` | 并发光标数，2 – 12 |
| `speed` | `1` | 初始倍速 |
| `sound` | `false` | 声音 |
| `palette` | 8 色 | 光标配色 |
| `names` | 12 个名字 | 光标名牌文案 |
| `scale` | `1` | 光标大小 |
| `force` | `false` | 忽略 `prefers-reduced-motion`，强制播 |
| `startOnLoad` | `false` | `true` 时创建后自动 `play()`（等 DOM 就绪再开演） |
| `showControlPanel` | `false` | `true` 时在右下角显示内置控制面板（重建 / 还原 / 速度 / 声音） |
| `restoreOnFinish` | `false` | `true` 时动画结束自动还原真实页面 |
| `restoreDelay` | `900` | 自动还原前留出的毫秒数（让收尾动效走完） |

### 事件

```js
swarm.on('progress', ({ done, total, row }) => console.log(done / total))
swarm.on('done', () => console.log('交付完成'))
swarm.on('restored', () => console.log('真实页面回来了，可以交互了'))
```

## 它是怎么工作的

1. **快照**：遍历 DOM 与计算样式，把有底色 / 描边 / 圆角 / 阴影的拆成**盒子**；把带文字的拆成**文本层**（连字族、字重、行高、字距、颜色、内联多色片段一起取走）；单边描线与 `<hr>` 变成**钢笔线**；`img` / `svg` / `video` / `canvas` 变成**媒体**；尺寸一致的兄弟节点识别成一组母版 + **副本**。
2. **擦空**：原位盖一层带自己背景色的画布（shadow DOM 隔离，不受页面 CSS 影响），同时把子元素 `visibility: hidden` 保留布局与滚动高度。
3. **重建**：任务按纵向分行，一行建完才放下一行（留 2 行提前量）。光标领到任务先飞过去、按下、拖出带 `W × H` 标注的框，再填色 / 揭图 / 逐字打字；副本等母版落位后，用红色间距标注 ⌥ 拖出来。
4. **群集**：分离、趋近、避让鼠标三股力叠加，空闲时光标在待建区上方游走，收尾时一起从画面上沿飞走。

## 已知限制

- **视觉重建，不是克隆**：不做交互，按钮在重建层里点不动；动画在快照那一刻冻结。
- 快照发生在 `play()` 调用时，之后页面若改变（切换主题、滚动触发动画）不会同步。
- 跨域图片、`canvas` 若被污染，可能取不到内容（会自动退化为占位块）。
- 超长页面（数千个节点）会明显变慢，建议对单屏或一段区块使用，或把 `target` 收窄到某个 section。
- 字体需为系统已装字体：库按计算样式还原 `font-family`，不会去加载 webfont。

## 开发

目录里只有两份东西：`demo/index.html`（页面）和 `src/swarm-cursors.js`（库）。改完刷新即可，没有构建步骤、没有打包产物。

演示页支持几个 URL 参数，方便录屏与截图：

- `?auto` 自动开演（把 `startOnLoad` 打开）
- `?auto&speed=2` 指定倍速
- `?auto&advance=8000` 直接快进 8 秒（不依赖 rAF）
- `?auto&advance=16000&restore` 快进后立刻还原真实页面
- `?norestore` 关掉演示默认的「建完自动还原」，停在重建结果上
- `?panel=0` 隐藏右下角控制面板

## 许可

MIT。动效语言致意 Joel Califa 的 Swarm（原作未声明许可，若要复用其素材请先与其确认）与 DhvanilPatel 的扩展。
