# 实施规格：R3 Prefab/实例层 ｜ R5 确定性输入回放

> 前置：R1/R2 已合入（EventBus/HudView/tuning.json 存在）。实施前先读 ARCHITECTURE-REVIEW.md §2.2、AGENTS.md。
> 铁律同前：不改玩法手感；不加依赖；不改 military-tps；不 commit；不跑 playtest。

---

## R3：Prefab/实例层——实体的"组成"进数据

### 目标
消灭 main.ts 里的硬编码实体组装。世界实体（玩家/车/警察/未来的拾取物）由数据描述："预制体（prefab）定义组成，实例表（entities）定义摆放"。**验收场景：在 JSON 里加第二辆车，游戏里就出现第二辆可开的车，零代码改动。**

### 设计边界（重要）
- **进 Prefab 的**：世界实体（player / car / police）——有位置、有模型、玩家可交互
- **不进 Prefab 的**：系统单例（Wanted/Missions/Rules/Hud）——它们是"系统"，保持 main.ts 代码组装
- 这个边界写进 prefabs.json 的 _comment

### 文件契约

**1. `public/content/scene.json` 新增两段**
```json
"prefabs": {
  "_comment": "预制体=实体的组成配方。世界实体进这里；系统单例(Wanted/Missions等)不进。",
  "player": { "controller": "OnFootPlayer", "model": "soldier" },
  "car":    { "controller": "Car", "model": "procedural-car", "color": "#2f6fb0" },
  "police": { "controller": "PoliceNPC", "model": "soldier", "tint": "#2a4bd7" }
},
"entities": [
  { "prefab": "player", "name": "Player", "at": "spawns.player" },
  { "prefab": "car",    "name": "Car",    "at": "spawns.car" }
]
```
- `at` 只允许**命名点位**（spawns.*）或 `[x,z]` 数组（实例摆放坐标属内容数据，允许字面量，但必须过"不在建筑内"校验）
- spawns 段保留（点位注册表的角色不变）

**2. `src/game/PrefabRegistry.ts`（新建）**
- 组件工厂注册表：`register(type, factory)`；factory 签名 `(deps, params) => Component`
- deps 由 main 注入：`{ camera, physics, scene, content, tuning, assets }`
- 内置注册：OnFootPlayer / Car / PoliceNPC 三个 controller 类型 + 模型构建（soldier 克隆/程序化车），颜色/tint 参数生效
- `spawn(prefabName, name, pos): Entity`——供 main 与 WantedSystem 调用

**3. `content-lib/core.mjs`**
- `validateScene` 扩展（或新增 validatePrefabs）：prefab.controller ∈ 已知类型清单（清单以常量数组放 content-lib，与 PrefabRegistry 保持一致——加注释互相指向）；entities[].prefab 必须存在；`at` 为命名点位时必须可解析、为坐标时不得在建筑内（复用 insideAnyBlock）；实例 name 唯一
- d.ts 同步

**4. `src/main.ts`**
- startGame 里的 player/car 手工组装删除，改为遍历 `content.scene.entities` → `PrefabRegistry.spawn(...)`
- 多实例支持：`OnFootPlayer.tryEnterCar` 现在按名字找 'Car'——改为遍历 EntityManager 找**所有**含 Car 组件的实体，选最近的（<5m）；Car.exit 后 HudView 的速度表/提示同样取"当前激活的车"（建议：EntityManager 加 `GetAll(predicate)` 或在 demo 侧过滤 entities 数组）
- WantedSystem 造警察改走 `PrefabRegistry.spawn('police', ...)`

**5. `tools/content.mjs`**
- `list entities`、`add-entity --prefab car --name Car2 --at -13,39`、`remove-entity <name>`（照旧先校验后写）

**6. `tools/simulate.mjs`**
- L0 加 prefab/实例校验；L1 加场景断言："每个实例的落点不在建筑内"

### R3 验收（实施者自己跑并贴输出）
```bash
cd demos/gta-sandbox
node tools/simulate.mjs                                    # 全绿
node tools/content.mjs add-entity --prefab car --name Car2 --at -13,39   # 成功
node tools/simulate.mjs                                    # 仍全绿
node tools/content.mjs add-entity --prefab car --name Car3 --at 26,0     # 必须被拒（建筑内）
node tools/content.mjs remove-entity Car2                  # 清理还原
grep -n "new OnFootPlayer\|new Car(" src/main.ts           # 0 命中（组装已数据化）
```

---

## R5：确定性输入回放

### 目标
飞行记录仪升级为**可重演**：记录 tick 级输入流 + 随机种子，`?replay` 模式逐 tick 重放输入，最终状态与原局一致。玩家的 F9 诊断包从"看现场"升级为"重演现场"。

### 前提改造（确定性三件事）

**1. 随机数种子化**
- `WantedSystem.syncPolice` 里的 `Math.random()`（出警角度）改为实例化的 `mulberry32(seed)`（从 content-lib import）
- seed 来源：main 在 startGame 时生成 `runSeed = Date.now() % 2^31`，传入需要随机的系统；FlightRecorder 把 runSeed 记进 dump
- 全仓 grep `Math.random()`：`src/` 下游戏逻辑不得残留（Editor/视觉抖动类可留，逐一判断并在总结说明）

**2. tick 计数器**
- main 的固定步长循环维护 `tick`（每 substep +1），挂到 game 实例；FlightRecorder 记录事件时附带 tick

**3. 鼠标输入路径统一**
- 现状：OnFootPlayer 直接监听 mousemove 改 yaw/pitch——回放无法注入
- 改造：engine `Input` 新增鼠标增量累积：`AccumulateMouse(dx,dy)`（由真实 mousemove 监听器调用，监听器挪进 Input 单例）与 `ConsumeMouseDelta(): {dx,dy}`（每 tick 由控制器消费）。OnFootPlayer 改为在 Update 里 `Input.ConsumeMouseDelta()` 更新 yaw/pitch（pointer lock 判断保留在控制器）
- `Input.Press/Release` 已有；补 `SnapshotKeys(): string[]`（当前按下集合，录制用）

### 录制契约（FlightRecorder 扩展）
- 每 tick 记录（仅在有变化时记 delta，控制体积）：`{ tick, keysDown?: string[], keysUp?: string[], mouse?: [dx,dy] }`
- 输入流环形上限 ~36000 tick（10 分钟）；dump() 里带 `inputs`、`runSeed`、`contentFingerprint`（scene+missions+rules+tuning 的长度或简易 hash）
- 录制点：main 固定步长循环里，每 substep 调 `recorder.recordInputTick(tick)`（recorder 内部 diff 上一 tick 键集 + 取鼠标增量副本——注意：**录制读取不能消费**鼠标增量，控制器才是消费者；实现建议：Input.ConsumeMouseDelta 由控制器调用后，把"本 tick 实际消费值"存到 `Input.LastMouseDelta` 供录制读取）

### 回放契约
- `?replay` 模式：开局后暂不接管——通过 `window.__flight.replay(dumpJson)` 触发：
  1. 校验 contentFingerprint 匹配（不匹配给 console.warn 并继续，弹 toast 提醒）
  2. 用 dump.runSeed 重置随机系统（要求：WantedSystem 的 rng 可重设，或 replay 直接 location.reload 后由 `?replay&seed=` 初始化——**实现者选一条，写明理由**；推荐后者：`?replay` 时 main 从 URL 拿 seed，页面装载后 `__flight.loadReplay(dump)` 存住输入流并自动点 PLAY）
  3. 回放驱动：每 substep 按 tick 应用 keysDown/keysUp（Input.Press/Release）与 mouse（Input.AccumulateMouse），真实键鼠输入在回放期间忽略（Input 加 `replayMode` 开关）
  4. 结束：输入流耗尽后打印 `[replay] done tick=N playerPos=(x,z)` 并停在原地
- 回放验收断言：dump 里记录 `finalState: {tick, playerPos, wanted, mission}`（结束录制时写入——录制在 dump() 时截断并附当前状态）；回放结束比对 playerPos 距离 < 0.5m、mission/wanted 相等 → console.log `REPLAY_MATCH` / `REPLAY_MISMATCH {...}`

### R5 验收（实施者自己跑并贴输出；浏览器部分给出精确操作说明即可，由驱动者执行）
```bash
cd demos/gta-sandbox && node tools/simulate.mjs   # 回归全绿
grep -rn "Math.random()" src/ | grep -v editor    # 游戏逻辑 0 命中（或逐条说明为何无害）
```
浏览器验收步骤（写进总结，驱动者执行）：
1. 正常开局（记下 URL 带 `?seed=12345` 之类），走动+开车 ~20s，`__flight.dump()` 保存 JSON
2. 同 seed `?replay&seed=12345` 打开，`__flight.loadReplay(dump)` → 自动重演 → 期望 console 出现 `REPLAY_MATCH`

---

## 完成定义
1. 两组验收命令输出贴在最终总结；浏览器验收给出可复制粘贴的操作脚本
2. R3 后 main.ts 无世界实体手工组装；R5 后游戏逻辑无裸 Math.random、鼠标走 Input 统一路径
3. 未改玩法手感（tuning 数值未动、控制器行为等价）；未 commit
