# 3d-game-kit

**一套共用的 Web 3D 游戏框架 + 多个独立可玩 demo**（monorepo）。

> ⚠️ **技术栈说明：本项目基于 [Three.js](https://threejs.org/)（网页 / WebGL / TypeScript），配合 Rapier 物理引擎。**
> **它不是 Godot、Unity 或 Unreal 引擎项目** —— 没有编辑器、没有引擎运行时，游戏直接跑在浏览器里，`npm run dev` 即玩，发个链接就能分享。

## 仓库结构

```
3d-game-kit/
├── packages/
│   └── engine/            ← 共用游戏框架（所有 demo 复用同一份代码）
│       └── src/
│           ├── Entity.ts / Component.ts / EntityManager.ts   实体-组件架构
│           ├── FiniteStateMachine.ts                          状态机（AI/武器）
│           ├── Physics.ts                                     Rapier 物理封装
│           ├── Input.ts                                       键鼠输入（含防卡键）
│           └── index.ts                                       统一出口 '@engine'
├── demos/                 ← 每个 demo 独立可跑，共享上面的框架
│   ├── military-tps/      第三人称军事射击（敌人 AI、FP/TP 切换、射击）
│   └── gta-sandbox/       GTA 式小镇沙盒（开车、通缉、警察追捕、任务链）
├── ARCHITECTURE.md        框架技术结构与原理、能做/不能做、定制指南
└── AGENTS.md              给 AI 编码代理的操作手册
```

**共用框架**：demo 里 `import { Entity, Component, Physics, ... } from '@engine'`——改 `packages/engine` 一处，所有 demo 生效。
**独立 demo**：各自有自己的 `src/`（玩法组件）、`public/assets/`（美术）、端口，互不影响。

## 运行

```bash
npm install          # 根目录装一次（npm workspaces）

npm run military     # → http://127.0.0.1:5176/   军事射击 demo
npm run gta          # → http://127.0.0.1:5177/   GTA 沙盒 demo
```

### military-tps 操作
WASD 移动 · 鼠标越肩瞄准 · 左键射击 · R 换弹 · 空格跳 · **V 切第一/第三人称**

### gta-sandbox 操作
WASD 移动/驾驶 · 鼠标看向 · **F 上/下车** · **G 惹麻烦（涨通缉）** · 空格跳
玩法：跟着任务栏做 3 个任务（步行到点 → 开车到点 → 惹 2 星通缉再甩掉警察）；被警察贴身抓住会 BUSTED 送回广场。

## 技术栈

| 层 | 用什么 |
|---|---|
| 渲染 | **Three.js**（WebGL，浏览器原生 3D，非 Godot/Unity/Unreal） |
| 物理 | **Rapier**（Rust→WASM，碰撞/角色控制器/射线） |
| 语言/构建 | TypeScript + Vite（npm workspaces monorepo） |
| 架构 | 自研 **Entity-Component**（实体=组件容器，游戏=实体的组合） |

## AI-native 内容管线（gta-sandbox 已落地）

"编辑器 = headless 操作层 + 单一内容数据源；AI 和人都是它的客户端"——四层已全部可用：

| 能力 | 入口 | 说明 |
|---|---|---|
| **内容包**（P1） | `demos/gta-sandbox/public/content/*.json` | 关卡/任务/出生点全部数据化；加载时自动校验，非法内容红字拒绝开局 |
| **headless 编辑**（P2） | `node tools/content.mjs ...` + 项目 skill | 查/改/校验一体，AI 代理的编辑入口；与游戏共用同一份校验规则 |
| **试玩验证**（P3） | `npm run playtest` | 机器人以真实输入打穿全部任务（无头 Chrome），CI 可用，失败带黑匣子遥测+截图 |
| **可视化编辑器**（P4） | 游戏中按 **E** | 俯瞰点选/拖拽/属性面板/增删，校验通过才能保存，保存写回同一份 JSON 并热重载 |
| **ECA 规则层**（P5） | `content/rules.json` | 玩法逻辑用"事件-条件-动作"数据描述；动作词汇表封闭、每个动作自带校验（如 teleport 只接受命名点位）——AI 在规则层**写不出**"传送进楼里"这类 bug |
| **L1 抽象模拟**（P5） | `node tools/simulate.mjs` | **不渲染、不开浏览器**的逻辑推演：7 项断言 1.4ms（渲染试玩要 40s）；逻辑 bug 在这层抓，截图只留给视觉问题 |

引擎还内建**固定步长累加器**（帧率无关性）：低帧率环境（无头/慢机器）游戏速度不变。

**验证金字塔**（改动后从上往下跑，能在便宜的层抓住就不去贵的层）：

| 层 | 命令 | 耗时 | 抓什么 |
|---|---|---|---|
| L0 静态校验 | `node tools/content.mjs validate` | 微秒 | 数据非法（点位在楼里、引用不存在） |
| L1 抽象模拟 | `node tools/simulate.mjs` | 毫秒 | 逻辑错误（被捕传送到哪、任务链能否通关） |
| L2 渲染试玩 | `npm run playtest` | ~40s | 必须"玩起来"才能发现的问题 |

## 文档

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — 框架原理（三层分离、ECS、消息总线）、能做成哪些游戏、能做/不能做的边界（含开放世界与 GTA 类玩法的可行性分析、分块流式加载方案）、定制配方。
- **[AGENTS.md](./AGENTS.md)** — AI 编码代理操作手册：项目地图、想改什么→改哪里、约定、验证方式。

## 新建你自己的 demo

1. 复制 `demos/gta-sandbox` 为 `demos/你的游戏名`，改 `package.json` 的 `name` 和 vite 端口
2. 根目录 `package.json` 的 `scripts` 加一行快捷命令
3. 保留 `@engine` 引用不动，替换 `src/entities/`（玩法）和 `public/assets/`（美术）
4. `npm install` 一次即可（workspaces 自动链接）

## 素材许可

demo 内置素材均为免费可用：three.js 官方示例 Soldier 模型（MIT 项目资产）、Poly Haven HDRI/PBR 贴图（CC0）、其余为代码程序化生成。详见各 demo 与 LICENSE。
