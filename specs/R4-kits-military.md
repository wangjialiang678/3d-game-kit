# 实施规格：R4 中间件上提 packages/kit ＋ military-tps 完整现代化

> 前置：R1/R2/R3/R5 已合入。业主决策：military 走**完整现代化**（内容化+编辑器+试玩机器人全套）。
> 铁律同前；本项唯一例外：**允许且必须修改 demos/military-tps**。gta-sandbox 行为不得变化。

## Part A：中间件上提（可复用的抽出来，游戏语义留在各 demo）

### 新包 `packages/kit`（name: `@kit/core`，plain .mjs + .d.ts + 少量 .ts，零 npm 依赖）
从 gta-sandbox 抽取**与"这个游戏是什么"无关**的部分：

| 迁出 | 来源 | 去处 | 泛化点 |
|---|---|---|---|
| ECA 规则引擎核心 | content-lib/rules.mjs 的 validateRules/simulateEvent/evalCondition | `kit/rules-core.mjs` | ACTIONS 词汇表与 EVENTS 由游戏**注入**（参数传入），不再 import 游戏文件 |
| 内容管线 | ContentLoader 的 fetch+校验编排 | `kit/content-pipeline.mjs` | `loadPack({files:{...}, reader, validators:[...]})`；reader 可换（浏览器 fetch / Node fs——R7 要用） |
| 飞行记录仪 | src/debug/FlightRecorder.ts | `kit/FlightRecorder.ts` | 状态采样函数、看门狗断言列表改为**注入**；DOM 部分（banner/F9）检测 `typeof document` 存在才启用（R7 无头要 import 它不炸） |
| 空间工具 | core.mjs 的 insideAnyBlock/findClearSpot/mulberry32 | `kit/spatial.mjs` | 原样；gta 的 core.mjs re-export 保持兼容 |
| 保存中间件 | gta vite.config 里的 contentSavePlugin | `kit/vite-content-save.mjs` | 文件清单参数化 |
| 试玩运行器核心 | tools/playtest.mjs | `kit/playtest-lib.mjs` | `runPlaytest({url, timeoutMs, resultExpr})`；各 demo 的 tools/playtest.mjs 变薄壳 |
| L1 运行器骨架 | tools/simulate.mjs 的 check/计时/exit 框架 | `kit/sim-harness.mjs` | `harness(name).check(...).finish()`；场景断言留在各 demo |

- gta-sandbox 全量改为从 `@kit/core` 引用（workspace 包，vite alias `@kit` 或直接相对引用——与 @engine 同一机制）
- **回归要求**：gta 的 simulate/playtest/编辑器/录像全部原样通过

### 引擎补充
- `EntityManager.GetAll(pred)`（R3 若已加则跳过）

## Part B：military-tps 完整现代化（对照 gta 逐能力接入）

**目标：第二个全功能样板。接入后两 demo 能力矩阵一致，证明中间件成立。**

1. **事件与 View**：EventBus 注册表（military 自己的 events.mjs：'enemy-killed','all-enemies-dead','player-hit','weapon-fired','ammo-changed','health-changed'…）；ThirdPersonPlayer/SoldierNPC/Weapon 去 DOM（现 UIManager 改造为 View 层 HudView：血条/弹药订阅事件）
2. **内容化**：`public/content/arena.json`（地面尺寸、围墙、掩体列表 covers[{x,z,w,h,d}]、出生点、敌人实例表[{name,pos,tint}]、assets 路径）+ `tuning.json`（玩家速度/武器射速伤害弹匣/敌人速度视距射程）+ `rules.json`（如 on all-enemies-dead → toast "🎖 全歼敌军！"）；content-lib（military 自己的 core.mjs：校验器——出生点/敌人不与掩体重叠、在场地内；词汇表 ACTIONS 可先只有 toast）＋加载失败红字遮罩（复用 gta 的样式与流程）
3. **Prefab**：enemy/玩家实例化走数据（同 R3 模式）
4. **固定步长**：已有 ✓（确认与 gta 一致带 tick）
5. **飞行记录仪**：接 @kit/FlightRecorder（采样函数注入 military 状态：pos/hp/ammo/enemies 存活数；看门狗：卡死断言 + "玩家在掩体内"断言）
6. **编辑器**：按 E 进入（照 gta Editor 模式适配：点选/拖拽 covers 与敌人出生点、属性面板、校验、保存并重载——保存走 kit/vite-content-save）
7. **试玩机器人**：`?autotest`——依次寻敌（读取敌人实体位置，设定 yaw 朝向，前进+射击），全歼 5 敌 → 断言 all-enemies-dead 事件与胜利 toast；`tools/playtest.mjs`（薄壳调 kit/playtest-lib）；root package.json 加 `"playtest:military"` script
8. **L1 模拟器**：`tools/simulate.mjs`——L0 全内容校验；L1 场景：敌人全灭→胜利规则触发；出生点/敌人摆放合法性
9. **CLI**：`tools/content.mjs`（照 gta：validate/list/tune/移动敌人与掩体——命令集可精简，validate+tune+list 必须有）

### 验收（实施者自己跑并贴输出）
```bash
# gta 回归（Part A 不得破坏）
cd demos/gta-sandbox && node tools/simulate.mjs && node tools/content.mjs validate
# military 新能力
cd ../military-tps && node tools/simulate.mjs && node tools/content.mjs validate
node tools/content.mjs tune enemy.speed 99        # 关系断言拒绝（enemy.speed < player 相关约束，具体断言实施时定义并写注释）
grep -rn "document\.\|getElementById" src/entities/   # 0 命中
```
浏览器验收（给出步骤，驱动者执行）：military DEPLOY 后 HUD 正常、按 E 编辑器可动掩体并保存重载、?autotest 机器人全歼过关。

## 完成定义
- gta 全量回归绿；military 通过全部新验收；两 demo 的 tools/ 均为薄壳+kit 核心
- packages/kit 有 README（每模块一句话 + 注入点说明）
- 根 README 能力矩阵表更新为"两个 demo 全勾"
