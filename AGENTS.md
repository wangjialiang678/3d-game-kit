# AGENTS.md — 给 AI 编码代理的操作手册

> 这是一个 monorepo：**共用 Web 3D 游戏框架（`packages/engine`）+ 多个独立 demo（`demos/*`）**。
> 技术栈：**Three.js（网页/WebGL）+ Rapier + TypeScript + Vite**。不是 Godot / Unity / Unreal。
> 动手前先读 [ARCHITECTURE.md](./ARCHITECTURE.md)（原理、能做/不能做、定制配方）。

## 项目地图
- `packages/engine/src/` — 共用框架（Entity/Component/EntityManager/FSM/Physics/Input，出口 `index.ts`）。**所有 demo 共享；改这里会影响全部 demo，谨慎且保持通用。**
- `demos/military-tps/` — 第三人称军事射击（ThirdPersonPlayer / SoldierNPC / UIManager）
- `demos/gta-sandbox/` — GTA 式小镇沙盒（OnFootPlayer / Car / WantedSystem / PoliceNPC / MissionSystem）
- 每个 demo：`src/main.ts` 组装层、`src/entities/` 玩法组件、`src/util/` 程序化工具、`public/assets/` 美术

## 运行与验证（改完必须做）
```bash
npm install            # 根目录一次
npm run military       # → http://127.0.0.1:5176/
npm run gta            # → http://127.0.0.1:5177/
```
改完**必须在浏览器里实际操作验证**（不是只看编译通过）。gta 操作：WASD/F 上下车/G 涨通缉；military 操作：WASD/左键射击/V 切视角。

## 想改什么 → 改哪里（速查）
| 需求 | 位置 |
|---|---|
| 引擎能力（新碰撞体类型、通用系统） | `packages/engine/src/`，并在 `index.ts` 导出 |
| 某个 demo 的玩法/数值/AI | 该 demo 的 `src/entities/*` 顶部常量与状态机 |
| 换美术（模型/贴图/天空） | 该 demo 的 `public/assets/` + `main.ts` `loadAssets()` 路径 |
| 关卡/任务/出生点（gta-sandbox） | **`public/content/*.json` 内容包**（改完刷新即生效；加载时自动校验，任务点写进建筑会红字报错并拒绝开局） |
| 关卡布局（military-tps，尚未数据化） | `main.ts` 的 `buildArena` + `startGame` 数组 |
| 加全新机制 | 新建组件文件，`main.ts` 装到实体上——**不改现有文件** |
| 新建一个游戏 | 复制一个 demo 目录，改 `package.json` name + vite 端口，根 scripts 加命令 |
| 验证 gta 改动没打坏游戏 | 根目录 `npm run playtest`（机器人真实输入打穿全部任务，失败非零退出+黑匣子遥测） |
| 人工可视化编辑关卡 | gta 游戏中按 **E**（编辑器与 CLI/游戏共用校验，保存写回同一份 JSON） |

## 必须遵守的约定
1. **框架/玩法分离**：品类无关的进 `packages/engine`；具体玩法只进 demo 的 `entities/`。
2. **新行为 = 新组件**；数据驱动优先（常量/数组能解决就别写死）。
3. demo 之间**不许互相 import**；共享的东西上提到 engine。
4. 运行时刷实体用 `EntityManager.Add/Remove`（EndSetup 后 Add 自动 Initialize）；移除时记得清理 scene/物理资源（参照 `WantedSystem.syncPolice`）。
5. 角色模型需 **Mixamo 骨骼**（代码按 `RightHand$` 找手骨、按 Idle/Walk/Run 找动画）。
6. 多个组件监听同一按键时，注意**同一次 keydown 会依次触发所有监听器**（上/下车用了 300ms 保护窗，见 `Car.ts`——别删）。
7. 别提交 `node_modules/`。
8. **位置数据必须校验可达**：任务点/出生点/巡逻点等坐标要落在可走区域（gta-sandbox：建筑中心在 0/±26/±52 网格，马路在 ±13/±39）。曾有真实 bug：任务光柱写在建筑格中心，生成在楼内玩家永远找不到。
9. **"放置玩家"必须走安全落点**：下车/出生/传送都要 ①射线确认落点没被碰撞体占据 ②高度给到胶囊站立中心（不是 0），参照 `Car.exit()` 与 `OnFootPlayer.activate()`。曾有真实 bug：下车落点插进地面/建筑，角色被物理卡死。
10. **改完 gta 内容/玩法必跑 `npm run playtest`** —— 机器人打不穿的关卡就是坏关卡。
11. **每个目标必须有全屏可见引导**（50m 高光柱 + HUD 方向箭头/距离）。"玩家找不到该去哪"按 bug 对待，不是玩家的错。

## 能力边界（别答应做不到的事）
- ✅ 能做：实时 3D、物理、骨骼动画、多品类换皮、GTA 式机制（开车/通缉/任务已实现）、分块动态加载大地图（见 ARCHITECTURE.md §7）
- ❌ 不能做：真·GTA 级无缝大世界 + 海量内容 + AAA 画质（web 内存/体积/单线程限制）
