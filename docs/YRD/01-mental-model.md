# 01 · 心智模型：理解事件系统的五个关键抽象

> 本篇回答：**该用什么模型来理解事件系统？**
>
> 本篇不讲代码，讲**认知框架**。后续所有机制都建立在这五个抽象之上。

---

## 抽象一：事件树 —— 用"调用栈"类比

事件之间的关系是一棵**树**，而不是栈。

```ts
// apps/core/noname/library/element/gameEvent.ts:139-140
parent?: GameEvent;
childEvents: GameEvent[] = [];
```

- 子事件持有 `parent` 引用
- 父事件在子事件 `start()` 时把子事件加入 `childEvents`

```ts
// apps/core/noname/library/element/gameEvent.ts:231-233
if (this.parent) {
    this.parent.childEvents.push(this);
}
```

**重要认知**：这棵树**不是**执行顺序本身，而是**归属关系**。

| | 事件树 (`parent`/`childEvents`) | 执行队列 (`next`) |
|---|---|---|
| 回答 | "谁属于谁" | "接下来执行谁" |
| 用途 | 上下文查找、调试、`getParent` | 实际调度 |
| 比喻 | 函数调用的**词法嵌套** | 函数体的**语句顺序** |

一个父事件可以创建多个子事件，它们**串行**跑完，然后父事件继续。

### 为什么需要树

因为**时机触发需要知道"现在处于什么语境"**。

例如技能要判断"我是否在自己的出牌阶段"：

```js
// apps/core/noname/library/element/gameEvent.ts:1061-1067
isPhaseUsing(player) {
    const evt = this.getParent("phaseUse");
    if (!evt || evt.name != "phaseUse") {
        return false;
    }
    return !player || player == evt.player;
}
```

`getParent` 沿 `parent` 链向上查找，支持三种查询方式：

```ts
// apps/core/noname/library/element/gameEvent.ts:152-176
getParent(
    level: number | string | ((evt: GameEvent) => boolean) = 1,
    forced?: boolean,
    includeSelf?: boolean
): GameEvent | undefined
```

| `level` 类型 | 含义 | 示例 |
|-------------|------|------|
| `number` | 向上 N 层 | `getParent(2)` 祖父事件 |
| `string` | 按名字查找 | `getParent("phaseUse")` |
| `function` | 自定义谓词 | `getParent(e => e._trigger, false, true)` |

⚠️ **注意** `forced` 参数的反直觉命名：默认（`forced=false`）找不到时返回**空对象 `{}`**，而不是 `undefined`；传 `true` 才返回 `undefined`。

```ts
// apps/core/noname/library/element/gameEvent.ts:155
const toreturn = forced ? undefined : ({} as GameEvent);
```

🔬 **联机特例**：联机时若事件有 `_modparent`，`getParent` 沿 `_modparent` 而非 `parent` 向上。

```ts
// apps/core/noname/library/element/gameEvent.ts:166-170
if (game.online && event._modparent) {
    event = event._modparent;
} else {
    event = event.parent;
}
```

---

## 抽象二：next 队列 —— 串行执行的唯一通道

`next` 是父事件控制子事件的队列：

```ts
// apps/core/noname/library/element/gameEvent.ts:177-195
next: GameEvent[] = (() => {
    const event = this;
    return new Proxy<GameEvent[]>([], {
        set(target, p, childEvent, receiver) {
            if (childEvent instanceof GameEvent && !target.includes(childEvent)) {
                childEvent.parent = event;
                // ...
            }
            return Reflect.set(target, p, childEvent);
        },
    });
})();
```

**关键机制**：`next` 被 `Proxy` 包装，**push 时自动做两件事**：

1. 设置 `childEvent.parent = event`（自动建立树关系）
2. 若父事件已 `finished && #inContent`，立即 `resolve()` 子事件

第 2 点很微妙，防止已结束的事件继续产生活跃子事件：

```ts
// apps/core/noname/library/element/gameEvent.ts:188-190
if (event.#inContent && event.finished) {
    childEvent.resolve();
}
```

### 创建子事件的唯一入口

```js
// apps/core/noname/game/index.js:6016-6025
createEvent(name, trigger, triggerEvent) {
    const next = new lib.element.GameEvent(name, trigger, _status.eventManager);
    const parent = triggerEvent || _status.eventManager.getStartedEvent();
    if (parent) {
        parent.next.push(next);        // ← 自动挂到当前事件下
    } else {
        _status.event = next;
    }
    return next;
}
```

🖋 **默认挂载点**：`game.createEvent(name)` 不带第三个参数时，父事件是 `getStartedEvent()`，即**当前正在执行的事件**。

> 这就是为什么写技能时"随手 `game.createEvent` 就会自动接在当前流程后面"。

### 父事件如何等待子事件

```ts
// apps/core/noname/library/element/gameEvent.ts:306-334
waitNext(): Promise<Partial<Result> | void> {
    if (this.#waitNext) return this.#waitNext;
    this.#waitNext = (async () => {
        let result;
        while (true) {
            await _status.pauseManager.waitPause();
            // ... tempEvent 检查
            if (!this.next.length) return result;
            const next = this.next[0];
            await next.start();
            if (next.result) result = next.result;
            this.next.shift();
        }
    })().finally(() => (this.#waitNext = undefined));
    return this.#waitNext;
}
```

要点：

- **串行**：一次取 `next[0]`，等它跑完再取下个
- 返回**最后一个**子事件的 `result`
- 会等待 `pauseManager`（联机暂停）

---

## 抽象三：时机（Trigger）—— 控制反转的落点

**这是整个系统最核心的设计。**

技能**不主动调用流程**，而是声明"我关心哪个时机"：

```js
// 技能定义（示意）
lib.skill.xxx = {
    trigger: { player: "phaseDrawBegin" },   // 我关心这个时机
    cost: async (event, trigger, player) => { /* 能否发动 */ },
    content: async (event, trigger, player) => { /* 效果 */ },
};
```

事件在生命周期节点上"广播"时机：

```ts
// apps/core/noname/library/element/gameEvent.ts:247-292（loop 内节选）
const trigger = async (trigger: string, to: number) => {
    this._triggered = to;
    if (this.type == "card") {
        await this.trigger("useCardTo" + trigger);
    }
    await this.trigger(this.name + trigger);
};

// _triggered === 0 时：
await trigger("Before", 1);   // 触发 "事件名Before"
// _triggered === 1 时：
await trigger("Begin", 2);    // 触发 "事件名Begin"
// 之后执行 content
// finished 后：
await trigger("End", 3);      // 触发 "事件名End"
await trigger("After", 4);    // 触发 "事件名After"
```

**命名规则**：`事件名` + 时机后缀

| 时机后缀 | 触发时点 |
|---------|---------|
| `Before` | content 之前 |
| `Begin` | content 之前（稍晚） |
| `End` | 事件 finished 之后 |
| `After` | 最后 |
| `Omitted` | 被 `untrigger` 跳过时 |
| `Cancelled` | 被 `cancel` 时 |
| `Skipped` | 被跳过时 |

于是 `phaseDraw` 事件会触发 `phaseDrawBefore`、`phaseDrawBegin`、`phaseDrawEnd`、`phaseDrawAfter` —— 这就是技能"摸牌阶段开始时"挂载的位置。

**这个"事件名 → 时机名"的映射，是理解技能定义的关键。**

---

## 抽象四：content 编译 —— 两套语法的统一

`content` 有**三种写法**，但最终都被编译成**同一种异步函数**：

```ts
// apps/core/noname/library/element/GameEvent/compilers/IContentCompiler.ts:6-14
export type EventCompiledContent = ((e: GameEvent) => Promise<void>) & {
    compiled: true;
    type: string;
    original: EventCompileable;
    originals?: GeneralFunction[];
};
```

| 写法 | 编译器 | 状态 |
|------|--------|------|
| `async (event) => {...}` | `ArrayCompiler`（异步函数也被包装为单元素数组） | ✅ **推荐** |
| `[fn1, fn2, fn3]` | `ArrayCompiler` | 🚫 待废弃 |
| `function() { "step 0"; ... }` | `StepCompiler` | 🚫 待废弃 |

编译入口是**责任链模式**：

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompiler.ts:67-97
compile(content: EventCompileable): EventCompiledContent {
    // 已编译则直接返回
    if (content.compiled) return content;
    const target = this.regularize(content);
    const cached = this.#compiledContent.get(target);
    if (cached) return cached;
    for (const compiler of this.#compilers) {
        if (!compiler.filter(target)) continue;
        const compiled = compiler.compile(target);
        compiled.compiled = true;
        compiled.type = compiler.type;
        compiled.original = content;
        this.#compiledContent.set(target, compiled);   // 缓存
        return compiled;
    }
    throw new Error(`不受支持的content: \n ${String(target)}`);
}
```

编译器注册顺序：`ArrayCompiler` → `AsyncCompiler` → `StepCompiler`

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompiler.ts:102-104
compiler.addCompiler(new ArrayCompiler());
compiler.addCompiler(new AsyncCompiler());
compiler.addCompiler(new StepCompiler());
```

### regularize：字符串内容

`setContent("arrangeTrigger")` 这种字符串写法，会查表得到函数：

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompiler.ts:49-57
private regularize(content: EventCompileable): EventContent {
    if (typeof content === "string") {
        return lib.element.content[content] ?? lib.element.contents[content];
    } else if (Symbol.iterator in content) {
        return Array.from(content);
    }
    return content;
}
```

**所以 `setContent("phase")` 实际是取 `lib.element.content.phase`。**

⚠️ 注意 `Array.from(content)`：这意味着**任何可迭代对象都会被转成数组**，不限于数组。

---

## 抽象五：事件栈与 `_status.event` —— 当前上下文指针

`GameEventManager` 管理"当前在跑谁"：

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:10-21
eventStack: GameEvent[] = [];
rootEvent?: GameEvent;
tempEvent?: GameEvent;

getStartedEvent() {
    return this.tempEvent || this.eventStack.at(-1);
}
getStatusEvent() {
    return this.tempEvent || this.eventStack.at(-1) || this.rootEvent;
}
```

`_status.event` 的取值优先级：

```
tempEvent > eventStack.at(-1) > rootEvent
```

### 入栈与出栈

事件 `start()` 时入栈：

```ts
// apps/core/noname/library/element/gameEvent.ts:239
this.manager.setStatusEvent(this, true);   // internal = true → push
```

跑完后出栈：

```ts
// apps/core/noname/library/element/gameEvent.ts:240-243
await this.loop().then(() => {
    this.manager.popStatusEvent();
});
```

> ⚠️ **源码阅读陷阱（务必注意）**
>
> `start()` 里有一段**被注释掉的旧代码**，极易误读：
>
> ```ts
> // apps/core/noname/library/element/gameEvent.ts:230-244
> this.#start = (async () => {
>     if (this.parent) {
>         this.parent.childEvents.push(this);
>     }
>     game.getGlobalHistory("everything").push(this);
>     // if (this.manager.eventStack.length === 0) {      ← 已注释
>     // 	this.manager.rootEvent = this;                 ← 已注释
>     // }
>     // this.manager.eventStack.push(this);              ← 已注释
>     this.manager.setStatusEvent(this, true);            ← ★ 现行写法
>     await this.loop().then(() => {
>         // this.manager.eventStack.pop();               ← 已注释
>         this.manager.popStatusEvent();                  ← ★ 现行写法
>     });
> })();
> ```
>
> **看到注释就以为"栈机制被废弃了"是错的。** 那是对同一逻辑的**等价重构**：入栈/设置 rootEvent 的动作被搬进了 `setStatusEvent` 内部。
>
> 关键在于 `start()` 传的 `internal = true`，而 `setStatusEvent` 在**三条路径**上都会 push：
>
> ```ts
> // apps/core/noname/library/element/GameEvent/GameEventManager.ts:28-34
> if (this.eventStack.length === 0) {
>     this.rootEvent = event;
>     if (internal) { this.eventStack.push(event); }   // ← 栈空时入栈
> } else if (internal) {
>     this.eventStack.push(event);                     // ← 栈非空时入栈
> }
> ```
>
> 所以 `eventStack` 的入栈/出栈**完全正常运作**，栈依然是事件的完整祖先路径。

`setStatusEvent` 的四条分支：

```ts
// apps/core/noname/library/element/GameEvent/GameEventManager.ts:22-44
setStatusEvent(event: GameEvent, internal: boolean = false) {
    if (!(event instanceof GameEvent)) return;
    const oldEvent = this.getStatusEvent();
    if (this.eventStack.length === 0) {
        this.rootEvent = event;
        if (internal) this.eventStack.push(event);      // ① 栈空
    } else if (internal) {
        this.eventStack.push(event);                     // ② 正常入栈
    } else if (this.eventStack.includes(event)) {
        this.tempEvent = event;                          // ③ 已在栈中 → 临时覆盖
    } else {
        throw new Error("Cannot assign a value to _status.event that is not in eventStack.");
    }
    // 事件变化时发布公告
    if (oldEvent == null || event !== oldEvent) {
        lib.announce.publish("Noname.Game.Event.Changed", [event, oldEvent!]);
    }
}
```

⚠️ `popStatusEvent()` 的公告是**有条件**的，不是无条件触发：

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

因为栈顶弹出后，`getStatusEvent()` 可能返回 `tempEvent`（若存在），此时"当前事件"并未真正改变，无需公告。

🔬 **`tempEvent` 的用途**：把一个**已经在栈里**的事件临时设为当前事件，而不改变栈结构。联机时子事件回调需要重新指向父事件时会用到。

### 栈 = 树的一条路径

**核心洞察**：从根事件到任意正在执行的事件，`eventStack` 的内容恰好是**事件树上的一条路径**。

```
事件树                           eventStack
game                             [game]
 └─ phase                        [game, phase]
     └─ phaseUse                 [game, phase, phaseUse]
         └─ chooseToUse          [game, phase, phaseUse, chooseToUse]
             └─ useCard          [game, phase, phaseUse, chooseToUse, useCard]
```

这条性质是**深度优先执行**的直接结果：子事件在父事件 `waitNext()` 期间执行，父事件等子事件完成后恢复。

---

## 五个抽象如何协作

以"玩家在出牌阶段使用一张【杀】"为例：

```
① 事件树：phaseLoop → phase → phaseUse → chooseToUse → useCard
           （useCard 的 parent 链 = 上面这条路径）

② next 队列：chooseToUse.next = [useCard]
             chooseToUse.waitNext() 等待 useCard 完成

③ 时机：useCard 在 start 时触发 "useCardBefore"、"useCardBegin"
        技能通过 trigger 声明关心这些时机

④ content：每个事件的 content 都被 ContentCompiler 统一编译
           setContent("useCard") → lib.element.content.useCard

⑤ 事件栈：执行 useCard 时 _status.event = useCard
          技能通过 _status.event 拿到当前上下文
```

---

## 常见误解澄清

| ❌ 误解 | ✅ 实际 |
|--------|--------|
| 游戏有一个 `while(true)` 主循环 | `game.loop()` 只启动一个事件；循环藏在 `phaseLoop` 的 content 里 |
| `next` 是树结构 | `next` 是**串行队列**；树结构由 `parent`/`childEvents` 表达 |
| `getParent()` 找不到返回 `undefined` | 默认返回**空对象 `{}`**，需传 `forced=true` 才返回 `undefined` |
| 技能由游戏主动调用 | 技能**注册**到时机，由事件系统**回调**（控制反转） |
| `setContent("foo")` 是把字符串当 content | 是**查表**取 `lib.element.content.foo` |
| 事件必须手动 `start()` | `await event` 会自动触发 `start()`；`createEvent` 后 push 到 next，父事件会启动它 |
| `finish()` 会立即终止事件 | `finish()` 只设标志位，实际终止发生在 `loop()` 下轮迭代或 `isPrevented` 检查时 |
| **`start()` 里 push 代码被注释 → 栈机制失效** | **注释掉的是等价旧写法**；`setStatusEvent(this, true)` 内部同样会 push，`eventStack` 正常工作（详见上文"源码阅读陷阱"） |
| `popStatusEvent()` 总会发布变更公告 | **有条件**发布：仅当 `lastEvent == null \|\| lastEvent !== now` |

---

## 本篇小结

| 抽象 | 一句话 | 关键代码 |
|------|--------|---------|
| **事件树** | `parent`/`childEvents` 表达归属，用 `getParent` 查上下文 | `gameEvent.ts:139-176` |
| **next 队列** | 串行执行的唯一通道，Proxy 自动设 parent | `gameEvent.ts:177-334` |
| **时机** | 控制反转的落点，事件名+后缀 决定时机名 | `gameEvent.ts:247-292` |
| **content 编译** | 三种写法统一编译为异步函数，带缓存 | `ContentCompiler.ts:67-97` |
| **事件栈** | `_status.event` 指向当前事件，栈 = 树的一条路径 | `GameEventManager.ts:10-51` |

**下一步** → [02-startup-to-game.md](02-startup-to-game.md)：从 `index.html` 到游戏开始
