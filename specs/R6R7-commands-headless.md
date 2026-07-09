# 实施规格：R6 编辑命令层+undo ｜ R7 无头全游戏 L1

> 前置：R1-R5、R4 已合入（@kit/core 存在、内容管线 reader 可注入）。铁律同前。

---

## R6：编辑命令层（Command Pattern）+ undo/redo

### 目标
CLI / 可视化编辑器 / AI 三个编辑入口收敛到**同一份变更实现**（现状：CLI 改文件、编辑器改内存，各写各的）。编辑器免费获得 Ctrl+Z / Ctrl+Shift+Z。

### 文件契约

**1. `demos/gta-sandbox/content-lib/commands.mjs`（纯函数，双端共用）**
```js
// 每个命令：{ validateParams(params, content) → Issue[] , apply(content, params) → void(原地修改) }
export const COMMANDS = {
  'move-mission':   { params: ['index','pos'], ... },
  'set-mission-text': ..., 'add-mission': ..., 'remove-mission': ...,
  'move-block': ..., 'resize-block': ..., 'add-block': ..., 'remove-block': ...,
  'set-spawn': ...,          // player|car + pos(+heading)
  'add-entity': ..., 'remove-entity': ...,   // R3 的实例表
  'tune': ...,               // dot.path + value
};
export function execute(content, cmdName, params) {
  // 1) 命令存在性 2) validateParams 3) 深拷贝快照 4) apply 5) 全量校验(validateContent+validateTuning+validateRules)
  // 校验失败 → 回滚快照，返回 issues；成功 → 返回 []
}
```
- execute 内置"apply 后全量校验、失败自动回滚"——**任何入口都不可能把内容改坏**（这是命令层的存在意义）
- d.ts 同步

**2. `tools/content.mjs` 重构为薄壳**
- 现有各 case 的手工修改逻辑删除，argv 解析后一律 `execute(content, cmd, params)` → 成功写盘/失败打印 issues exit 1
- 对外命令名与行为**完全向后兼容**（validate/list 保持只读路径）

**3. 编辑器接入（src/editor/Editor.ts）**
- 新增 `private history: string[]`（content 深拷贝 JSON 快照栈，cap 50）与 `undo()/redo()`
- 所有 mutation 路径（拖拽落点、属性面板 change、增删按钮）改为组装 command → `execute(this.g.content, name, params)` → 成功后 `refresh(sel)`（现有 syncSelMesh/gizmo 重建逻辑复用；undo 后做全量 gizmo+block mesh 重建，24 块规模无压力）
- 键盘：Ctrl/Cmd+Z undo、Ctrl/Cmd+Shift+Z redo（输入框聚焦时跳过）
- 拖拽性能注意：pointermove 高频——拖拽过程中只改 mesh 视觉，**pointerup 时才提交一条 move 命令**（一次拖拽=一步 undo）

**4. AI skill 文档**（.claude/skills/gta-content-editor/SKILL.md）
- 增补：命令即 CLI 子命令，全部经统一 execute 校验回滚，改坏内容不可能落盘

### R6 验收
```bash
cd demos/gta-sandbox
node tools/content.mjs set-mission 0 --pos 26,0    # 仍被拒（行为兼容）
node tools/content.mjs set-mission 0 --pos 13,-13 && node tools/content.mjs set-mission 0 --pos -13,13  # 改+还原成功
node tools/simulate.mjs                             # 全绿
grep -n "missionsPack.missions\[" tools/content.mjs # 0 命中（手工修改逻辑已删）
```
浏览器（给步骤，驱动者执行）：E 进编辑器 → 拖一栋楼 → Ctrl+Z 复位 → 属性面板改高度 → Ctrl+Z 复位 → 保存重载正常。

---

## R7：无头全游戏 L1——真实系统在 Node 里跑完任务链

### 目标
不开浏览器、不渲染，把**真实的** EntityManager+系统组件+Rapier 物理在 Node 里组装起来，用机器人输入打穿三个任务。逻辑级全仿真从"规则抽象"升级为"真游戏系统"，秒级跑完。

### 关键工程决策（按此实施）
- **打包方案**：用 vite 自带的 esbuild 写 `tools/build-headless.mjs`：入口 `src/headless.ts`，alias `@engine`→packages/engine/src、`@kit`→packages/kit，platform=node，format=esm，external: ['three','@dimforge/rapier3d-compat']（node_modules 可解析），输出 `dist-headless/headless.mjs`
- **runner**：`tools/headless-sim.mjs`：先 build 再 `import(dist)` 运行；root scripts 加 `"sim:full": "node demos/gta-sandbox/tools/headless-sim.mjs"`

**1. 组装抽取 `src/game/assemble.ts`**
- 把 main.startGame 的**逻辑组装**部分（Physics/EntityManager/buildTown 碰撞/Prefab 实例化/系统实体）抽成 `assembleGame({ content, tuning, scene, camera, seed })`——main 与 headless 共用
- 浏览器专属（renderer/HUD 显隐/HudView/编辑器入口/requestPointerLock）留在 main；场景网格创建需要材质——assemble 接受 `assets` 可为 null：null 时建碰撞不建 mesh？**不行**，PoliceNPC/OnFootPlayer 需要 model（three 对象，Node 可用）——soldier 模型来自 GLB 加载…Node 里 GLTFLoader 需要 fetch/blob。**决策：无头模式用"代理模型"**——assemble 的 deps 提供 `makeSoldier()` 工厂：浏览器=真 GLB 克隆；无头=空 THREE.Group + 假动画 mixer 兼容层（SoldierInstance 形状相同：{model:Group带一个占位骨骼节点, animations:[], rightHand:null}）。OnFootPlayer/PoliceNPC 对 animations 空数组要健壮（actions 查无就跳过——现有 `this.actions[name]?` 写法已基本健壮，逐处核对）
- HDRI/贴图在无头一律跳过

**2. `src/headless.ts`**
- Node 入口：fs reader 读 content（kit/content-pipeline 的 reader 注入点）→ 全量 L0 校验 → RAPIER.init → assembleGame（dummy camera=new THREE.PerspectiveCamera，makeSoldier=占位工厂，seed 固定 42）→ 机器人（复用 R5 的输入驱动思路：直接 Input.Press/Release + 设 yaw；**把 AutoTest 的走位/驾驶/逃逸核心抽成 `src/test/BotCore.ts`**，去掉 DOM HUD 日志改 callback，浏览器 AutoTest 与 headless 共用）→ 主循环 `while(!done && tick<限) { physics.step(); em.Update(1/60); bot.tick(); }` 全速跑（不 setTimeout）
- 断言：三任务完成事件序列、最终 mission idx=3；输出 JSON 报告+耗时；exit code
- FlightRecorder：kit 版已 DOM-optional——无头下开启（事件流可断言），banner/F9 自动禁用

**3. 文档**
- README 验证金字塔表更新：L1 拆两行——"L1a 规则抽象模拟(simulate.mjs, ~1ms)"、"L1b 全系统无头仿真(sim:full, ~秒级)"；AGENTS 速查同步

### R7 验收
```bash
npm run sim:full        # 输出三任务通过报告，总耗时打印（目标 < 10s 墙钟），exit 0
node demos/gta-sandbox/tools/simulate.mjs   # 原 L1a 不受影响
```
- 报告须含：tick 总数、每任务完成 tick、事件序列摘要
- gta 浏览器行为回归由驱动者跑 playtest 确认

## 完成定义
- R6：三入口同一 execute；编辑器 undo/redo 可用；CLI 行为向后兼容
- R7：`npm run sim:full` 稳定绿；BotCore 双端共用；assemble 双端共用
- 全部验收输出贴总结；不 commit
