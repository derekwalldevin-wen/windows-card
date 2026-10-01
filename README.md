# 窗边牌局

手机竖屏优先的单人卡牌构筑小游戏。

- **第 1 步**：空桌 3D 场景 + 竖屏布局（已验收，3D 源码保留）
- **第 2 步**：基础选牌计分练习模式 + 猫咪对手展示区（已验收）
- **第 3 步**：新版美术方向 —— 七猫真实透明贴图 + 小计分牌 + 单行 HUD（已验收）
- **第 4 步**：静态背景接入 —— 背景改用图片，正式入口不再创建 Three.js 场景（当前）

## 本机运行

```bash
cd Z:\00-VIBECODING\窗边牌局
npm install        # 仅本项目依赖，不装全局工具
npm run dev        # 仅监听 127.0.0.1:5173
```

其他命令：

```bash
npm run typecheck  # tsc --noEmit（含 tests/）
npm test           # node --test，共 39 项规则与状态机测试
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 仅本机预览构建产物
```

URL 参数：`?seed=123` 换一副牌 · `?guides=1` 显示分区轮廓 · `?selfcheck=1` 输出实测数据 · `?cat=forest` 指定对手（仅验收用，正常游玩随机）

种子**不在界面上显示**：每轮随机，需要复现时用上面的 `?seed=`。

## 分层

```
src/
├─ rules/        唯一权威规则实现（不 import three、不碰 DOM）
│  ├─ cards.ts      52 张牌、唯一 ID、种子洗牌、计分点数
│  ├─ evaluate.ts   九种牌型判定 + 计分牌/陪牌划分
│  └─ session.ts    练习局状态机（选牌/出牌/弃牌/结束/重开）
├─ store.ts      唯一权威状态（dispatch / subscribe，同步）
├─ scene/        Three.js 场景源码（第 4 步起正式入口不再调用，保留待回退）
├─ ui/           DOM：背景层、猫咪贴图、小计分牌、手牌 4+4、单行 HUD、按钮
│  ├─ background.ts     背景缩放规则 + 猫脚锚点换算（anchorToScreen）
│  ├─ cat-placement.ts  逐猫脚底锚点（手工调校）
│  └─ cat-manifest.json 七猫名册（由 tools/cat-export.mjs 从像素生成，勿手改）
├─ lib/rng.ts    确定性随机（规则层与 3D 层共用）
└─ dev/          仅开发用的自检
assets/cats/         猫咪素材原图（只读，不参与构建）
assets/background/   背景原图（只读）
public/cats/         猫派生图：裁到 alpha 内容框 + 缩放到 640px 高，实际加载这份
public/backgrounds/  背景图，构建后进 dist
tests/           node:test，39 项
tools/           见下表
```

### 猫咪贴图管线

`assets/cats/*.png` 是原图（不动）。`tools/cat-export.mjs` 生成两份产物：

| 产物 | 作用 |
|---|---|
| `public/cats/cat-<id>.png` | 裁掉四周透明留白、等比缩放到 640px 高。锚点因此就是**底边中点**，接入时不需要再算留白补偿 |
| `src/ui/cat-manifest.json` | 名册：id、中文名、姿态、宽高比、裁框。尺寸由脚本量出来，不手抄 |

重新生成：`node tools/cat-export.mjs 640`。原图 9.37MB → 派生图 3.5MB。

### 背景与猫咪落位（第 4 步起）

背景是一张静态图 `public/backgrounds/cozy-window-table-background-v1.png`（852×1846）。
**正式入口不再创建 Three.js 场景**：不取 WebGL 上下文、不跑渲染循环，
`dist` 里也不含 three 的渲染代码。`src/scene/` 与 `three` 依赖都保留，
需要回退时改回调用 `createStage()` 即可。

缩放规则只有一套，在 `src/ui/background.ts`：

```
scale = max(容器宽 / 852, 容器高 / 1846)   // 等比，绝不拉伸
水平：居中（两侧等量裁）
垂直：顶部对齐（保住窗户，裁掉的是桌面上方空白）
```

猫脚锚点用**同一套几何**换算：`屏幕位置 = 背景左上角 + 归一化坐标 × 缩放后尺寸`
（`anchorToScreen()`）。因此背景与猫永远同步，
不会出现「背景按宽缩放、猫却按视口高度定位」这种两套定位。

背景原图实测值（`tools/measure-background.mjs`）：

| 项目 | 原图坐标 |
|---|---|
| 桌垫范围 | x 54~793，y 348~600 |
| 猫脚锚点 | (424, 504)。你建议的 (426, 520) 同样有效，取 504 让猫站在桌垫偏后 |
| 窗户下沿 | y ≈ 295，短屏裁切不会裁到这里以上 |

逐猫脚底锚点在 `src/ui/cat-placement.ts`，**手工调校**：

> `tools/measure-cat-feet.mjs` 的自动检测对森林猫 / 樱花猫 / 冰翼猫是错的 ——
> 它们裁切后的底边是大尾巴或翼下缘，不是脚；坐姿猫的臀还比脚掌宽。
> 目视核对过程见 `shots/cat-feet-sheet.png`。

七只猫共用同一套背景缩放，落位时按各自的 `footX`（横向）、`footLift`
（脚底离图底边的上提量）、`scale`（体量微调）对齐到锚点。

**背景层不拦截操作**：`.bg-layer` 是 `pointer-events: none`。
卡牌是 DOM `<button>`，视觉区域＝点击区域＝键盘可达区域，**不存在两套点击热区**。

背景图加载失败时降级为暖木色渐变底 + 明确提示，界面与卡牌仍可正常操作。

## 计分规则（原型测试值，未平衡）

`得分 =（牌型基础筹码 + 参与计分的牌点之和）× 牌型倍率`

| 牌型 | 基础 | 倍率 | 需 5 张 |
|---|---|---|---|
| 同花顺（含皇家） | 100 | 8 | 是 |
| 四条 | 60 | 7 | 否 |
| 葫芦 | 40 | 4 | 是 |
| 同花 | 35 | 4 | 是 |
| 顺子 | 30 | 4 | 是 |
| 三条 | 30 | 3 | 否 |
| 两对 | 20 | 2 | 否 |
| 一对 | 10 | 2 | 否 |
| 高牌 | 5 | 1 | 否 |

点数：2—10 面值，J/Q/K = 10，A = 11。A2345 与 10JQKA 为顺子，QKA23 不是。
只计算构成牌型的牌（高牌只计最高一张），其余选中牌为**陪牌**：不计分，但照样被消耗。

## 验收工具

```bash
# 精确视口截图 + 控制台错误/警告统计
node tools/shot.mjs "http://127.0.0.1:5173/?selfcheck=1" shots \
  "m360:360x640:mobile" "m390:390x844:mobile" "m430:430x932:mobile" "d1440:1440x900"

# 真实鼠标事件走一遍完整流程（26 项断言）
node tools/playtest.mjs "http://127.0.0.1:5173/" playtest 390 844

# 把 selfcheck 的分区读数打成表：背景变形/露底、猫出界、按钮可点性
node tools/print-zones.mjs shots

# 打印报告里记录的控制台错误/警告
node tools/print-problems.mjs shots

# 七只猫 × 四个视口：脚底是否落在桌垫上、是否出界、是否压住 HUD（28 项）
node tools/cat-bg-check.mjs http://127.0.0.1:5173 shots/cat-bg

# 连续改视口，确认背景与猫同步定位（8 个视口切换）
node tools/bg-resize-sync.mjs http://127.0.0.1:5173

# 背景图 404 时的降级：提示是否可见、界面是否仍可操作（12 项）
node tools/bg-fallback-check.mjs http://127.0.0.1:5173

# 确认没有活动的旧 WebGL 渲染循环（5 项）
node tools/no-webgl-check.mjs http://127.0.0.1:4173 dist
```

素材与背景测算（只读，不改 `src/`）：

| 脚本 | 作用 |
|---|---|
| `measure-background.mjs` | 从背景图量出桌垫、窗户的实际边界 |
| `measure-cat-png.mjs` | 手写 PNG 解码，量七猫 alpha 内容框与四边留白 |
| `measure-cat-feet.mjs` | 量猫底边着地点（**仅供参考，见上面的失效说明**） |
| `cat-feet-sheet.mjs` | 七猫底部 30% 放大对照，肉眼确认底边是脚还是尾巴 |
| `cat-contact-sheet.mjs` | 七猫全身对照，核对姿态与裁切 |
| `cat-export.mjs` | 生成 `public/cats/` 派生图与 `cat-manifest.json` |
| `sample-pixels.mjs` | 从截图客观取色 |

第 1~3 步的历史测算脚本（`analyze-*.mjs`、`cat-safe-range-check.mjs`、
`new-layout-preview.mjs`、`cat-all-check.mjs`）保留在 `tools/` 里作为决策依据，
其中涉及 3D 投影的部分已不适用于第 4 步。

以上都只绑定 127.0.0.1，不开放局域网端口，不安装 Playwright。

## 已知限制

- 猫咪只有展示形象：**没有 AI 出牌、没有生命值、没有攻击**。练习模式里玩家是独自操作。
- **「不再绘制 3D」不等于手机性能达标。** 只验证了页面上没有活动渲染循环
  （`tools/no-webgl-check.mjs` 5 项通过），真实手机上的加载耗时、内存、
  发热与掉帧**均未实测**。
- 背景图 1.9MB + 猫图 3.5MB 都是未压缩优化的 PNG，首屏会等解码；
  没有做 WebP/AVIF 转换，也没有预加载下一只猫。
- 短屏（360×640）背景底部裁掉 140px、桌面端裁掉 202px，裁的都在空白桌面区域；
  桌面端若窗口更矮，裁切量还会增加。
- 逐猫锚点是手工调校的，换背景图或改猫素材后**必须重新目视核对**，
  `measure-cat-feet.mjs` 不能替代。
- 桌面浏览器尺寸的验证只证明布局，**不代表真实手机触控、性能或安全区已验收**。
- 素材是 AI 去背景稿，低透明度边缘可能残留少量碎屑；派生图降采样到 640px 时会顺带抹掉一部分。
