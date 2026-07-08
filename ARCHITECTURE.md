# 3d-game-kit 技术结构与定制指南

> 面向：营地学员 + AI 编码代理。读完你就知道这套框架**由什么组成、原理是什么、能改成什么、怎么改、哪里改**。
> 技术栈是 **Three.js（网页/WebGL）**，不是 Godot / Unity / Unreal。

## 0. 一句话定位

**这是一个通用的、组件化的 Web 3D 游戏框架（`packages/engine`）+ 多个独立 demo（`demos/*`）**。同一套框架，换素材 + 换/加组件，就能做成很多类 3D 游戏——仓库里已经有两个证明：`military-tps`（第三人称射击）和 `gta-sandbox`（开车/通缉/任务的小镇沙盒），它们共用同一份引擎代码。

## 1. 技术栈

| 层 | 用什么 | 作用 |
|---|---|---|
| 构建/语言 | Vite + TypeScript + npm workspaces | 开发服务器、热更新、monorepo |
| 渲染 | **Three.js（WebGL，非 Godot/Unity/Unreal）** | 3D 画面，直接跑在浏览器 |
| 物理 | Rapier（`@dimforge/rapier3d-compat`，WASM） | 碰撞、角色控制器、射线 |
| 架构 | 自研 Entity-Component（ECS-lite） | 游戏对象与行为的组织方式 |

## 2. 目录结构（每个文件一句话职责）

```
packages/engine/src/            ← 共用框架：与任何游戏品类无关，所有 demo 复用
│   ├── Entity.ts               实体 = 名字 + 位置 + 组件字典 + 消息总线
│   ├── Component.ts            组件基类（Initialize / Update / PhysicsUpdate 生命周期）
│   ├── EntityManager.ts        管理所有实体；支持运行时 Add/Remove（EndSetup 后 Add 自动初始化）
│   ├── FiniteStateMachine.ts   状态机（敌人 AI、武器状态用）
│   ├── Physics.ts              Rapier 封装（静态盒/三角网格碰撞、角色控制器、运动学体、射线）
│   ├── Input.ts                键鼠输入单例（失焦/解锁自动清键，防"卡键"）
│   └── index.ts                统一出口：demo 里 `import {...} from '@engine'`

demos/military-tps/             ← demo 1：第三人称军事射击
│   └── src/entities/           ThirdPersonPlayer(FP/TP切换+射击) / SoldierNPC(敌人AI) / UIManager
demos/gta-sandbox/              ← demo 2：GTA 式小镇沙盒
│   └── src/entities/           OnFootPlayer(步行) / Car(驾驶+F上下车) /
│                               WantedSystem(通缉星级+被捕) / PoliceNPC(警察追捕) / MissionSystem(任务链)

每个 demo 还有：
│   ├── src/main.ts             组装层：建渲染器 / 加载资产 / 造关卡 / 拼实体 / 主循环
│   ├── src/util/               程序化模型等工具（车/枪/标记/士兵克隆）
│   └── public/assets/          数据层：模型、贴图、天空（换文件就换美术）
```

## 3. 心智模型：三层分离

游戏被拆成三层，**互不干扰**，这是"能随便改而不崩全局"的根本原因：

| 层 | 是什么 | 在哪 |
|---|---|---|
| **数据层** | 3D 模型、贴图、天空、音效（外部文件） | `public/assets/` |
| **表现层** | Three.js 场景、相机、材质、光照（怎么显示） | `main.ts` + `ThirdPersonPlayer.ts` 的相机块 |
| **逻辑层** | 移动、射击、AI（怎么行为） | `entities/` 各组件 |

换一个模型文件 → 逻辑不动、样子变；改几行相机 → 素材不动、视角变；改 AI 数字 → 样子不动、行为变。

## 4. 核心原理：Entity-Component 架构

### 三个概念
- **Entity（实体）**：一个空壳，只有 `name`、`position`、`rotation`、一个组件字典、一个消息总线。玩家、每个敌人、UI 各是一个实体。
- **Component（组件）**：一段自带行为的模块。有生命周期方法 `Initialize()`（开局调一次）和 `Update(dt)`（每帧调一次）。例：`ThirdPersonPlayer`、`SoldierNPC`、`UIManager`。
- **EntityManager**：装所有实体，`Get(name)` 按名查找，每帧 `Update` 遍历所有实体→所有组件。

### 怎么"拼"出一个游戏
看 `main.ts` 的 `startGame()`：
```
玩家实体 = new Entity(); 装上 ThirdPersonPlayer 组件
5 个敌人实体 = new Entity(); 各装上 SoldierNPC 组件
UI 实体 = new Entity(); 装上 UIManager 组件
entityManager.EndSetup()   // 统一 Initialize
```
**游戏 = 实体 + 组件的组合**。加内容 = 加实体/加组件，不用改老代码。

### 一帧发生了什么（主循环，`main.ts` 的 `loop`）
```
1. physics.step()            → Rapier 推进一步物理
2. entityManager.Update(dt)  → 每个实体的每个组件跑 Update：
                               玩家读输入→移动→动画→射击；敌人跑 AI；UI 刷新
3. renderer.render()         → Three.js 画这一帧
```

### 组件之间怎么沟通：消息总线（松耦合）
不直接互相调用，而是**发消息**。例：玩家开枪命中 → `entity.Broadcast({topic:'hit', amount:12})`；敌人的 `SoldierNPC` 事先 `RegisterEventHandler(takeHit, 'hit')` 收到并掉血。加/删对象不会互相牵连。

### 物理怎么接
- 关卡：静态盒子/三角网格碰撞（`Physics.addStaticBox` / `addTrimesh`）。
- 玩家：Rapier `KinematicCharacterController`（自动处理台阶/斜坡/贴地）。
- 命中判定：`Physics.raycast` 打出射线 → 命中的碰撞体通过 `colliderToEntity` 映射回实体 → 发 `hit` 消息。

## 5. 能做成哪些游戏（品类适配）

| 品类 | 要改什么 | 现实度 |
|---|---|---|
| 第一人称 FPS | 相机放头部、武器做视角模型（就是本项目的前身 three-fps-modern） | ✅ 直接 |
| 第三人称 TPS | —— | ✅ 本项目就是 |
| 动作/冒险/RPG | 换玩法组件 + 加"对话/物品/任务"新组件 | ✅ 加系统 |
| 潜行 | 改 `SoldierNPC` 的视线/警觉逻辑 | ✅ 改逻辑 |
| 俯视 RTS/塔防 | 相机改俯视 + 控制改"点选"组件 | ✅ 换组件 |
| 平台跳跃 | 角色控制器已有跳跃，改关卡+相机 | ✅ 容易 |
| 赛车/载具 | 用 Rapier 载具物理写一个 Vehicle 组件 | ⚠️ 能做，需新系统 |
| **开放世界** | 加地形 + 分块流式 + LOD + 实例化 + AI 降级 | ⚠️ 大工程（见 §7） |
| 联机多人 | 加网络同步层（状态同步） | ⚠️ 能做但复杂 |
| 2D / 卡牌 / 回合制 | —— | ❌ 这套是实时 3D，请换别的框架 |

## 6. 定制化：想改 X → 动哪里

### 美术素材
| 想改 | 动哪 | 说明 |
|---|---|---|
| 换人物 | `main.ts` `loadAssets()` 的 `Soldier.glb` 路径 | 最好是 **Mixamo 骨骼**模型；代码按 `RightHand` 找手骨、按 Idle/Walk/Run 找动画 |
| 换武器 | `util/soldier.ts` 的 `buildRifle()` | 现为程序化枪；换成 `GLTFLoader` 加载真枪模型即可 |
| 换地面/墙/天空 | `main.ts` `loadAssets()` 的贴图/HDRI 路径 | 直接换文件（CC0 素材） |
| 敌人配色变体 | `main.ts` 的 `spawns` 数组里的 tint 颜色 | 改颜色或换不同模型 |

### 视角（全部在 `entities/ThirdPersonPlayer.ts`）
- 顶部常量：`TP_DIST`（镜头距离）、`TP_PIVOT_Y`（高度）、`TP_SIDE`（越肩偏移）、相机 FOV、`MOUSE`（灵敏度）
- FP/TP 切换：`toggleMode()`（按 V 触发）

### 逻辑设计
| 想改 | 动哪 |
|---|---|
| 移动速度/跳跃/射速/伤害/弹匣 | `ThirdPersonPlayer.ts` 顶部常量（`MAX_SPEED`/`fireRate`/`damage`/`magAmmo`…） |
| 敌人 AI（视野/开火距离/速度/状态机） | `SoldierNPC.ts`（`VIEW_DIST`/`SHOOT_RANGE`/`MOVE_SPEED` + idle/chase/shoot/dead） |
| 关卡布局/掩体 | `main.ts` `buildArena()` 的 `covers` 数组 |
| 敌人数量/出生点 | `main.ts` 的 `spawns` 数组 |
| 加全新机制（手雷/血包/计分/多武器） | 写一个**新组件**，装到实体上 |

## 7. 能力边界（能做 / 不能做）—— 诚实版

**能做（web 实时 3D 的舒适区）**：实时 3D 渲染、物理碰撞、骨骼动画、光照/HDRI、完整可玩循环、几百个对象、多种品类换皮。

**难做/受限（web 平台约束）**：
- **内存**：浏览器一般几个 GB 上限，装不下巨型世界 → 必须"分块流式加载"。
- **下载体积**：不能让用户先下几十 GB 素材 → 内容量天然受限。
- **单线程 JS**：重活（地形生成、大物理）要挪到 Web Worker，复杂度上升。
- **draw call 上限**：海量物体必须"实例化 + LOD"。

**不能做（这套框架现状直接做不了）**：GTA/荒野大镖客级的无缝高密度开放世界、AAA 画质、大规模在线——这些是 AAA 团队×年的量级，web 平台也不现实。

### 开放世界专题（想往大世界走）
现在是 60×60 米封闭竞技场、一次性全加载。要变"可探索大世界"，得**加这几个系统**（ECS 架构支持"加系统"而非重写）：
1. 地形（高度图 + 分块）
2. **区块流式加载**（按玩家位置加载/卸载世界区块 + 里面的实体 + 碰撞体）← 最核心最难
3. LOD + 植被/道具实例化
4. AI 降级（远处 NPC 少算或冻结）

难度阶梯：`小竞技场(现在)✅ → 更大关卡(改数组)✅ → 分块流式大世界(几周硬工程)⚠️ → 真开放世界(不现实)❌`。
**最大瓶颈其实是"内容量"**，而这正是 AI 生成能帮上大忙的地方——代码框架反而不是瓶颈。

### 分块动态加载专题（"走到边界再加载下一块地图"可行吗？）

**可行，且当前框架天生支持**，原因是三项运行时能力都已具备：
- 实体可**运行时增删**（`EntityManager.Add/Remove`，EndSetup 后 Add 自动 Initialize——gta-sandbox 的警察刷出/消散就在用）
- Rapier 碰撞体可**动态创建/销毁**
- Three.js 物体可随时 `scene.add/remove`

做法：把世界切成网格区块，一个区块 = `{ 网格模型 + 碰撞体 + 实体 }` 的清单；写一个 **ChunkManager 组件**，每帧看玩家在哪个区块，**加载周围 N×N 圈、卸载走远的**。你说的"到边界才加载下一块"就是它的最简版（N=1）。

要注意的三件事（这是工程难点，不是框架限制）：
1. **接缝**：相邻区块边缘的地形/道路要对齐（手工地图按网格设计即可；程序化地形用连续噪声天然无缝）
2. **异步**：加载模型要在后台做（GLTFLoader 本身异步），别在跨界瞬间卡顿；可提前一圈预加载
3. **状态**：玩家/车/任务这些"全局实体"不属于任何区块，不随区块卸载

规模参考：手工设计的几公里级世界（几十个区块）用这套完全够；配合 LOD + 实例化可以再上一个量级。

### 专题：GTA 类玩法能做吗？（坐车、通缉系统、任务…）

把 GTA 拆成两部分看，结论**完全相反**：

**A. 玩法机制——大多能做**（这些主要是"逻辑"，正是 ECS 架构擅长的，多数是加一个组件/系统）：

| 机制 | 怎么实现 | 难度 |
|---|---|---|
| 坐车 / 开车 | 写一个 `Vehicle` 组件（用 Rapier 载具物理）；上下车 = 切换玩家的控制组件（跟 FP/TP 切换同理） | ⚠️ 中（要调载具手感） |
| 通缉系统 | 一个 `WantedSystem`（通缉等级状态）+ 警察 NPC（`SoldierNPC` 变体），按等级刷警力、逐级升级追捕 | ✅ 易（纯逻辑 + 状态机） |
| 任务系统 | 一个 `MissionManager` + **数据化的任务定义**（触发点 / 目标 / 奖励）+ 对话组件 | ✅ 易（逻辑 + 数据） |
| 行人 / 交通 | 大量 NPC + 简单 AI + 生成/回收 | ⚠️ 中（数量一多要 AI 降级 + 实例化） |
| 抢车 / 战斗 / 血量 / 金钱 | 复用已有的命中、血量、消息机制，扩展即可 | ✅ 易 |

**B. 世界规模与内容——这才是真瓶颈**（跟开放世界同一批难题）：无缝大地图的流式加载、海量车辆/建筑/NPC/任务内容、交通与行人的模拟深度。这部分是 AAA 团队 × 年 + web 平台限制。

**结论**：
- ✅ **做一个"小型 GTA 式沙盒"完全可行**——一座小镇、能开的车、会升级的通缉、几个任务——是很好的**进阶营地项目**。
- ❌ **做一个真·GTA 不现实**——卡住的**不是**"坐车/通缉/任务"这些机制（这些反而容易），而是**世界规模 + 内容量**（几百辆车、几十小时任务、无缝大地图 + AAA 画质）。
- 一句话记住：**机制能装进这套架构，"规模和内容"才是天花板；而内容量恰恰是 AI 生成能帮上最大忙的地方。**

## 8. 常见任务配方（step-by-step）

**换一把真枪**：下载一把枪的 GLB → 放 `public/assets/weapons/` → `util/soldier.ts` 里把 `buildRifle()` 改成 `GLTFLoader.loadAsync(...)` 返回那个模型。

**换主角/敌人模型**：下载 Mixamo 士兵（FBX/GLB，带 idle/walk/run）→ 放 `public/assets/characters/` → 改 `main.ts` 加载路径；若动画名不同，改组件里 `setAnim('Idle'/'Walk'/'Run')` 的名字。

**加一种敌人**：在 `main.ts` 的 `spawns` 数组加一项（坐标+配色）；想要不同行为就复制 `SoldierNPC.ts` 改成新组件（如 `SniperNPC`）再装上。

**加一个新机制（例：血包）**：新建 `entities/HealthPack.ts`（一个组件：显示模型 + 检测玩家靠近 + 发 `heal` 消息）→ 在 `main.ts` 造几个血包实体装上它。**不用改任何现有文件**。

**做更大的关卡**：改 `buildArena()` 把 `ARENA` 调大、往 `covers` 加更多掩体/建筑；或改成用 `GLTFLoader` 加载一个关卡 GLB + `addTrimesh` 生成碰撞（参照姊妹项目 three-fps-modern）。

## 9. 运行与验证

```bash
npm install
npm run dev          # → http://127.0.0.1:5176/，点 DEPLOY
```
操作：WASD 移动 · 鼠标越肩瞄准 · 左键射击 · R 换弹 · 空格跳 · **V 切第一/第三人称**。

**改完怎么验证**：跑起来在浏览器里实际操作一遍（不是只看代码通过）。这也是营地强调的：AI 改完代码，要"真的跑起来看效果"。

---

## 关键约定（改动时请遵守）

1. **保持三层分离**：换美术只动 `public/assets/` + 加载路径；改玩法只动 `entities/`；`engine/` 一般不动（除非加通用能力）。
2. **新行为 = 新组件**，而不是把逻辑塞进已有文件。
3. **数据驱动优先**：能靠改常量/数组解决的，就别写死在逻辑里。
4. **换角色注意 Mixamo 骨骼**：非标准骨骼要调"找手骨/找动画"两处。
5. **别提交 `node_modules/`**（已在 `.gitignore`）。
