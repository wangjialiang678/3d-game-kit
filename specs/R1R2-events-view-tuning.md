# 实施规格：R1 事件统一+系统去DOM+View层 ｜ R2 数值入数据

> 实施者请先读：ARCHITECTURE-REVIEW.md（§2.3/2.4/2.5 是本规格的动机）、AGENTS.md（全部约定必须遵守）。
> 铁律：**不改变任何玩法行为与手感**（数值逐一等值迁移）；不加新 npm 依赖；不改 demos/military-tps；不 git commit（由驱动者审查后提交）；不运行 playtest（需要 Chrome，由驱动者负责）。

---

## R1：事件统一 + 系统去 DOM 化 + View 层

### 目标
1. 引擎级类型化事件总线，事件名单一来源（现状：Entity.Broadcast / demo Bus / window.__flight 旁路 / rules.mjs EVENTS 四处并存）
2. `src/entities/*` 零 DOM 依赖（现状：WantedSystem/MissionSystem 直接写 DOM）——为无头运行系统层铺路
3. HUD 呈现收敛到独立 View 层

### 文件契约（逐文件）

**1. `packages/engine/src/EventBus.ts`（新建）**
```ts
type Handler = (data?: any) => void;
class EventBusClass {
  register(...events: string[]): void;   // 注册合法事件名
  on(event: string, h: Handler): void;   // 对未注册事件 console.warn 并照常订阅
  emit(event: string, data?: any): void; // 对未注册事件 console.warn；先通知 taps 再通知 handlers
  tap(fn: (event: string, data?: any) => void): void;  // 全量旁听（飞行记录仪用）
  reset(): void;                         // 清空 handlers/taps（保留注册表；测试用）
}
export const EventBus = new EventBusClass();
```
在 `packages/engine/src/index.ts` 导出 `EventBus`。

**2. `demos/gta-sandbox/content-lib/events.mjs`（新建，事件名单一来源）**
```js
/** 每个事件附 JSDoc 说明 data 结构 */
export const EVENTS = ['busted','wanted-raise','wanted-drop','wanted-changed',
  'mission-complete','mission-changed','enter-car','exit-car','toast'];
```
`content-lib/rules.mjs` 删除自己的 EVENTS 定义，改为 `import { EVENTS } from './events.mjs'` 并 **re-export**（保证 tools/simulate.mjs 现有 import 不变）。新增 `events.d.ts`。

**3. `demos/gta-sandbox/src/events.ts`（重写）**
```ts
import { EventBus } from '@engine';
import { EVENTS } from '../content-lib/events.mjs';
EventBus.register(...EVENTS);
export const Bus = EventBus;   // 保持现有 `import { Bus } from '../events'` 兼容
```
删除原来 window.__flight 转发（改由 FlightRecorder tap，见 7）。

**4. `src/entities/WantedSystem.ts`**
- 删除全部 DOM：`starsEl`、`toastEl`、`toastTimer`、`renderStars()`、`toast()` 方法、Update 里的 toastTimer 块
- 星级每次变化处（raise / 降星 / bust）emit `wanted-changed` `{ level }`
- 原 `this.toast(x)` 调用点一律改 `Bus.emit('toast', { text: x })`
- 公开 API `get Level()` 保持不变

**5. `src/entities/MissionSystem.ts`**
- 删除 `objEl`、`navEl`、`updateNav()`、`ARROWS`（DOM 部分全删）
- 新增公开 getter：`get CurrentText(): string`（含全部完成时的通关文案）、`get CurrentTarget(): [number, number] | null`
- `applyMission()` 时 `Bus.emit('mission-changed', { text })`
- `complete()` 里 `wanted?.toast(...)` 改 `Bus.emit('toast', {...})`
- 3D 光柱 marker 保留在本组件（属世界对象，不是 DOM）

**6. `src/entities/RuleSystem.ts`**
- `toast` 动作执行器改 `Bus.emit('toast', { text })`（不再 FindEntity('Wanted')）

**7. `src/debug/FlightRecorder.ts`**
- 构造函数里 `EventBus.tap((e, d) => this.event(e, d))`——所有总线事件自动进黑匣子
- 其余（watchdog / F9 / dump / banner）保持不变

**8. `src/view/HudView.ts`（新建，View 层）**
- Component，name `'HudView'`，构造 `(camera: THREE.Camera)`
- 订阅 `wanted-changed` → 渲染星星（原 renderStars 逻辑迁入）；订阅 `toast` → 显示文本 + 自己管理 2.5s 淡出计时（在 `Update(t)` 里递减）
- `Update(t)` 中 pull（读系统状态写 DOM，值变化才写）：
  - `MissionSystem.CurrentText` → `#mission .obj`
  - `MissionSystem.CurrentTarget` + camera → 导航箭头+距离（原 updateNav 逻辑整体迁入，含 ARROWS）
  - `Car.Active` → 速度表显隐与数值、"按 F 下车"提示；步行且距车 <5m → "按 F 上车"（原 main.updatePrompt 逻辑整体迁入）

**9. `src/main.ts`**
- 删除 `updatePrompt` / `prompt` / `speedEl` 成员与调用
- `startGame()` 中新增实体 `Hud`，装 `new HudView(this.camera)`（放在 Missions 实体之后）

### R1 验收（实施者必须自己跑并在总结里贴结果）
```bash
# a) 系统层零 DOM（entities/ 目录必须 0 命中）
grep -rn "document\.\|getElementById" demos/gta-sandbox/src/entities/
# b) L0+L1 全绿
cd demos/gta-sandbox && node tools/simulate.mjs
```

---

## R2：调参数值迁入 tuning.json + 关系断言

### 目标
组件里的策划数值（车速/警力/甩脱距离/射速类）全部迁入内容层，接受 L0 校验，含**跨项关系断言**（如"车必须明显快于警察"——这条若早存在，警察永追不放的设计缺陷会在保存时被拦下）。

### 文件契约

**1. `demos/gta-sandbox/public/content/tuning.json`（新建）**
```json
{
  "_comment": "策划调参表。数值改这里，刷新即生效；加载时做范围与关系校验。",
  "player": { "maxSpeed": 5.0, "accelTime": 0.09, "jumpVelocity": 6, "mouseSpeed": 0.0022 },
  "car":    { "maxSpeed": 17, "accel": 13, "brake": 24, "reverseMax": 6, "steer": 1.7 },
  "police": { "speed": 4.4, "perStar": 2, "escapeDist": 45, "escapeTime": 5,
              "bustDist": 1.8, "cullDist": 65, "spawnRadius": 30 },
  "mission": { "completeRadius": 3.5 }
}
```
⚠️ 数值必须与当前代码常量**逐一相等**（等值迁移，不调平衡）。迁移前先从代码里核对每一个。

**2. `content-lib/core.mjs` 新增 `validateTuning(t)`（d.ts 同步）**
- 结构/类型/正数校验（缺 section、非数字、≤0 都报 Issue）
- **关系断言**（报错文案要说清"为什么"）：
  - `car.maxSpeed >= police.speed * 2`（车必须显著快于警察，否则开车甩脱不可玩）
  - `player.maxSpeed > police.speed`（步行必须能拉开距离，否则被抓是必然不是失误）
  - `police.escapeDist < police.cullDist`（先够到甩脱线才可能触发跟丢）

**3. `src/content/ContentLoader.ts`**
- `loadContent` 加第 4 个参数 `tuningUrl`；`Content` 接口加 `tuning` 字段（类型写全）

**4. `src/main.ts`**
- 加载 `/content/tuning.json`；`validateTuning` 结果拼进 issues（校验不过不开局）

**5. 组件等值改造（构造注入，不用全局变量）**
- `OnFootPlayer`：MAX_SPEED/ACCEL(由 accelTime 换算)/jumpVelocity(现值 6)/MOUSE ← tuning.player
- `Car`：MAX_SPEED/ACCEL/BRAKE/REVERSE_MAX/STEER ← tuning.car
- `WantedSystem`：PER_STAR/ESCAPE_DIST/ESCAPE_TIME/BUST_DIST/CULL_DIST/spawn 半径 30 ← tuning.police；创建 PoliceNPC 时把 `speed` 传给它
- `PoliceNPC`：SPEED ← 构造参数
- `MissionSystem`：完成半径 3.5 ← tuning.mission.completeRadius
- **留在代码里的**（几何/实现细节，策划不调）：CAP_HALF、CAP_RADIUS、FOOT、FACING_OFFSET、相机偏移（TP_DIST 等）、FRICTION、HALF（车碰撞盒）——判据见 ARCHITECTURE-REVIEW.md §4
- main 组装处把 `this.content` 或 `tuning` 子对象传入各构造函数

**6. `tools/content.mjs`**
- `list tuning`：打印当前 tuning
- `tune <dot.path> <value>`：如 `tune police.speed 5`——改后先 `validateTuning`（连同其余校验），失败 exit 1 不落盘

**7. `tools/simulate.mjs`**
- L0 段加入 `validateTuning`（3 项关系断言纳入统计）

### R2 验收（实施者必须自己跑并贴结果）
```bash
cd demos/gta-sandbox
node tools/simulate.mjs                       # 全绿
node tools/content.mjs tune police.speed 20   # 必须被关系断言拒绝，exit 1，文件未变
node tools/content.mjs list tuning            # 与迁移前常量逐项一致
```

---

## 完成定义（Definition of Done）
1. R1+R2 全部契约实现；两组验收命令输出贴在最终总结
2. `grep` 验收 a) 零命中；simulate 全绿；tune 负向测试被拒
3. 未改 military-tps、未加依赖、未 commit、未改玩法数值
4. 代码风格与现有一致：中文注释解释"为什么"（尤其是护栏类代码要写清楚防的是哪类真实 bug）
