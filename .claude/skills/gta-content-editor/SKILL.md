---
name: gta-content-editor
description: 编辑 gta-sandbox 的游戏内容（任务/出生点/关卡参数）。当用户要求修改 GTA 沙盒 demo 的任务、任务点位置、任务文字、出生点、小镇布局参数，或要校验内容包时使用。关键词：任务、任务点、光柱、出生点、内容包、missions.json、scene.json。
---

# gta-sandbox 内容编辑（headless 编辑器）

游戏内容（关卡/任务/出生点）在 `demos/gta-sandbox/public/content/*.json` 内容包里，**不在代码里**。
编辑一律用 CLI 工具（自带校验，非法数据拒绝保存），不要直接手改 JSON——除非改完立刻跑 `validate`。
CLI 子命令就是统一编辑命令层的客户端：所有写操作都会进入 `content-lib/commands.mjs` 的 `execute()`，先参数校验，再应用变更，再跑内容包/规则包/tuning 全量校验；失败会自动回滚内存快照，因此改坏内容不可能落盘。

## 命令（在 `demos/gta-sandbox/` 目录运行）

```bash
node tools/content.mjs validate                 # 校验内容包（改完必跑）
node tools/content.mjs list roads               # 列出所有马路交叉口 = 合法任务点候选
node tools/content.mjs list missions|blocks|spawns

node tools/content.mjs set-mission 1 --pos -39,-39 --text "开车去西北角"
node tools/content.mjs add-mission --text "..." --pos 13,-39 [--need-car true]
node tools/content.mjs add-mission --text "..." --special wanted
node tools/content.mjs remove-mission 2
node tools/content.mjs set-spawn player --pos 13,1.2,13
node tools/content.mjs set-spawn car --pos 13,0,5 --heading 180
```

## 规则

1. **任务点必须在马路上**——建筑中心在 0/±26/±52 网格；先 `list roads` 拿合法交叉口再选点。写进建筑的坐标会被校验器拒绝（这不是限制，是在救你：光柱生成在楼里玩家永远找不到）。
2. 写操作自动"先校验后保存"，校验失败 exit 1 且不落盘；统一命令层不提供绕过校验的写坏入口。
3. 改完让用户刷新 `http://127.0.0.1:5177/` 即生效（内容包是运行时 fetch 的，无需重启 dev server）。
4. 校验逻辑与游戏共用同一份 `content-lib/core.mjs`——CLI 说合法=游戏一定能跑。
