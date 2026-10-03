# 05 · 事件生命周期

> 本篇回答：**单个事件从创建到结束，经历哪些状态？`start`/`loop`/`finish`/`cancel` 各自做什么？**
>
> 本篇是 [03](03-game-loop.md) 中 `loop()` 的展开，聚焦**单事件视角**。

---

## 1. 生命周期总览

```
new GameEvent(name, trigger, manager)
    │  ① 创建
    │     · 设置 name / manager
    │     · trigger=true 且非联机 → _triggered = 0
    │     · 注册到 globalEventHandlers
    ▼
.setContent(content)
    │  ② 编译 content（ContentCompiler）
    ▼
（被 push 到父事件的 next，或作为根事件）
    │
    ▼
.start()                                   ← 启动
    │  ③ parent.childEvents.push(this)
    │  ④ globalHistory("everything").push(this)
    │  ⑤ setStatusEvent(this, true)   ← 入栈
    │  ⑥ await loop()
    │  ⑦ popStatusEvent()             ← 出栈
    ▼
.loop()                                    ← 状态机
    │  checkSkipped() ?
    │  while(true):
    │     waitNext()                ← 先跑完子事件
    │     if (!finished):
    │        _triggered 0 → trigger("Before", 1)
    │        _triggered 1 → trigger("Begin", 2)
    │        else        → 执行 content
    │     else:
    │        _triggered 1 → trigger("Omitted", 4)
    │        _triggered 2 → trigger("End", 3)
    │        _triggered 3 → trigger("After", 4)
    │        after 非空    → 移入 next
    │        else         → return 结束
    ▼
（结束）
```

---

## 2. ① 创建

```ts
// apps/core/noname/library/element/gameEvent.ts:20-35
constructor(name: string = "", trigger: boolean = true, manager = _status.eventManager) {
    // 允许用另一个事件作为模板构造
    if (name instanceof GameEvent) {
        const other = name;
        name = other.name;
        manager = other.manager;
        trigger = other._triggered !== null;
    }

    this.name = name;
    this.manager = manager;
    if (trigger && !game.online) {
        this._triggered = 0;          // ← 只有 trigger=true 才进入时机流程
    }
    game.globalEventHandlers.addHandlerToEvent(this);
}
```

**`trigger` 参数决定 `_triggered` 的初值**：

| `trigger` | 非联机时 `_triggered` | 效果 |
|-----------|---------------------|------|
| `true`（默认） | `0` | 会依次触发 `Before`/`Begin`/`End`/`After` |
| `false` | `null` | 跳过时机，直接执行 content |

⚠️ **联机时（`game.online`）恒为 `null`** —— 客机不同步时机流程（见 [11](11-pause-and-online.md)）。

### 特殊的初始事件

```ts
// apps/core/noname/library/element/gameEvent.ts:36-40
static initialGameEvent() {
    const event = new GameEvent();
    event.finish();
    return event;
}
```

一个**已 finish 的空事件**，在 boot 时赋给 `_status.event`，作为事件栈的初始占位。

---

## 3. ② 设置 content

```ts
// apps/core/noname/library/element/gameEvent.ts:69-76
content: EventCompiledContent;
setContent(content: EventCompileable) {
    if (this.#inContent) {
        throw new Error("Cannot set content when content is running");
    }
    this.content = ContentCompiler.compile(content);
    return this;
}
```

⚠️ **content 执行期间禁止更换 content**（`#inContent` 检查）。

支持三种写法，统一编译，详见 [07](07-content-system.md)。

---

## 4. ③④⑤⑥⑦ start()

```ts
// apps/core/noname/library/element/gameEvent.ts:226-246
start() {
    if (this.#start) {
        return this.#start;          // ← 幂等：重复调用返回同一个 Promise
    }
    this.#start = (async () => {
        // ③ 建立树关系
        if (this.parent) {
            this.parent.childEvents.push(this);
        }
        // ④ 加入全局历史
        game.getGlobalHistory("everything").push(this);

        // ⑤ 入栈（详见 01 篇的"源码阅读陷阱"）
        this.manager.setStatusEvent(this, true);

        // ⑥ 执行
        await this.loop().then(() => {
            // ⑦ 出栈
            this.manager.popStatusEvent();
        });
    })();
    return this.#start;
}
```

**四个要点**：

| 要点 | 说明 |
|------|------|
| **幂等** | `#start` 缓存 Promise，重复 `start()` 不重复执行 |
| **树关系** | `parent.childEvents.push(this)` 建立归属 |
| **全局历史** | 所有启动过的事件都进 `globalHistory("everything")`，供技能查历史 |
| **栈配对** | `setStatusEvent` 与 `popStatusEvent` 严格配对 |

🔬 **`globalHistory` 的用途**：技能可以用 `getGlobalHistory()` 查询"本回合/本局发生过什么"，例如"本回合是否使用过【杀】"。

---

## 5. ⑧ loop() —— 状态机

```ts
// apps/core/noname/library/element/gameEvent.ts:247-292
async loop() {
    const trigger = async (trigger: string, to: number) => {
        this._triggered = to;
        if (this.type == "card") {
            await this.trigger("useCardTo" + trigger);   // 卡牌事件额外时机
        }
        await this.trigger(this.name + trigger);
    };

    if (await this.checkSkipped()) {
        return;
    }

    while (true) {
        await this.waitNext();                    // ← 每轮先跑完子事件
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

### `_triggered` 状态机（准确版）

| 值 | 含义 | 下一步 |
|----|------|--------|
| `null` | 不触发时机（`trigger=false` 或联机） | 直接执行 content |
| `0` | 初始态 | → `trigger("Before", 1)` |
| `1` | Before 已完成 | → `trigger("Begin", 2)` |
| `2` | Begin 已完成 | → 执行 content |
| `3` | End 已触发 | → `trigger("After", 4)` |
| `4` | After 已触发 / 终止态 | → 处理 `after` 或结束 |
| `5` | 被 `untrigger` 强制终止 | → 处理 `after` 或结束 |

**已 finish 时的收尾分支**：

| `_triggered` | 触发 | 置为 | 含义 |
|-------------|------|------|------|
| `1` | `XXXOmitted` | `4` | Before 之后就被跳过 |
| `2` | `XXXEnd` | `3` | 正常执行完 content |
| `3` | `XXXAfter` | `4` | End 之后 |
| 其他 | — | — | 检查 `after` 队列 |

⚠️ **注意 `_triggered === 2` 时触发的是 `End` 而非 `After`**，触发后置为 `3`；下一轮才由 `3` 触发 `After`。这里容易读错。

### card 类型的额外时机

```ts
if (this.type == "card") {
    await this.trigger("useCardTo" + trigger);
}
```

卡牌事件（`type === "card"`）会**额外**触发 `useCardToBefore`/`useCardToBegin`/`useCardToEnd`/`useCardToAfter`，用于"成为目标时"的技能。

### 提前退出：checkSkipped

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

若玩家在 `skipList` 中登记了该事件名（如"跳过摸牌阶段"），直接 finish 并触发 `XXXSkipped`。

### content 的错误处理

```ts
// apps/core/noname/library/element/gameEvent.ts:267-275
let next = this.content(this).catch(error => {
    if (lib.config.ignore_error || (_status.connectMode && !lib.config.debug)) {
        game.print("游戏出错：" + this.name);
        game.print(error.toString());
        console.error(error);
    } else {
        throw error;
    }
});
```

- 开发模式（默认）：**抛出错误**，便于定位
- 配置 `ignore_error` 或联机非调试模式：**吞掉错误**只打印，避免一个技能出错毁掉整局

🔬 这就是为什么联机时经常"技能没效果但不报错"。

---

## 6. ⑨ waitNext() —— 页内等待

```ts
// apps/core/noname/library/element/gameEvent.ts:305-334
#waitNext?: Promise<Partial<Result> | void>;
waitNext(): Promise<Partial<Result> | void> {
    if (this.#waitNext) {
        return this.#waitNext;              // ← 幂等复用
    }
    this.#waitNext = (async () => {
        let result;
        while (true) {
            await _status.pauseManager.waitPause();      // ← 暂停点

            if (this.manager.tempEvent) {
                if (this.manager.tempEvent === this) {
                    this.manager.tempEvent = void 0;     // 清除自己
                } else {
                    this.cancel(true, null, "notrigger"); // ← 被其他事件抢占
                    return result;
                }
            }

            if (!this.next.length) {
                return result;
            }
            const next = this.next[0];
            await next.start();
            if (next.result) {
                result = next.result;               // ← 仅真值时覆盖
            }
            this.next.shift();
        }
    })().finally(() => (this.#waitNext = undefined));
    return this.#waitNext;
}
```

**四个要点**：

| 要点 | 说明 |
|------|------|
| **幂等** | `#waitNext` 缓存，重复调用复用同一 Promise |
| **暂停点** | 每次循环 `await waitPause()`，这是联机暂停生效的位置 |
| **tempEvent 抢占** | 若当前事件被其他事件抢占，自身 `cancel` 退出 |
| **串行** | 一次取 `next[0]`，等完再取 |

⚠️ **`result` 只在真值（truthy）时覆盖**：

```ts
if (next.result) {
    result = next.result;
}
```

空结果不会覆盖已有结果。

⚠️ **`next.shift()` 在 `await next.start()` 之后** —— 若 `start()` 抛错，元素不会出队（但通常错误已被 content 的 catch 处理）。

---

## 7. ⑩ 结束：finish

```ts
// apps/core/noname/library/element/gameEvent.ts:671-675
#inContent = false;
finished = false;
finish() {
    this.finished = true;
}
```

⚠️ **`finish()` 只是设置标志位，不会立即终止执行。**

实际终止发生在：

1. `loop()` 的下一轮迭代（检查 `if (!this.finished)`）
2. `ArrayCompiler` 的循环条件（`while (!event.finished)`）
3. `isPrevented()` 检查

```ts
// apps/core/noname/library/element/GameEvent/compilers/ArrayCompiler.ts:23-27
while (!event.finished) {
    if (event.step >= content.length) {
        event.finish();
        break;
    }
    ...
```

### `#inContent` 的标志作用

```ts
this.#inContent = true;
let next = this.content(this).catch(...);
await next.finally(() => (this.#inContent = false));
```

`#inContent` 有两个用途：

1. **`setContent` 保护**：content 运行中禁止更换
2. **`next` Proxy 的 resolve 条件**：`if (event.#inContent && event.finished)` 时新子事件立即 resolve

```ts
// apps/core/noname/library/element/gameEvent.ts:188-190
if (event.#inContent && event.finished) {
    childEvent.resolve();
}
```

含义：**content 执行期间如果事件已 finish，之后创建的子事件直接"已解决"**，不再真正执行。

---

## 8. 中断的四种方式

| 方法 | 位置 | 效果 | 触发时机 |
|------|------|------|---------|
| `finish()` | `:673` | 仅设 `finished = true` | 无 |
| `cancel(all, player, notrigger)` | `:677` | `untrigger` + 记录 skipped + 触发 `XXXCancelled` + finish | `XXXCancelled` |
| `untrigger(all, player)` | `:650` | 设 `_triggered = 5`，终止 `_triggering` | 无 |
| `neutralize(event)` | `:692` | 标记失效，触发 `eventNeutralized` | `eventNeutralized` |

### cancel

```ts
// apps/core/noname/library/element/gameEvent.ts:677-689
cancel(all?: any, player?: any, notrigger?: any) {
    this.untrigger(all, player);
    let next;
    if (!notrigger) {
        if (this.player && lib.phaseName.includes(this.name)) {
            this.player.getHistory("skipped").add(this.name);
        }
        this._cancelled = true;
        next = this.trigger(this.name + "Cancelled");
    }
    this.finish();
    return next;
}
```

⚠️ 传 `notrigger` 为真值时**不触发** `XXXCancelled`（`waitNext` 抢占自己时用的就是 `cancel(true, null, "notrigger")`）。

### untrigger

```ts
// apps/core/noname/library/element/gameEvent.ts:650-662
untrigger(all = true, player?: Player) {
    if (all) {
        if (all !== "currentOnly") {
            this._triggered = 5;          // ← 终止态
        }
        if (this._triggering) {
            this._triggering.finish();
        }
    } else if (player) {
        this._notrigger.add(player);
    }
    return this;
}
```

`_triggered = 5` 使 `loop()` 的收尾分支全部不命中，从而跳过剩余时机。

### neutralize

```ts
// apps/core/noname/library/element/gameEvent.ts:691-713
_neutralized = false;
async neutralize(event = _status.event) {
    if (this._neutralized) {
        return this._triggering;
    }
    this._neutralized = true;
    this._neutralize_event = event;
    const next = this.trigger("eventNeutralized");
    if (next) {
        next.filterStop = function () {
            if (!this._neutralized) {
                delete this.filterStop;
                return true;
            }
            return false;
        };
    }
    await next;
    if (this._neutralized == true) {
        this.untrigger();
        this.finish();
    }
}
```

用于"事件被无效化"（如部分技能的"取消此牌效果"）。`unneutralize()` 可撤销：

```ts
// apps/core/noname/library/element/gameEvent.ts:714-722
unneutralize() {
    if (!this._neutralized) {
        return;
    }
    this._neutralized = false;
    if (this.type == "card" && this.card && this.name == "sha") {
        this.directHit = true;      // 特殊的【杀】命中处理
    }
}
```

---

## 9. 完整示例：一个伤害事件

```
game.createEvent("damage")
    │ 触发时机（trigger=true）
    ▼
start()
  ├─ 入栈 [..., damage]
  └─ loop()
       ├─ checkSkipped() → false
       ├─ waitNext()（空）
       ├─ _triggered===0 → trigger("damageBefore", 1)
       │     └─ 查 hookmap["damageBefore"]，收集技能
       │         └─ arrangeTrigger → createTrigger → cost/content
       ├─ waitNext()
       ├─ _triggered===1 → trigger("damageBegin", 2)
       ├─ waitNext()
       ├─ _triggered===2 → 执行 content
       │     └─ 扣血、记录历史、创建子事件...
       │         └─ 子事件被 push 到 next，下一轮 waitNext 执行
       ├─ [content 中可能调用 finish()]
       ├─ finished → _triggered===2 → trigger("damageEnd", 3)
       ├─ triggered===3 → trigger("damageAfter", 4)
       └─ return
  └─ 出栈
```

---

## 10. 本篇小结

- 生命周期：**创建 → setContent → start → loop → 结束**
- `start()` = 建树 + 全局历史 + 入栈 + `loop()` + 出栈，且**幂等**
- `_triggered` 状态机驱动时机：`0→Before`、`1→Begin`、`2→执行content`、`2→End`、`3→After`
- **`finish()` 只设标志，不立即终止**
- `waitNext()` 是子事件等待点，也是**暂停点**（`waitPause`）
- `#inContent && finished` 时新子事件**立即 resolve**
- 中断四法：`finish` / `cancel` / `untrigger` / `neutralize`，语义各不同
- content 错误在联机或 `ignore_error` 时被**吞掉**，这是"技能静默失效"的常见原因

**下一步** → [06-event-relationships.md](06-event-relationships.md)：事件之间的关系与调度
