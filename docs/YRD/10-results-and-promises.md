# 10 · 结果传递与 Promise 语义

> 本篇回答：**事件结果如何产生和传递？`await` 一个事件到底在等什么？`result` 从哪来？**
>
> 本篇澄清最容易误解的几个 API 语义。

---

## 1. result 从哪来

`result` 是事件的产出，由**交互事件**（询问玩家）或**content 显式赋值**产生。

```ts
// apps/core/noname/library/element/gameEvent.ts:83
result: Partial<Result>;
```

典型来源：

| 来源 | 说明 |
|------|------|
| 玩家交互事件 | `chooseCard`/`chooseToUse`/`chooseBool` 等会写入 `result` |
| content 显式赋值 | `event.result = {...}` |
| `waitNext()` 的传递 | 子事件 result 被父事件收集（见下） |

---

## 2. then() —— 最关键也最容易误解

```ts
// apps/core/noname/library/element/gameEvent.ts:91-93
then<TResult1, TResult2>(onfulfilled?, onrejected?): Promise<TResult1 | TResult2> {
    return (
        this.parent
            ? this.parent.waitNext().then(() => undefined)
            : this.start()
    ).then(onfulfilled, onrejected);
}
```

### 两种分支

| 情形 | 行为 | 返回 |
|------|------|------|
| **有 `parent`** | `await parent.waitNext()` | **`undefined`**（注意：不是 `this.result`！） |
| **无 `parent`** | `this.start()` | Promise |

> ⚠️ **有 parent 时不会调用 `start()`**。很多人以为 `await event` 是"启动事件"，实际是"**等父事件把队列跑到我**"。

因为 `game.createEvent()` 已经把事件 push 进了父事件的 `next`，父事件 `waitNext()` 会负责 `start()` 它。若 `then()` 再启动一次就会重复执行。

### 为什么返回 undefined

```ts
this.parent.waitNext().then(() => undefined)
```

即使 `waitNext()` 有返回值（最后一个子事件的 result），`then()` 也**显式丢弃**，返回 `undefined`。

> 💡 所以要拿结果**必须用 `forResult()`**，不能直接从 `await` 拿：

```js
// ❌ 拿不到结果
const r = await player.chooseCard();     // r 是 undefined

// ✅ 正确
const r = await player.chooseCard().forResult();   // r 是 Result 对象
```

---

## 3. forResult()

```ts
// apps/core/noname/library/element/gameEvent.ts:131-134
async forResult(): Promise<Partial<Result>> {
    await this;          // ← 走 then() 的语义
    return this.result;
}
```

`forResult` = `await this` + 返回 `this.result`。

⚠️ **它同样遵循 `then()` 的语义**：有 parent 时是"等父事件跑到我"，无 parent 时是"启动我"。

---

## 4. waitNext 的结果合并

```ts
// apps/core/noname/library/element/gameEvent.ts:310-332
this.#waitNext = (async () => {
    let result;
    while (true) {
        await _status.pauseManager.waitPause();
        if (this.manager.tempEvent) { /* ... */ }
        if (!this.next.length) {
            return result;
        }
        const next = this.next[0];
        await next.start();
        if (next.result) {          // ← 仅真值覆盖
            result = next.result;
        }
        this.next.shift();
    }
})().finally(() => (this.#waitNext = undefined));
```

### 要点

1. **返回最后一个"有真值结果"的子事件的 result**
2. `if (next.result)` —— **空结果（`undefined`/`null`/`false`）不覆盖**

⚠️ 注意：`result` 是个对象（如 `{bool: false}`），它本身是**真值**，会被覆盖。而被覆盖的是"有没有 result 对象"，不是"bool 是否为真"。

---

## 5. ArrayCompiler 的结果合并

```ts
// apps/core/noname/library/element/GameEvent/compilers/ArrayCompiler.ts:30-36
let result: Result | undefined;
if (!compiler.isPrevented(event)) {
    const original = content[event.step];
    result = await Reflect.apply(original, this, [event, event._trigger, event.player, event._result]);
}
const nextResult = await event.waitNext();
event._result = result ?? nextResult ?? event._result;
```

**优先级**：

```
result（步骤函数返回值）
  ?? nextResult（waitNext 收集的子事件结果）
    ?? event._result（保留原值）
```

⚠️ **步骤函数的返回值优先于子事件结果**。这与"`_result` 存最后一个子事件结果"的字面理解相反。

### `_result` 传给下一步

```ts
result = await Reflect.apply(original, this, [event, event._trigger, event.player, event._result]);
```

第四个参数是 `event._result`，所以 step 写法中：

```js
event.setContent(function () {
    "step 0";
    player.chooseCard();
    "step 1";
    // 这里的 result 就是 event._result（step 0 的结果）
    if (result.bool) { /* ... */ }
});
```

🔬 StepCompiler 通过 `_result: result` 解构重命名注入：

```ts
// compilers/StepCompiler.ts:31
static deconstructs = ["step", "source", "target", "targets", "card", "cards", "skill", "forced", "num", "_result: result"];
```

---

## 6. Result 对象的常见字段

```ts
// apps/core/typings/Result.d.ts（结构概览）
interface Result {
    bool: boolean;              // 主要结果：是否/成功与否
    cards: Card[];              // 选中的牌
    targets: Player[];          // 选中的目标
    players: Player[];          // 涉及的玩家
    control: string;            // chooseControl 的选择
    index: number;              // 选择索引
    cost_data: any;             // cost 阶段的附加数据
    // ... 各事件特有字段
}
```

### 常见用法

```js
const result = await player.chooseCard().forResult();
if (result.bool) {
    const cards = result.cards;      // 选中的牌
}

const result2 = await player.chooseTarget().forResult();
if (result2.bool) {
    const targets = result2.targets; // 选中的目标
}
```

---

## 7. cost_data 与 event.result

⚠️ **`cost_data` 不是 `result.cost_data` 的别名**：

```ts
// apps/core/noname/library/element/gameEvent.ts:84
cost_data: Result["cost_data"];
```

它只是一个**独立声明的事件字段**，与 `result.cost_data` **没有自动同步机制**。需要手动赋值。

---

## 8. 联机重放：_args

`_args` 是**联机指令重放**的载体：

- **主机**：在创建交互事件时记录方法参数

```js
// apps/core/noname/library/element/player.js（40+ 处）
next._args = args;
```

- **客机**：收到事件名与参数后，用 `apply` 重放同名方法

```ts
// apps/core/noname/library/element/content.ts:1447
await game[event.name].apply(game, event._args);
```

- **发送**：`send()` 把 `_args` 一并发出

```ts
// apps/core/noname/library/element/gameEvent.ts:1009
this._args || [],
```

> ⚠️ `_args` 并非只在 `game.createEvent` 中写入 —— `game/index.js` 的 `createEvent` **不写** `_args`；写入点主要在 `player.js` 的各交互方法、`library/skill.js`、以及部分事件构造处。

🔬 源码中还有基于 `_args` 的"重放"用法：

```js
// apps/core/noname/library/skill.js:2077-2088
event._args = [trigger.num, trigger.nature, trigger.cards, trigger.card];
if (/* ... */) {
    event._args.push(trigger.source);
}
// ...
target.damage.apply(target, event._args.slice(0));
```

---

## 9. 常见 Promise 陷阱

### 陷阱 1：以为 `await` 会启动事件

```js
const evt = game.createEvent("damage");
evt.player = target;
evt.setContent("damage");
// 此时 evt 已 push 到父事件 next
const r = await evt;        // ← 不会启动，而是等父事件跑到它
```

若父事件**永远不会**跑到它（如父事件已 `finish`），则**永久挂起**。

### 陷阱 2：从 `await` 拿结果

```js
const r = await player.chooseCard();        // ❌ undefined
const r = await player.chooseCard().forResult();  // ✅
```

### 陷阱 3：忘记 `forResult` 直接解构

```js
const { bool, cards } = await player.chooseCard();        // ❌ 报错/undefined
const result = await player.chooseCard().forResult();      // ✅
if (result.bool) { /* ... */ }
```

### 陷阱 4：事务未等待

```js
player.draw(2);            // ❌ 未 await，牌还没摸
await player.draw(2);      // ✅
```

⚠️ 但注意：`player.draw(2)` 返回的是**已 push 到 next 的事件**，`await` 它有实际意义（等父事件跑到它）。

### 陷阱 5：在非事件上下文 await

技能 content 内可以自由 `await`。但在**同步回调**（如 `filterCard`）中不能 `await` —— 那类函数必须同步返回。

---

## 10. 结果传递全景图

```
玩家交互（ui）
    │ 玩家点击/选择
    ▼
交互事件（如 chooseCard）写入 this.result
    │
    ▼
父事件 waitNext() 收集（仅真值覆盖）
    │
    ▼
父事件 ArrayCompiler 合并
    event._result = result ?? nextResult ?? event._result
    │
    ▼
作为第四参数传给下一个 step
    │
    ▼
技能 content 内 await ... .forResult() 获取
```

---

## 11. 本篇小结

- `result` 由交互事件或 content 显式赋值产生
- **`then()` 有 parent 时不调 `start()`，返回 `undefined`** —— 所以 `await` 拿不到结果
- **取结果必须用 `forResult()`**
- `waitNext()` 返回最后一个**有真值 result** 的子事件结果，空结果不覆盖
- ArrayCompiler 的 `_result` 优先级：**步骤返回值 > 子事件结果 > 原值**
- `cost_data` **不是** `result.cost_data` 的别名，无自动同步
- `_args` 是联机重放载体，写入点在 `player.js` 等交互方法中
- 常见陷阱：`await` 不会启动事件、不加 `forResult` 拿不到结果、忘记 `await` 导致未等待

**下一步** → [11-pause-and-online.md](11-pause-and-online.md)：暂停与联机
