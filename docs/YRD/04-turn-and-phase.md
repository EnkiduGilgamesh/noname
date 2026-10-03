# 04 · 回合与阶段

> 本篇回答：**一个回合如何展开？六个阶段如何被驱动？`goto`/`redo` 如何工作？**
>
> 本篇覆盖 `phase` 数组 content 的完整实现（`content.ts:4593-4856`），它是**旧式数组写法的最佳实例**。

---

## 1. player.phase() —— 创建回合事件

```js
// apps/core/noname/library/element/player.js（示意）
phase() {
    var next = game.createEvent("phase", false);
    next.player = this;
    next.setContent("phase");
    next.forceDie = true;
    next.includeOut = true;
    return next;
}
```

| 属性 | 含义 |
|------|------|
| `trigger = false` | **不自动触发** `phaseBefore`/`phaseBegin`/`phaseEnd`/`phaseAfter` |
| `forceDie = true` | 玩家已死亡时**仍执行**（用于结算） |
| `includeOut = true` | 玩家已"出局"时**仍执行** |

⚠️ **为什么 `trigger = false`**：`phase` content 内部会**手动、精细地**触发各时机。若交给自动机制，时机顺序无法满足规则集要求（见下）。

---

## 2. phase content 的结构

`phase` 是**数组 content**（12 个函数元素），由 `ArrayCompiler` 编译：

```ts
// apps/core/noname/library/element/content.ts:4593
phase: [
    async (event, trigger, player) => { /* 步骤 0 */ },
    async (event, trigger, player) => { /* 步骤 1 */ },
    // ... 共 12 步
],
```

⚠️ **索引即步骤号**，`event.step` 从 `0` 开始。

### 步骤索引与时机对照

| `step` | 对应时机 / 行为 | 行号 |
|--------|----------------|------|
| `0` | `trigger("phaseBefore")` | 4594 |
| `1` | 轮次判定 + `roundStart` + 历史初始化 | 4599 |
| `2` | `trigger("phaseBeforeStart")` | 4670 |
| `3` | `trigger("phaseBeforeEnd")` | 4674 |
| `4` | 翻面检测（`turnOver`）或设 `isMe` | 4678 |
| `5` | 更新 `_status.currentPhase`、日志、`phaseBeginStart`... | 4696 |
| `6` | `trigger("phaseBeginStart")` | 4764 |
| `7` | `trigger("phaseBegin")` | 4768 |
| `8` | **阶段入口**：`num < phaseList.length` 则 `trigger("phaseChange")`，否则 `goto(11)` | 4774 |
| `9` | **执行当前阶段**：`player[currentPhase]()` 并 await | 4785 |
| `10` | 阶段收尾：`event.num++` | 4825 |
| `11` | 判断是否继续：`goto(8)` 回阶段循环，否则触发 `phaseEnd` 并 `redo()` | 4837 |
| `12` | `trigger("phaseAfter")` | 4846 |
| `13` | 清理 `_status.currentPhase` | 4849 |
| `14` | （数组结束，`event.finish()`） | — |

> ⚠️ 上表 `step` 与行号对应关系基于数组下标；实际数组共 **12 个元素**（下标 0–11）。阅读源码时以 `content.ts:4593-4856` 为准。

---

## 3. 关键设计：为什么手动触发时机

规则集对"回合开始"有严格顺序要求。源码注释直接对应规则集条款：

```ts
// apps/core/noname/library/element/content.ts:4595-4597
//规则集中的“回合开始后③（处理“游戏开始时”的时机）”
//提前phaseBefore时机解决“游戏开始时”时机和“一轮开始时”先后
await event.trigger("phaseBefore");
```

完整时机顺序（对应规则集编号）：

| 规则集条款 | 时机 | 说明 |
|-----------|------|------|
| 回合开始后③ | `phaseBefore` | 提前，解决与"一轮开始时"的先后 |
| 回合开始后① | （轮次判定） | 更新轮数，触发 `roundStart` |
| 回合开始后② | `phaseBeforeStart` | 1v1 武将登场专用 |
| 回合开始后④ | `phaseBeforeEnd` | 卑弥呼〖纵傀〗的时机 |
| 回合开始后⑤ | （翻面检测） | `isTurnedOver()` 则 `turnOver()` 并 `cancel()` |
| 回合开始后⑥ | （更新当前回合角色） | `_status.currentPhase` |
| 回合开始后⑦ | `phaseBeginStart` | 国战武将明置武将牌 |
| 回合开始后⑨ | `phaseBegin` | 当先、化身等操作 |

源码注释还特意说明：

```ts
// apps/core/noname/library/element/content.ts:4770
//没有⑧ 因为⑧用不到
```

> 💡 **这是理解无名杀时机设计的重要线索**：时机命名不是随意设计，而是**严格对应官方规则集条款**。

---

## 4. 阶段列表与阶段循环

### phaseList 的初始化

```ts
// apps/core/noname/library/element/content.ts:4602
event.phaseList ??= ["phaseZhunbei", "phaseJudge", "phaseDraw", "phaseUse", "phaseDiscard", "phaseJieshu"];
```

| 阶段 | content 名 | 行号 |
|------|-----------|------|
| 准备阶段 | `phaseZhunbei` | 4857 |
| 判定阶段 | `phaseJudge` | — |
| 摸牌阶段 | `phaseDraw` | — |
| 出牌阶段 | `phaseUse` | — |
| 弃牌阶段 | `phaseDiscard` | — |
| 结束阶段 | `phaseJieshu` | 5055 |

⚠️ **`??=` 的意义**：模式或技能可以**预先设置 `event.phaseList`** 来增删阶段（如"跳过摸牌阶段"、"额外获得一个出牌阶段"）。

### 阶段名的扩展语法

```ts
// apps/core/noname/library/element/content.ts:4792-4812
const list = event.phaseList[num].split("|");
const phase = list[0].split("-");
let skip = false;
if (phase[0].startsWith("skip")) {
    event.currentPhase = `phase${phase[0].slice(4)}`;
    skip = true;
} else {
    event.currentPhase = phase[0];
}
const next = player[event.currentPhase]();
next.phaseIndex = num;
if (list.length > 1) {
    next._extraPhaseReason = list[1];
}
if (skip) {
    next.isSkipped = true;
    if (phase.length > 1) {
        next._skipPhaseReason = phase[1];
    }
    game.log(player, "跳过了", event.currentPhase);
}
```

解析规则：

| 写法 | 含义 |
|------|------|
| `"phaseDraw"` | 正常执行摸牌阶段 |
| `"skipPhaseDraw"` | 跳过摸牌阶段（`slice(4)` 去掉 `skip`） |
| `"phaseDraw|原因"` | 额外阶段的说明（`\|` 后的部分） |
| `"skip-phaseDraw-原因"` | 跳过阶段并记录原因 |

所以 `event.currentPhase` 最终是 `phaseXxx` 形式，通过 `player[event.currentPhase]()` 调用对应的阶段方法。

---

## 5. 循环控制：goto 与 redo

### step 是延迟生效的

```ts
// apps/core/noname/library/element/gameEvent.ts:726-748
#step: number = 0;
#nextStep: number | null = null;

get step() {
    return this.#step;
}
set step(num) {
    this.#nextStep = num;      // ← 只写入 pending
}

updateStep() {
    if (this.#nextStep === null) return;
    this.#step = this.#nextStep;
    this.#nextStep = null;
}

goto(step: number) {
    this.step = step;
    return this;
}
redo() {
    this.goto(this.step);
    return this;
}
```

⚠️ **`goto` 不会立即跳转**，它只设置 `#nextStep`。真正的生效发生在 `updateStep()`，而 `updateStep` 由编译器的钩子调用：

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompilerBase.ts:21-26
beforeExecute(event: GameEvent) {
    const handlerType = event.getDefaultHandlerType() as `on${Capitalize<string>}`;
    const option: HandlerOption = { state: "begin" };
    event.callHandler(handlerType, event, option);
    event.updateStep();      // ← 步骤推进在这里生效
}
```

```ts
// apps/core/noname/library/element/GameEvent/compilers/ArrayCompiler.ts:18-39
return async function (this: GameEvent, event: GameEvent) {
    if (!Number.isInteger(event.step)) {
        event.step = 0;
    }
    while (!event.finished) {
        if (event.step >= content.length) {
            event.finish();
            break;
        }
        compiler.beforeExecute(event);     // ← updateStep 在此
        event.step++;                       // ← 注意：先执行再自增
        let result: Result | undefined;
        if (!compiler.isPrevented(event)) {
            const original = content[event.step];
            result = await Reflect.apply(original, this, [event, event._trigger, event.player, event._result]);
        }
        const nextResult = await event.waitNext();
        event._result = result ?? nextResult ?? event._result;
        compiler.afterExecute(event);
    }
};
```

🔬 **执行顺序陷阱**：`beforeExecute`（含 `updateStep`）→ `event.step++` → **执行 `content[event.step]`**。

这意味着：
1. `beforeExecute` 先应用 pending 的 `goto`
2. 然后 `step++`
3. 再执行 `content[step]`

所以 `goto(8)` 会让**下一次循环**执行 `content[8]`。这也是为什么 `phase` 数组注释里步骤号与下标需要仔细对应。

### phase 中的两处跳转

**跳出阶段循环**（步骤 8）：

```ts
// apps/core/noname/library/element/content.ts:4774-4784
async (event, trigger, player) => {
    const { num } = event;
    if (num < event.phaseList.length) {
        //规则集中没有的新时机 可以用来插入额外阶段啥的
        if (player.isIn()) {
            await event.trigger("phaseChange");
        }
    } else {
        event.goto(11);        // ← 阶段已全部完成，跳到收尾
    }
},
```

**回到阶段循环**（步骤 11）：

```ts
// apps/core/noname/library/element/content.ts:4837-4845
async (event, trigger, player) => {
    if (event.num < event.phaseList.length) {
        event.goto(8);         // ← 还有阶段，回到步骤 8
    } else if (!event._phaseEndTriggered) {
        event._phaseEndTriggered = true;
        event.redo();          // ← 重入本步骤，触发 phaseEnd
        await event.trigger("phaseEnd");
    }
},
```

⚠️ **`redo()` 的巧妙用法**：

这里想"触发 `phaseEnd` 后再走一遍当前步骤进入步骤 12"。但 `goto(11)` 已经在步骤 11，直接 `redo()` 重入会**无限递归**。

解决方案：用 `_phaseEndTriggered` 标志位保证只执行一次：

```
第一次进入步骤 11：num >= length 且 _phaseEndTriggered 为假
  → 设标志为真
  → redo()（下次重入步骤 11）
  → await trigger("phaseEnd")

重入步骤 11：_phaseEndTriggered 已为真
  → 跳过 if 分支
  → 自然进入步骤 12
```

> 💡 这是**旧式数组 content 处理复杂控制流的典型手法**：用标志位 + `redo()` 模拟"带状态的跳转"。

---

## 6. 阶段循环流程图

```
step 8  ┌─ num < phaseList.length ?
        │     ├─ 否 → goto(11) ──────────────┐
        │     └─ 是 → trigger("phaseChange") │
        ▼                                     │
step 9  │  取 phaseList[num]                   │
        │  解析 "skip"/"|"/"-" 语法            │
        │  player[currentPhase]()  → 阶段事件  │
        │  await                               │
        ▼                                     │
step 10 │  event.num++                         │
        ▼                                     │
step 11 └─ num < phaseList.length ?            │
              ├─ 是 → goto(8)  ◄──────────────┘
              └─ 否 → _phaseEndTriggered ?
                        ├─ 否 → 设标志 → redo() → trigger("phaseEnd")
                        └─ 是 → 继续 step 12
                                   │
step 12                            ▼
                          trigger("phaseAfter")
                                   │
step 13                            ▼
                    清理 _status.currentPhase
```

---

## 7. 六个标准阶段

### phaseZhunbei（准备阶段）

```ts
// apps/core/noname/library/element/content.ts:4857
async phaseZhunbei(event, trigger, player) {
    // 记录日志：进入准备阶段
    // 触发 phaseZhunbei
}
```

### phaseJudge（判定阶段）

```
收集判定区牌 → 逐张处理
触发 phaseJudge → player.judge → 根据结果执行延时锦囊效果或取消
```

### phaseDraw（摸牌阶段）

```
触发 phaseDrawBegin1
触发 phaseDrawBegin2
默认摸 event.num 张牌（默认 2）
记录摸到的 cards
```

⚠️ 首轮少摸等规则会在**创建阶段事件时**调整 `num`。

### phaseUse（出牌阶段）

```
重置 phaseUse 技能/卡牌使用统计
触发 phaseUseBefore → phaseUseBegin
创建 player.chooseToUse()
若 result.bool 为真 → event.goto(3) 回到选择步骤
触发 phaseUseEnd → phaseUseAfter
```

> 💡 出牌阶段的"反复使用牌/技能"通过 **`goto` 回到选择步骤**实现，而不是 JS 循环。

### phaseDiscard（弃牌阶段）

```
计算 player.needsToDiscard()
若不需要弃牌 → finish()
触发 phaseDiscard → player.chooseToDiscard(num, true)
记录弃牌 cards
```

### phaseJieshu（结束阶段）

```ts
// apps/core/noname/library/element/content.ts:5055
async phaseJieshu(event, trigger, player) {
    // 记录日志：进入结束阶段
    // 触发 phaseJieshu
}
```

---

## 8. 技能如何穿插进阶段

阶段本身只是**骨架**，大量技能挂在阶段触发的时机上：

```
phaseDraw 事件
  └─ trigger("phaseDrawBegin1")
       └─ GameEvent.trigger() 查 lib.hookmap["phaseDrawBegin1"]
            └─ 按座次遍历玩家，收集符合 trigger 的技能
                 └─ 创建 arrangeTrigger 事件
                      └─ 按优先级排序
                           └─ 对每个技能创建 createTrigger 事件
                                ├─ 执行 cost（能否发动）
                                └─ 执行 content（技能效果）
                                     └─ 又创建新事件 ← 递归
```

这就是 [00](00-overview.md) §4 所说的三层递归。

---

## 9. 本篇小结

- `player.phase()` 创建 `phase` 事件，**`trigger=false`**（因为手动精细触发时机）
- `phase` 是**旧式数组 content**，索引即步骤号
- 时机顺序**严格对应官方规则集条款**（源码注释可证）
- `phaseList` 用 `??=` 初始化，可被模式/技能预设以增删阶段
- 阶段名支持 `skip` 前缀、`|` 与 `-` 分隔的扩展语法
- **`goto` 是延迟生效的**，由 `updateStep()` 在 `beforeExecute` 中应用
- 阶段循环靠 `goto(8)` / `goto(11)` 实现；`phaseEnd` 靠 `redo()` + 标志位只触发一次
- 出牌阶段的"反复出牌"也靠 `goto` 回到选择步骤

**下一步** → [05-event-lifecycle.md](05-event-lifecycle.md)：单个事件的完整生命周期
