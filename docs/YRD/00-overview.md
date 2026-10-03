# 00 · 全景：事件系统在游戏中的位置

> 本篇回答：**事件系统是什么？它在整个游戏架构中处于什么位置？一次对局的完整生命周期是什么样的？**
>
> 读完本篇，你应能画出游戏从启动到结束的全局流程图。
> 具体机制留给后续篇章。

---

## 1. 六个全局单例

《无名杀》的运行时由六个全局单例构成，通过 `apps/core/noname.js` 统一导出：

```js
// apps/core/noname.js:6-11
export { AI, ai, setAI } from "./noname/ai/index.js";
export { Game, game, setGame } from "./noname/game/index.js";
export { Get, get, setGet } from "./noname/get/index.js";
export { Library, lib, setLibrary } from "./noname/library/index.js";
export { status, _status, setStatus } from "./noname/status/index.js";
export { UI, ui, setUI } from "./noname/ui/index.js";
```

| 单例 | 职责 | 与事件系统的关系 |
|------|------|-----------------|
| `lib` | 静态库：技能、卡牌、武将、翻译、配置 | **提供事件所需的全部数据**。`lib.element.GameEvent` 是事件类本身 |
| `game` | 游戏行为 API | **创建事件**（`createEvent`）、启动事件（`loop`） |
| `ui` | DOM 创建与交互 | 事件的**输入输出界面**（选牌、选目标） |
| `get` | 查询/计算/转换 | 被 content 大量调用 |
| `ai` | AI 评估 | 为事件提供 AI 决策 |
| `_status` | 运行时状态 | **持有当前事件指针** `_status.event` |

关键点：**`_status.event` 是"当前正在执行的事件"的全局指针**。事件系统的一切都要通过它找到上下文。

```js
// apps/core/noname/status/index.js:17
this.eventManager.setStatusEvent(event);
```

---

## 2. 事件系统在架构中的位置

```
┌─────────────────────────────────────────────────────────┐
│  表现层  ui (DOM) / audio / layout                       │
│          ↑ 事件通过 ui.create.* 与玩家交互                │
├─────────────────────────────────────────────────────────┤
│  数据层  lib (skill / card / character / translate)      │
│          ↑ 事件执行时读取技能与卡牌定义                    │
├─────────────────────────────────────────────────────────┤
│  ★ 驱动层  GameEvent 事件系统 ★                          │
│          · 表达"发生了什么"                               │
│          · 编排"按什么顺序发生"                           │
│          · 回调"谁该响应"                                 │
├─────────────────────────────────────────────────────────┤
│  规则层  mode (身份/国战/斗地主...)  get.ai 判定          │
│          ↑ 模式通过 mixin 改写 game/ui/get/ai             │
└─────────────────────────────────────────────────────────┘
```

**事件系统是驱动层**：它不定义规则（规则在 `mode/`），也不绘制界面（界面在 `ui`），但它决定**规则何时生效、界面何时弹出**。

---

## 3. 全局生命周期

一次完整对局的生命周期：

```
【阶段一】启动装配                     ← 见 02-startup-to-game.md
index.html
  └─ 加载 noname/entry.ts
      └─ 平台分支选择 preload (node/browser/cordova)
          └─ boot()
              ├─ 初始化单例与 polyfill
              ├─ 加载配置 lib.config
              ├─ 初始化沙箱与安全层
              ├─ importMode / importCardPack / importCharacterPack
              ├─ 加载扩展 importExtension
              ├─ loadMode()：把模式能力 mixin 进 game/ui/get/ai
              └─ ui.create.arena()：创建游戏主界面

【阶段二】创建根事件                     ← 见 03-game-loop.md
game.createEvent("game", false).setContent(lib.init.start)
  └─ game.loop()  →  event.start()
      └─ GameEvent.start() → loop() → content()

【阶段三】模式 start 主线                 ← 见 02-startup-to-game.md
模式 start（identity.js 等）
  ├─ game.prepareArena()      创建座位与牌堆 UI
  ├─ game.chooseCharacter()   选将、分配身份
  ├─ trigger("gameStart")     宣告游戏开始
  ├─ game.gameDraw()          初始发牌
  └─ game.phaseLoop()         ★ 进入对局循环

【阶段四】对局循环                       ← 见 03 / 04
phaseLoop（无限循环）
  ├─ 取当前玩家
  ├─ player.phase()  ← 一个回合
  │    ├─ phaseBefore / phaseBegin 时机
  │    ├─ 六个阶段依次执行
  │    │    phaseZhunbei → phaseJudge → phaseDraw
  │    │    → phaseUse → phaseDiscard → phaseJieshu
  │    └─ phaseEnd / phaseAfter 时机
  ├─ trigger("phaseOver")
  └─ 找下一个玩家，继续

【阶段五】结束
game.over() → 结算界面 → 可复盘（录像）
```

---

## 4. 三层递归结构

这是理解无名杀最关键的一张图。**游戏行为是三层递归**：

```
①  事件链递归（宏观）
    phaseLoop → phase → phaseUse → chooseToUse → useCard ...
    每个事件都可以创建子事件，子事件又可创建孙事件

②  时机触发递归（中观）
    任意事件在生命周期节点上触发时机
    useCard.start() → trigger("useCardBefore")
                    → trigger("useCardBegin")
                    → content()
                    → trigger("useCardEnd")
                    → trigger("useCardAfter")
    每个时机都会回调所有注册了该时机的技能

③  技能效果递归（微观）
    技能被触发 → 执行 cost（能否发动）→ 执行 content（效果）
    技能 content 中又会创建新事件 → 回到 ①
```

**三者相互嵌套，构成无限可组合的能力体系。** 这就是"上万技能 + 大量扩展能够任意组合而不互相破坏"的根本原因。

用一句话概括：

> **事件描述"做什么"，时机描述"何时"；技能挂到时机上，技能的产物又是事件。**

---

## 5. 事件是什么

`GameEvent` 是一个**携带上下文数据的异步执行单元**，实现 `PromiseLike`：

```ts
// apps/core/noname/library/element/gameEvent.ts:19
export class GameEvent implements PromiseLike<void> {
```

| 要素 | 说明 |
|------|------|
| `name` | 事件名（如 `"useCard"`、`"phaseDraw"`），决定触发哪些时机 |
| `content` | 事件体，编译后的异步函数 |
| 任意键值对 | 上下文数据，通过 `.set(key, value)` 写入 |
| `result` | 事件结果 |

因为实现了 `PromiseLike`，所以可以：

```js
// 等待事件完成
await player.chooseCard();

// 或者取结果
const result = await player.chooseCard().forResult();
```

```ts
// apps/core/noname/library/element/gameEvent.ts:131-134
async forResult(): Promise<Partial<Result>> {
    await this;
    return this.result;
}
```

---

## 6. 与其他文档系列的关系

| 文档系列 | 视角 | 适合 |
|---------|------|------|
| `docs/game-event/` | **横向**：按模块切分（lifecycle/trigger/relationships...） | 需要查阅特定机制的细节 |
| `docs/game-startup-flow.md` | **线性**：启动到进行时的流程 | 想快速了解启动链路 |
| **`docs/YRD/`（本系列）** | **纵向自顶向下**：从全景到实现 | 系统建立完整认知 |

三者互补。本系列在需要时引用它们，但不重复其内容。

---

## 7. 本篇小结

- 游戏由**六个全局单例**构成，事件系统是其中的**驱动层**
- `_status.event` 是"当前事件"的全局指针
- 一次对局分为**启动装配 → 创建根事件 → 模式 start → 对局循环 → 结束**五个阶段
- 游戏行为是**三层递归**：事件链递归 + 时机触发递归 + 技能效果递归
- `GameEvent` 是 `PromiseLike`，因此可 `await`

**下一步** → [01-mental-model.md](01-mental-model.md)：建立正确的心智模型
