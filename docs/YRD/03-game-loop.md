# 03 · 对局循环：没有主循环的循环

> 本篇回答：**游戏没有 `while(true)` 主循环，为什么能一直进行？对局靠什么推进？**
>
> 本篇覆盖 `phaseLoop` 的完整实现，并对 `loop` 这个名字做一个正面澄清。

---

## 1. 先澄清 `loop` 这个词

代码里有两个叫 `loop` 的东西，含义完全不同：

| 名称 | 位置 | 作用 |
|------|------|------|
| `game.loop()` | `game/index.js` | **只启动一个事件**。等价于 `event.start()` |
| `GameEvent.loop()` | `gameEvent.ts:247` | **单个事件内部的状态推进**：时机 → content → 时机 |
| `phaseLoop` | `content.ts:3766` | **真正的对局循环**：无限推进玩家回合 |

> ⚠️ 只有 `phaseLoop` 是"游戏主循环"。前两个名字有误导性。

---

## 2. GameEvent.loop() —— 单事件状态机

```ts
// apps/core/noname/library/element/gameEvent.ts:247-292
async loop() {
    const trigger = async (trigger: string, to: number) => {
        this._triggered = to;
        if (this.type == "card") {
            await this.trigger("useCardTo" + trigger);
        }
        await this.trigger(this.name + trigger);
    };
    if (await this.checkSkipped()) {
        return;
    }
    while (true) {
        await this.waitNext();
        if (!this.finished) {
            if (this._triggered === 0) {
                await trigger("Before", 1);
            } else if (this._triggered === 1) {
                await trigger("Begin", 2);
            } else {
                this.#inContent = true;
                let next = this.content(this).catch(/* 错误处理 */);
                await next.finally(() => (this.#inContent = false));
            }
        } else {
            if (this._triggered === 1) {
                await trigger("Omitted", 4);
            } else if (this._triggered === 2) {
                await trigger("End", 3);
            } else if (this._triggered === 3) {
                await trigger("After", 4);
            } else if (this.after.length) {
                this.next.push(this.after.shift()!);
            } else {
                return;
            }
        }
    }
}
```

### `_triggered` 状态机

| `_triggered` | 阶段 | 转移 |
|-------------|------|------|
| `0` | 初始 | → 触发 `Before`，置 `1` |
| `1` | Before 完成 | → 触发 `Begin`，置 `2` |
| `2` | Begin 完成 | → **执行 content** |
| `3` | content 完成、`finished` | → 触发 `End`，置 `3`... |

⚠️ 注意一个**容易看错的地方**：`finished` 分支里 `_triggered === 2` 时触发的是 `End` 并置 `3`。也就是说：

```
_triggered 语义：
  0 = 未开始          （仅 trigger=true 的事件）
  1 = Before 已触发
  2 = Begin 已触发，content 待执行/已执行
  3 = End 已触发
  4 = After 已触发 / 终止态
  5 = 被 untrigger 强制终止（见 gameEvent.ts:652）
```

### 三处提前退出

1. **`checkSkipped()`** — 事件被标记跳过

```ts
// apps/core/noname/library/element/gameEvent.ts:293-304
async checkSkipped(): Promise<boolean> {
    if (!this.player || (!this.player.skipList.includes(this.name) && !this.isSkipped)) {
        return false;
    }
    this.player.skipList.remove(this.name);
    if (lib.phaseName.includes(this.name)) {
        this.player.getHistory("skipped").add(this.name);
    }
    this.finish();
    await this.trigger(this.name + "Skipped");
    return true;
}
```

2. **`finished` 且无后续时机与 `after`** — `return` 结束
3. **`_triggered === 5`**（被 `untrigger`）— 上述分支均不命中，进入 `after` 处理或结束

### 每个迭代都做 `waitNext()`

```ts
while (true) {
    await this.waitNext();     // ← 先把子事件跑完
    if (!this.finished) { ... }
```

这保证了：**content 中创建的子事件会被自动执行完，然后父事件才继续**。

---

## 3. phaseLoop —— 真正的对局循环

```ts
// apps/core/noname/library/element/content.ts:3766-3818
async phaseLoop(event, trigger, player) {
    let num = 1;
    let current = player;
    while (current.getSeatNum() === 0) {      // 初始化座次号
        current.setSeatNum(num);
        current = current.next;
        num++;
    }
    while (true) {                             // ★ 无限循环
        if (game.players.includes(event.player)) {
            lib.onphase.forEach(i => i());
            const phase = event.player.phase();
            event.next.remove(phase);          // ← 先移出，稍后手动 push
            let isRoundEnd = false;
            if (lib.onround.every(i => i(phase, event.player))) {
                isRoundEnd = _status.roundSkipped;
                if (_status.isRoundFilter) {
                    isRoundEnd = _status.isRoundFilter(phase, event.player);
                } else if (_status.seatNumSettled) {
                    const seatNum = event.player.getSeatNum();
                    if (seatNum != 0) {
                        if (get.itemtype(_status.lastPhasedPlayer) != "player" ||
                            seatNum < _status.lastPhasedPlayer.getSeatNum()) {
                            isRoundEnd = true;
                        }
                    }
                } else if (event.player == _status.roundStart) {
                    isRoundEnd = true;
                }
                if (isRoundEnd && _status.globalHistory.some(i => i.isRound)) {
                    game.log();
                    await event.trigger("roundEnd");
                }
            }
            event.next.push(phase);            // ← 再放回
            await phase;                       // ★ 等待整个回合结束
        }
        await event.trigger("phaseOver");
        const findNext = current => { /* 按 dataset.position 找下一位 */ };
        event.player = findNext(event.player); // 轮到下一个玩家
    }
}
```

### 逐步拆解

**① 初始化座次号**

```ts
let num = 1;
let current = player;
while (current.getSeatNum() === 0) {
    current.setSeatNum(num);
    current = current.next;
    num++;
}
```

从传入的起始玩家开始，顺时针给所有座次号为 0 的玩家编号。

**② `event.next.remove(phase)` 再 `push` 的意义**

```ts
const phase = event.player.phase();
event.next.remove(phase);     // ← 为什么先移除？
// ... 中间有 await（roundEnd 时机可能创建子事件）
event.next.push(phase);       // ← 再放回去
await phase;
```

`phase()` 内部通过 `game.createEvent("phase", false)` 创建事件，而 `createEvent` 会**自动 push 到当前事件的 `next`**。这里显式移除是为了**控制 phase 在队列中的位置**：中间的 `await event.trigger("roundEnd")` 可能产生其他子事件，把它们插到 phase 之前执行。之后重新 push 到队尾，保证 phase 最后执行。

**③ 轮次（round）判定**

`lib.onround` 是一个判定函数数组（各模式/扩展可注入），全部返回 `true` 才进行轮次判定逻辑。

三种判定路径：

| 条件 | 判定方式 |
|------|---------|
| `_status.isRoundFilter` 存在 | 用自定义函数 |
| `_status.seatNumSettled` 为真 | **比较座次号**：当前座次 < 上一次行动玩家座次 → 新轮 |
| 其他 | `event.player == _status.roundStart` → 新轮 |

新轮开始时触发 `roundEnd` 时机（在 phase 之前），phase 内部再触发 `roundStart`。

**④ `phaseOver` 与切换玩家**

```ts
await event.trigger("phaseOver");
event.player = findNext(event.player);
```

`findNext` 按 `dataset.position` 排序找下一个，**包含已死亡玩家**（因为某些技能需要死者回合）：

```ts
const players = game.players.slice(0)
    .concat(game.dead)
    .sort((a, b) => parseInt(a.dataset.position) - parseInt(b.dataset.position));
```

**⑤ 死亡玩家检查**

```ts
if (game.players.includes(event.player)) { ... }
```

若当前玩家已不在 `game.players`（已死亡/移除），**跳过其回合**，但仍会走 `phaseOver` 与切换。

⚠️ 注意 `event.player` 的初值是传入的 `player` 参数，循环中会被改写。

---

## 4. phaseLoop 谁创建

模式 start 中调用：

```js
game.phaseLoop(beginner)
```

它创建 `phaseLoop` 事件并标记为标准循环：

```js
// apps/core/noname/game/index.js（示意）
phaseLoop(player) {
    let next = game.createEvent("phaseLoop");
    next.player = player;
    next._isStandardLoop = true;
    next.setContent("phaseLoop");
    return next;
}
```

`setContent("phaseLoop")` → 查表得到 `lib.element.content.phaseLoop`。

---

## 5. gameDraw —— 进入循环前的初始发牌

```ts
// apps/core/noname/library/element/content.ts:3618
async gameDraw(event, trigger, player) { ... }
```

由 `game.gameDraw(beginner, ...)` 创建：

```js
let next = game.createEvent("gameDraw");
next.player = player;
next.num = num;
next.targets = targets;
next.setContent("gameDraw");
```

职责：

- 从 `player` 开始按座次遍历
- 对 `targets` 中玩家发 `num` 张牌
- 处理特殊牌堆 `otherPile`
- 设置 `_start_cards`
- 处理双将/特殊摸牌
- 必要时提供手气卡换牌

完成后进入 `phaseLoop`。

⚠️ **`gameDrawEnd` 时机有特殊副作用**，会设置全局标志：

```ts
// apps/core/noname/library/element/gameEvent.ts:469-471
if (name === "gameDrawEnd") {
    _status.gameDrawed = true;
}
```

这个标志控制 `gain`/`lose` 等事件是否触发时机（发牌前不触发）：

```ts
// apps/core/noname/library/element/gameEvent.ts:466-468
if (!_status.gameDrawed && ["lose", "gain", "loseAsync", "equip", "addJudge", "addToExpansion"].includes(this.name)) {
    return;
}
```

---

## 6. 完整对局循环图

```
phaseLoop（content.ts:3766）
│
├─ 初始化座次号
│
└─ while (true) ◄──────────────────────────────────┐
    │                                              │
    ├─ 当前玩家在 game.players 中？                 │
    │   ├─ 否 → 跳过其回合                          │
    │   └─ 是                                       │
    │       ├─ lib.onphase 回调                     │
    │       ├─ player.phase()  ──┐                 │
    │       │                    │                 │
    │       │   ┌────────────────┘                 │
    │       │   │  phase 事件（见 04）              │
    │       │   │   ├─ phaseBefore                 │
    │       │   │   ├─ roundStart（若新轮）         │
    │       │   │   ├─ phaseBegin                  │
    │       │   │   ├─ 六阶段循环                   │
    │       │   │   ├─ phaseEnd                    │
    │       │   │   └─ phaseAfter                  │
    │       │   └────────────────┐                 │
    │       │                    │                 │
    │       ├─ 轮次判定 → roundEnd 时机             │
    │       ├─ await phase  ◄────┘  等回合结束      │
    │       └─ ...                                  │
    │                                              │
    ├─ trigger("phaseOver")                        │
    ├─ findNext(player)                            │
    └──────────────────────────────────────────────┘
```

**整个对局就是这个循环不断转。** 它不会"返回"——直到游戏结束被外部打断。

---

## 7. 为什么不用传统主循环

传统游戏：

```js
while (gameRunning) {
    handleInput();
    update();
    render();
}
```

无名杀：

```js
// 每个事件自己决定下一步，父事件通过 next 队列等待
while (true) {
    await this.waitNext();     // 等子事件
    if (!finished) { /* 推进时机或执行 content */ }
    else { /* 收尾 */ }
}
```

**优势**：

| 特性 | 收益 |
|------|------|
| 事件可嵌套 | 技能可以"插入"到任意流程中间，中断/插入/延迟极其自然 |
| 基于 Promise | 天然支持异步交互（等待玩家选牌、动画、网络） |
| 控制反转 | 技能无需知道流程细节，只需声明时机 |
| 可暂停 | 任何 `await` 点都可以暂停（见 [11](11-pause-and-online.md)） |

**代价**：

- 调用栈极深，调试困难
- 状态分散在事件对象上
- 时序问题难以复现（依赖 `await` 微任务顺序）

---

## 8. 本篇小结

- `game.loop()` = `event.start()`，**不是**主循环
- `GameEvent.loop()` 是**单事件状态机**，由 `_triggered` 驱动
- **`phaseLoop` 才是对局主循环**，位于 `content.ts:3766`
- 循环结构：取玩家 → `player.phase()` → 等待 → `phaseOver` → 下一个玩家 → 无限重复
- `event.next.remove(phase)` 再 `push` 是为了控制 phase 在队列中的执行位置
- 轮次判定有三条路径，依赖 `_status.isRoundFilter` / `seatNumSettled` / `roundStart`
- `gameDrawEnd` 会设置 `_status.gameDrawed`，影响后续 `gain`/`lose` 是否触发时机

**下一步** → [04-turn-and-phase.md](04-turn-and-phase.md)：一个回合如何展开
