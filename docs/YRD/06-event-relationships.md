# 06 · 事件关系与调度

> 本篇回答：**事件之间如何组织？谁等谁？`await` 一个事件到底意味着什么？**
>
> 本篇覆盖事件树、`next`/`after` 队列、`waitNext`、`then` 语义与调度器。

---

## 1. 两种关系，别混淆

| | 事件树 | 执行队列 |
|---|--------|---------|
| 字段 | `parent` / `childEvents` | `next` / `after` |
| 回答 | "谁属于谁" | "接下来执行谁" |
| 用途 | 上下文查找、调试 | 实际调度 |
| 建立方式 | `next` Proxy 自动设置 | 显式 push |

**它们不是同一件事。** 一个事件可以创建很多子事件，但只有被 push 进 `next` 的才会被执行。

---

## 2. 事件树

```ts
// apps/core/noname/library/element/gameEvent.ts:139-140
parent?: GameEvent;
childEvents: GameEvent[] = [];
```

### parent 由 Proxy 自动设置

```ts
// apps/core/noname/library/element/gameEvent.ts:177-195
next: GameEvent[] = (() => {
    const event = this;
    return new Proxy<GameEvent[]>([], {
        set(target, p, childEvent, receiver) {
            if (childEvent instanceof GameEvent && !target.includes(childEvent)) {
                childEvent.parent = event;                         // ① 设 parent
                const type = childEvent.getDefaultNextHandlerType();
                if (type) {
                    childEvent.pushHandler(...event.getHandler(type));  // ② 传递 handler
                }
                if (event.#inContent && event.finished) {
                    childEvent.resolve();                          // ③ 立即 resolve
                }
            }
            return Reflect.set(target, p, childEvent);
        },
    });
})();
```

⚠️ **条件 ③ 的完整前提是 `#inContent && finished`**，不只是 `finished`：
> content 执行期间事件已 finish → 之后创建的子事件立即"已解决"，不再执行。

### childEvents 在 start() 时填充

```ts
// apps/core/noname/library/element/gameEvent.ts:231-233
if (this.parent) {
    this.parent.childEvents.push(this);
}
```

⚠️ **注意时序差异**：`parent` 在 push 到 `next` 时立即设置；`childEvents` 要等子事件 `start()` 时才填充。所以**未启动的子事件不会出现在 `childEvents` 里**。

### getParent —— 上下文查找

```ts
// apps/core/noname/library/element/gameEvent.ts:152-176
getParent(
    level: number | string | ((evt: GameEvent) => boolean) = 1,
    forced?: boolean,
    includeSelf?: boolean
): GameEvent | undefined {
    let event: GameEvent | undefined = this;
    let i = 0;
    const toreturn = forced ? undefined : ({} as GameEvent);
    const historys: GameEvent[] = [];
    const filter =
        typeof level === "function" ? level :
        typeof level === "number" ? evt => i === level :
        evt => evt.name === level;
    while (true) {
        if (!event) return toreturn;
        historys.push(event);
        if (filter(event) && (includeSelf || i !== 0)) return event;
        if (game.online && event._modparent) {
            event = event._modparent;          // 联机：沿 _modparent
        } else {
            event = event.parent;
        }
        if (historys.includes(event)) return toreturn;   // 防环
        i++;
    }
}
```

| 特性 | 说明 |
|------|------|
| 三种查询 | 数字（层数）/ 字符串（名）/ 函数（谓词） |
| `forced` | ⚠️ **反直觉**：`false`（默认）返回空对象 `{}`，`true` 返回 `undefined` |
| `includeSelf` | 数字模式下**不生效**（`i !== 0` 恒真，因为 `i` 从 1 才开始匹配） |
| 防环 | `historys.includes(event)` 防止 parent 成环导致死循环 |
| 联机 | 有 `_modparent` 时优先沿它查找 |

当 `level` 是数字时，`filter` 是 `evt => i === level`，但 `i` 在**检查之后**才自增，所以：

```
i=0 → 检查 this 自身（level=0 时匹配，但 includeSelf 无效）
i=1 → 检查 parent（level=1 默认匹配）
i=2 → 检查祖父
```

🔬 **实际用法**：

```js
event.getParent("phaseUse")       // 找最近的 phaseUse 祖先
event.getParent(e => e._trigger)  // 找最近的"触发源"事件
event.getParent(2)                // 祖父事件
```

### 特殊：getTrigger

```ts
// apps/core/noname/library/element/gameEvent.ts:211-215
_trigger: GameEvent;
triggername: string;
getTrigger() {
    return this.getParent(e => e._trigger, false, true)._trigger;
}
```

向上找第一个带 `_trigger` 的事件，返回其 `_trigger`。技能中常用 `event.getTrigger()` 拿到"触发我的那个事件"。

---

## 3. next 队列

`next` 是**串行队列**，父事件通过 `waitNext()` 逐个消费。

### 默认挂载点

```js
// apps/core/noname/game/index.js:6016-6025
createEvent(name, trigger, triggerEvent) {
    const next = new lib.element.GameEvent(name, trigger, _status.eventManager);
    const parent = triggerEvent || _status.eventManager.getStartedEvent();
    if (parent) {
        parent.next.push(next);        // ← 自动接在当前事件后面
    } else {
        _status.event = next;
    }
    return next;
}
```

`getStartedEvent()`:

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:16-18
getStartedEvent() {
    return this.tempEvent || this.eventStack.at(-1);
}
```

⚠️ 注意与 `getStatusEvent()` 的区别：

| 方法 | 返回值 | 用途 |
|------|--------|------|
| `getStartedEvent()` | `tempEvent \|\| eventStack.at(-1)` | **不含** `rootEvent` 兜底 |
| `getStatusEvent()` | `tempEvent \|\| eventStack.at(-1) \|\| rootEvent` | 含兜底 |

### after 队列 —— 延迟执行

```ts
after: GameEvent[] = [];
```

```ts
// apps/core/noname/library/element/gameEvent.ts:285-287
} else if (this.after.length) {
    this.next.push(this.after.shift()!);
}
```

`after` 中的事件在**所有时机触发完毕**后（`_triggered === 4` 且无其他分支命中）才被移入 `next` 执行。

| | `next` | `after` |
|--|--------|---------|
| 执行时机 | 下一次 `waitNext()` | 所有时机完成后 |
| 插入方式 | `game.createEvent` 自动 / `insert()` | `insertAfter()` |

### insert / insertAfter

```ts
// apps/core/noname/library/element/gameEvent.ts:197-210
insert(content, map) {
    const next = new GameEvent(`${this.name}Inserted`, false, this.manager);
    this.next.push(next);
    next.setContent(content);
    Object.entries(map).forEach(entry => next.set(entry[0], entry[1]));
    return next;
}
insertAfter(content, map) {
    const next = new GameEvent(`${this.name}Inserted`, false, this.manager);
    this.after.push(next);
    next.setContent(content);
    Object.entries(map).forEach(entry => next.set(entry[0], entry[1]));
    return next;
}
```

两者都创建 `trigger = false` 的事件（名为 `原名Inserted`），因此**不会触发时机**。

---

## 4. then() —— `await event` 的真实语义

**这是最容易误解的地方。**

```ts
// apps/core/noname/library/element/gameEvent.ts:91-93
then<TResult1, TResult2>(onfulfilled?, onrejected?): Promise<TResult1 | TResult2> {
    return (
        this.parent
            ? this.parent.waitNext().then(() => undefined)   // ← 有 parent：等待父事件跑完队列
            : this.start()                                   // ← 无 parent：自己启动
    ).then(onfulfilled, onrejected);
}
```

### 关键结论

| 情形 | `await event` 的行为 |
|------|---------------------|
| **有 `parent`** | **不会调用 `start()`**！只 `await parent.waitNext()`，即"等父事件把 `next` 队列跑到这里" |
| **无 `parent`** | 调用 `this.start()`，真正启动 |

> 💡 **为什么这样设计**：`game.createEvent()` 已经把事件 push 进了父事件的 `next`。父事件的 `waitNext()` 会按顺序 `start()` 它。如果 `then()` 再调一次 `start()`，就会**重复启动**。
>
> `start()` 本身是幂等的（`#start` 缓存），但更关键的是：**`await event` 的语义是"加入排队并等待轮到我"，而不是"立即执行我"**。

### 实践含义

```js
// 写法 A：await 一个刚创建的事件
const next = game.createEvent("damage");
next.player = target;
next.setContent("damage");
await next;              // ← 等父事件循环跑到 damage 并执行完

// 写法 B：更常见 —— 直接 await 玩家交互方法
const result = await player.chooseCard();
// player.chooseCard() 内部 createEvent 并 push，返回事件对象
// await 它会等父事件跑到该事件
```

⚠️ **陷阱**：如果事件**没有**被 push 进任何 `next`（例如手动构造且没挂载），且 `parent` 为空，则 `await` 会**启动它**；反之若已有 parent 但那个 parent 永远不会跑到它（例如父事件已结束），则 `await` **会永久挂起**。

### forResult —— 取结果

```ts
// apps/core/noname/library/element/gameEvent.ts:131-134
async forResult(): Promise<Partial<Result>> {
    await this;
    return this.result;
}
```

`forResult` 只是 `await this` 后返回 `this.result`。所以**它同样遵循上述语义**。

---

## 5. waitNext —— 队列消费

```ts
// apps/core/noname/library/element/gameEvent.ts:305-334
waitNext(): Promise<Partial<Result> | void> {
    if (this.#waitNext) {
        return this.#waitNext;
    }
    this.#waitNext = (async () => {
        let result;
        while (true) {
            await _status.pauseManager.waitPause();
            if (this.manager.tempEvent) {
                if (this.manager.tempEvent === this) {
                    this.manager.tempEvent = void 0;
                } else {
                    this.cancel(true, null, "notrigger");
                    return result;
                }
            }
            if (!this.next.length) {
                return result;
            }
            const next = this.next[0];
            await next.start();
            if (next.result) {
                result = next.result;
            }
            this.next.shift();
        }
    })().finally(() => (this.#waitNext = undefined));
    return this.#waitNext;
}
```

### 执行流程

```
① await pauseManager.waitPause()     ← 暂停点（联机暂停在此生效）
② tempEvent 检查
   · 指向自己      → 清除
   · 指向其他事件  → cancel 自己并退出
③ next 为空？     → 返回 result
④ 取 next[0]，await start()
⑤ 若 result 为真值 → 覆盖
⑥ shift 出队，回到 ①
```

⚠️ **`result` 只被真值覆盖**（`if (next.result)`），空结果不覆盖。

⚠️ **`shift()` 在 `start()` 之后**：若 `start()` 抛错，该元素不会出队。但实践中 content 错误多被 catch 吞掉（见 [05](05-event-lifecycle.md) §5）。

🔬 **`#waitNext` 的幂等**：`.finally(() => (this.#waitNext = undefined))` 在完成后清除缓存，所以下次调用会重新消费新加入的队列。

---

## 6. 调度器：GameEventManager

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:10-21
eventStack: GameEvent[] = [];
rootEvent?: GameEvent;
tempEvent?: GameEvent;

get event() {
    return this.getStatusEvent();
}
getStartedEvent() {
    return this.tempEvent || this.eventStack.at(-1);
}
getStatusEvent() {
    return this.tempEvent || this.eventStack.at(-1) || this.rootEvent;
}
```

### `_status.event` 的取值链

```
tempEvent  →  eventStack.at(-1)  →  rootEvent
```

### 入栈/出栈

- **入栈**：`start()` 调 `setStatusEvent(this, true)`，内部 push（详见 [01](01-mental-model.md) 的"源码阅读陷阱"）
- **出栈**：`popStatusEvent()` 弹出栈顶

### 树与栈的对应关系

**核心性质**：从根事件到当前执行事件的路径 = `eventStack` 内容。

```
事件树                                 事件栈
game                                   [game]
 └─ phase                              [game, phase]
     └─ phaseUse                       [game, phase, phaseUse]
         └─ chooseToUse                [game, phase, phaseUse, chooseToUse]
             └─ useCard                [game, phase, phaseUse, chooseToUse, useCard]
```

这是**深度优先执行**的必然结果：子事件在父事件 `waitNext()` 期间执行，父事件等子事件完成后恢复。

> ⚠️ **验证说明**：此性质曾因源码中 push/pop 被注释而产生争议。经用等价模型实测验证，`setStatusEvent(this, true)` 确实入栈，栈演化确为完整祖先路径，且与被注释的旧写法**行为完全一致**（属等价重构）。详见 [01](01-mental-model.md)。

### tempEvent —— 软切换

把一个**已在栈中**的事件临时设为 `_status.event`，不改变栈结构：

```ts
} else if (this.eventStack.includes(event)) {
    this.tempEvent = event;
}
```

⚠️ 若事件**不在栈中**且 `internal` 为 false，会**抛错**：

```ts
throw new Error("Cannot assign a value to _status.event that is not in eventStack.");
```

### 变更公告

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:41-43
if (oldEvent == null || event !== oldEvent) {
    lib.announce.publish("Noname.Game.Event.Changed", [event, oldEvent!]);
}
```

`popStatusEvent()` 中同样**有条件**发布：

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:45-51
popStatusEvent() {
    const lastEvent = this.eventStack.pop();
    const now = this.getStatusEvent();
    if (lastEvent == null || lastEvent !== now) {     // ← 有条件
        lib.announce.publish("Noname.Game.Event.Changed", [now!, lastEvent!]);
    }
}
```

⚠️ 因为弹出后 `getStatusEvent()` 可能返回 `tempEvent`，此时"当前事件"并未改变，无需公告。**不是无条件触发。**

---

## 7. 完整执行示例

以"出牌阶段使用一张牌"为例：

```
1. game.createEvent("chooseToUse")
   → 创建事件，parent 设为"当前事件"，push 到其 next

2. 父事件 waitNext() → 取 chooseToUse → await start()
   → 入栈：eventStack = [game, phase, phaseUse, chooseToUse]
   → _status.event = chooseToUse

3. chooseToUse.content 执行
   → game.createEvent("useCard")
   → push 到 chooseToUse.next

4. chooseToUse.waitNext() → 取 useCard → await start()
   → 入栈：eventStack = [..., chooseToUse, useCard]
   → _status.event = useCard

5. useCard.loop()
   → _triggered=0 → trigger("useCardBefore")
   → _triggered=1 → trigger("useCardBegin")
   → _triggered=2 → 执行 content

6. trigger("useCardBegin") 内部（见 08 篇）
   → 查 hookmap，收集技能
   → 创建 arrangeTrigger 事件，push 到 useCard.next
   → useCard.waitNext() 取 arrangeTrigger → await start()
   → 入栈：eventStack = [..., useCard, arrangeTrigger]

7. arrangeTrigger 执行
   → 对每个技能创建 createTrigger 事件
   → 内层 await 执行 cost/content

8. arrangeTrigger 完成 → 出栈
   → eventStack = [..., useCard]

9. useCard 继续 → trigger("useCardEnd") → trigger("useCardAfter")
   → 完成 → 出栈
   → eventStack = [..., chooseToUse]

10. chooseToUse 继续（若 result.bool 为真，可能 goto 回选择步骤）
```

**要点**：

- 树与栈同步演化
- 深度优先：子事件在父事件 `waitNext()` 期间执行
- `_status.event` 始终指向"当前最内层正在执行的事件"

---

## 8. 本篇小结

- **树（`parent`/`childEvents`）与队列（`next`/`after`）是两种关系**，别混淆
- `next` 的 Proxy 自动设 `parent`、传 `onNextXxx` handler、在 `#inContent && finished` 时立即 resolve
- `getParent(level, forced, includeSelf)`：⚠️ `forced=false` 返回**空对象**而非 `undefined`
- **`then()` 有 parent 时不调用 `start()`**，只 `await parent.waitNext()`（避免重复启动）
- `waitNext()` 串行消费队列，是暂停点，`result` 仅被真值覆盖
- **`popStatusEvent` 的公告是有条件的**，不是无条件
- `eventStack` = 事件树的一条祖先路径（已实测验证）
- `getStartedEvent()` 不含 `rootEvent` 兜底，`getStatusEvent()` 含

**下一步** → [07-content-system.md](07-content-system.md)：content 编译系统
