# 07 · content 编译系统

> 本篇回答：**三种 content 写法如何统一编译执行？step 语法是怎么"解析"的？`goto` 为何延迟生效？**
>
> 本篇覆盖 `GameEvent/compilers/` 下 6 个文件的完整机制。

---

## 1. 为什么需要编译

历史上 content 演化出三种写法，但**执行引擎只能理解一种**：`(event) => Promise<void>`。

```ts
// apps/core/noname/library/element/GameEvent/compilers/IContentCompiler.ts:2-14
type GeneralFunction = (...args: any[]) => any;
export type EventContent = GeneralFunction | GeneralFunction[];
export type EventCompileable = EventContent | string;

export type EventCompiledContent = ((e: GameEvent) => Promise<void>) & {
    compiled: true;
    type: string;
    original: EventCompileable;
    originals?: GeneralFunction[];   // array content 的原始函数数组
};
```

**编译的目标**：把任意写法统一成**只接收一个参数 `event`** 的异步函数。

---

## 2. 三种写法

| 写法 | 编译为 | 状态 |
|------|--------|------|
| `async (event, trigger, player) => {...}` | 单元素数组 → ArrayCompiler | ✅ **推荐** |
| `[fn1, fn2, fn3]` | ArrayCompiler | 🚫 待废弃（仍在大量使用） |
| `function() { "step 0"; ... }` | StepCompiler | 🚫 待废弃 |

### 现代写法

```js
event.setContent(async (event, trigger, player) => {
    const result = await player.chooseCard().forResult();
    if (result.bool) {
        // ...
    }
});
```

⚠️ 即使写的是 `async` 函数，**也会被 AsyncCompiler 包装成数组**再交给 ArrayCompiler：

```ts
// apps/core/noname/library/element/GameEvent/compilers/AsyncCompiler.ts:9-19
export default class AsyncCompiler extends ContentCompilerBase {
    type = "async";

    filter(content: EventContent): boolean {
        return typeof content === "function" && content instanceof AsyncFunction;
    }

    compile(content: EventContent) {
        return ContentCompiler.compile([content as AsyncFunction<void>]);
    }
}
```

> 注释原文：`// 因为需要规范content的函数体，所以即使是async也要编译喵！`
>
> **所以所有函数型 content 最终都走 ArrayCompiler。**

### 数组写法

```js
event.setContent([
    async (event, trigger, player) => { /* 步骤 0 */ },
    async (event, trigger, player) => { /* 步骤 1 */ },
]);
```

### step 写法

```js
event.setContent(function () {
    "step 0";
    // ...
    "step 1";
    // ...
});
```

---

## 3. 编译链：责任链模式

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompiler.ts:67-97
compile(content: EventCompileable): EventCompiledContent {
    if (content.compiled) {          // ① 已编译 → 直接返回（幂等）
        return content;
    }

    const target = this.regularize(content);      // ② 预处理

    const cached = this.#compiledContent.get(target);   // ③ 查缓存
    if (cached) {
        return cached;
    }

    for (const compiler of this.#compilers) {     // ④ 责任链
        if (!compiler.filter(target)) {
            continue;
        }
        const compiled = compiler.compile(target) as EventCompiledContent;
        compiled.compiled = true;
        compiled.type = compiler.type;
        compiled.original = content;              // ← 原始值存在这里
        this.#compiledContent.set(target, compiled);   // ⑤ 缓存
        return compiled;
    }

    throw new Error(`不受支持的content: \n ${String(target)}`);
}
```

### ① 幂等

`compiled` 属性标记已编译，重复调用直接返回。

### ② regularize —— 预处理

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

| 输入 | 处理 |
|------|------|
| 字符串 | **查表**：`lib.element.content[name]`，兜底 `lib.element.contents[name]` |
| 可迭代对象 | `Array.from()` 转数组 |
| 其他 | 原样返回 |

⚠️ **`setContent("phase")` 是查表**，等价于 `setContent(lib.element.content.phase)`。

🔬 `lib.element.contents`（复数）在当前源码中**没有任何写入点**，是死代码兜底。实际查表落在 `lib.element.content`。

### ③⑤ 缓存

⚠️ **WeakMap 的 key 是 `regularize` 之后的 `target`，不是原始 content**：

```ts
const cached = this.#compiledContent.get(target);   // ← target
```

原始值保存在编译产物的 `.original` 字段。

### ④ 编译器顺序（关键）

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompiler.ts:100-104
const compiler = new ContentCompiler();

compiler.addCompiler(new ArrayCompiler());
compiler.addCompiler(new AsyncCompiler());
compiler.addCompiler(new StepCompiler());

export default compiler;
```

注册顺序决定**匹配优先级**：`ArrayCompiler` → `AsyncCompiler` → `StepCompiler`

⚠️ **`ArrayCompiler` 排在第一位**，且它的 `filter` 是 `Array.isArray(content) && every(fn)`。因为 AsyncCompiler 会把 async 函数包成数组，所以**函数型 content 的最终执行引擎几乎总是 ArrayCompiler**。

### 各编译器的 filter

```ts
// ArrayCompiler.ts:8-10
filter(content: EventContent): boolean {
    return Array.isArray(content) && content.every(item => typeof item === "function");
}
```

```ts
// AsyncCompiler.ts:12-14
filter(content: EventContent): boolean {
    return typeof content === "function" && content instanceof AsyncFunction;
}
```

```ts
// StepCompiler.ts:14-16
filter(content: EventContent) {
    return typeof content === "function" &&
        ![AsyncFunction, GeneratorFunction, AsyncGeneratorFunction].some(parent => content instanceof parent);
}
```

| 编译器 | 匹配 |
|--------|------|
| ArrayCompiler | 数组且全为函数 |
| AsyncCompiler | `AsyncFunction` 实例 |
| StepCompiler | 函数且**不是** async/generator（即普通同步函数） |

---

## 4. ArrayCompiler —— 实际执行引擎

```ts
// apps/core/noname/library/element/GameEvent/compilers/ArrayCompiler.ts:12-40
compile(content: EventContent) {
    if (!Array.isArray(content)) {
        throw new ReferenceError("content必须是一个数组");
    }

    const compiler = this;
    return async function (this: GameEvent, event: GameEvent) {
        if (!Number.isInteger(event.step)) {
            event.step = 0;                     // ① 初始化 step
        }

        while (!event.finished) {               // ② 循环
            if (event.step >= content.length) { // ③ 越界保护
                event.finish();
                break;
            }
            compiler.beforeExecute(event);      // ④ handler(begin) + updateStep
            event.step++;                       // ⑤ step 自增
            let result: Result | undefined;
            if (!compiler.isPrevented(event)) { // ⑥ 存活检查
                const original = content[event.step];
                result = await Reflect.apply(original, this, [event, event._trigger, event.player, event._result]);
            }
            const nextResult = await event.waitNext();   // ⑦ 跑完子事件
            event._result = result ?? nextResult ?? event._result;  // ⑧ 合并结果
            compiler.afterExecute(event);       // ⑨ handler(end) + updateStep
        }
    };
}
```

### 关键细节（易错）

#### ① 函数接收的四个参数

```ts
result = await Reflect.apply(original, this, [event, event._trigger, event.player, event._result]);
```

| 参数位 | 实际值 |
|--------|--------|
| 1 | `event` |
| 2 | **`event._trigger`**（触发源事件，不是"trigger 上下文对象"） |
| 3 | `event.player` |
| 4 | `event._result`（上一个步骤的结果） |

⚠️ 所以 step/数组写法里 `function(event, trigger, player, result)` 的 `trigger` 实际是 **`event._trigger`** —— 即"触发本事件的源头事件"。

#### ② `_result` 的赋值优先级

```ts
event._result = result ?? nextResult ?? event._result;
```

**三个候选按顺序取第一个非 `null`/`undefined` 的值**：

1. `result` — **本步骤函数的返回值**（优先！）
2. `nextResult` — `waitNext()` 返回的最后子事件结果
3. `event._result` — 保留原值

⚠️ 源码注释（`gameEvent.ts:730`）写的是"最后一个子事件的result"，但**实际实现中步骤函数的返回值优先**。

#### ③ 步骤索引的时序（最易错）

```
beforeExecute(event)
  ├─ callHandler(onXxx, {state:"begin"})
  └─ updateStep()          ← 提交 pending 的 goto
event.step++               ← 读 #step，+1 写入 #nextStep（未提交！）
content[event.step]        ← getter 返回 #step，还是"旧值"
```

🔬 **这里有一个微妙之处**：`event.step++` 会先读 getter 得到 `#step`（旧值），加 1 后通过 setter 写入 `#nextStep`。紧接着 `content[event.step]` 再读 getter，拿到的**仍是未提交的 `#step`**。

由于 `beforeExecute` 中的 `updateStep()` 已经把上一轮的 pending 提交了，且 `step++` 写入的是**下一轮**才提交的值，所以：

- 本轮 `content[event.step]` 读到的 `#step` 是 `beforeExecute` 刚提交的值
- `step++` 写的是 `#nextStep`，将在**本轮末尾** `afterExecute → updateStep()` 提交

因此**每一轮循环执行的都是 `content[#step]`，而 `#step` 在轮内保持不变**。这正是 `goto` 能生效的基础。

#### ④ 越界保护

```ts
if (event.step >= content.length) {
    event.finish();
    break;
}
```

⚠️ 老文档常漏这条。**步骤跑完即自动 finish**。

#### ⑤ isPrevented 为真时跳过执行

```ts
if (!compiler.isPrevented(event)) {
    const original = content[event.step];
    result = await Reflect.apply(...);
}
```

⚠️ 注意：`isPrevented` 为真时**跳过函数调用**，但**仍然执行** `waitNext()` 和 `afterExecute`。

#### ⑥ `this` 绑定

```ts
Reflect.apply(original, this, [...])
```

`this` 是**编译后外层函数的 `this`**（即 `GameEvent` 实例，因为 `loop()` 中调用 `this.content(this)`，而 content 是普通函数，`this` 由调用方式决定）。

---

## 5. step 语法解析（StepCompiler）

### 为什么需要"解析"

step 语法是**伪语法**：`"step 0";` 其实只是一个字符串字面量表达式语句。要让每个 step 独立执行，必须**把函数体按 `"step N"` 切分**，再分别编译成独立函数。

### 解析流程

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:18-25
compile(content: EventContent) {
    if (typeof content != "function") {
        throw new Error("StepCompiler只能接受函数");
    }
    return new StepParser(content).getResult();
}
```

### StepParser 的静态配置

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:31-33
static deconstructs = ["step", "source", "target", "targets", "card", "cards", "skill", "forced", "num", "_result: result"];
static topVars = ["_status", "lib", "game", "ui", "get", "ai"];
static params = ["topVars", "event", "trigger", "player"];
```

这三组定义了注入到每个 step 函数中的变量。

### 构造函数

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:48-55
constructor(func: GeneralFunction) {
    if (typeof func !== "function") {
        throw new TypeError("为确保安全禁止用parsex/parseStep解析非函数");
    }
    this.functionConstructor = security.getIsolatedsFrom(func)[2] as any;
    this.str = this.formatFunction(func);
}
```

🔬 `security.getIsolatedsFrom(func)[2]` 取出该函数所属**运行域（Realm）**的 `Function` 构造器，保证编译出的函数在**同一沙箱域**内运行 —— 这是扩展安全隔离的一部分。

### formatFunction —— 提取源码

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:114-128
formatFunction(func: GeneralFunction) {
    // 沙盒在封装函数时，为了保存源代码会另外存储函数的源代码
    const decompileFunction: (func: GeneralFunction) => string =
        security.isSandboxRequired()
            ? security.importSandbox().Marshal.decompileFunction
            : Function.prototype.call.bind(Function.prototype.toString);

    // 移除所有注释
    const code = decompileFunction(func)
        .replace(/((?:(?:^[ \t]*)?(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/(?:[ \t]*\r?\n(?=[ \t]*(?:\r?\n|\/\*|\/\/)))?|\/\/(?:[^\\]|\\(?:\r?\n)?)*?(?:\r?\n(?=[ \t]*(?:\r?\n|\/\*|\/\/))|(?=\r?\n))))+)|("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:\r?\n|[\s\S])[^/"'\\\s]*)/gm, "$2")
        .trim();

    // 移除两边括号
    return code
        .slice(0, code.lastIndexOf("}"))
        .slice(code.indexOf("{") + 1)
        .trim();
}
```

⚠️ **两条源码获取路径**：
- 沙盒环境：`security.importSandbox().Marshal.decompileFunction`
- 非沙盒：`Function.prototype.toString`

注释移除用了一个复杂正则，**保留字符串字面量**（第二个捕获组）避免误删字符串里的 `//`。

### parseStep —— 切分函数体

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:64-91
parseStep() {
    let skipIndex = 0;
    //去除99个step的限制
    while (true) {
        const result = this.str.slice(skipIndex).match(new RegExp(`\\(?['"]step ${this.step}['"]\\)?;?`));
        if (result == null || result.index == null) {
            this.packStep(this.str);
            break;
        }

        const head = this.str.slice(0, skipIndex + result.index);

        if (this.step === 0) {
            this.stepHead = head.trim();       // ← step 0 之前的内容作为"头部"
        } else {
            try {
                this.packStep(head);
            } catch (e) {
                skipIndex = result.index + result[0].length;
                continue;                       // ← 切分失败则跳过，继续找下一个
            }
        }

        this.str = this.str.slice(head.length + result[0].length);
        skipIndex = 0;
        this.step++;
    }
}
```

要点：

| 要点 | 说明 |
|------|------|
| 正则 | `\(?['"]step N['"]\)?;?` 兼容 `"step 0"`、`'step 0';`、`("step 0")` |
| 头部 | **`step 0` 之前的内容**存入 `stepHead`，会注入到**每个** step | 
| 容错 | `packStep` 抛错时 `skipIndex` 前进继续匹配（处理字符串里出现 "step 1" 的情况） |
| 无 99 限制 | 注释明确说明旧版有 99 个 step 上限，已移除 |

🔬 **`stepHead` 的作用**：允许在第一个 step 之前声明对整个函数可见的变量。

### packStep —— 编译单个步骤

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:93-112
packStep(code: string) {
    const compiled = new this.functionConstructor(
        ...StepParser.params,
        `
        var { ${StepParser.deconstructs.join(", ")} } = event;
        var { ${StepParser.topVars.join(", ")} } = topVars;
        
        ${this.stepHead}
        {
            ${code}
        }
    `
    );
    ErrorManager.setCodeSnippet(compiled, new CodeSnippet(code, 3));
    this.originals.push(compiled);
    this.contents.push(function (event, trigger, player) {
        return compiled.apply(this, [{ _status, ai, game, get, lib, ui }, event, trigger, player]);
    });
}
```

生成的函数形如：

```js
function (topVars, event, trigger, player) {
    var { step, source, target, targets, card, cards, skill, forced, num, _result: result } = event;
    var { _status, lib, game, ui, get, ai } = topVars;

    /* stepHead：step 0 之前的内容 */

    {
        /* 该 step 的代码 */
    }
}
```

🔬 **`_result: result`** 是解构重命名 —— step 代码里用 `result` 访问 `event._result`。

### getResult

```ts
// apps/core/noname/library/element/GameEvent/compilers/StepCompiler.ts:57-62
getResult(): (e: GameEvent) => Promise<void> {
    this.parseStep();
    const result = ContentCompiler.compile(this.contents);
    result.originals = this.originals;
    return result;
}
```

⚠️ **关键**：解析完成后，`this.contents`（函数数组）**再交给 ContentCompiler 编译**，所以最终仍由 **ArrayCompiler** 执行。`originals` 保存原始编译产物供调试。

---

## 6. ContentCompilerBase —— 公共钩子

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompilerBase.ts:21-26
beforeExecute(event: GameEvent) {
    const handlerType = event.getDefaultHandlerType() as `on${Capitalize<string>}`;
    const option: HandlerOption = { state: "begin" };
    event.callHandler(handlerType, event, option);   // ① 调用 onXxx handler
    event.updateStep();                              // ② 提交 pending step
}
```

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompilerBase.ts:74-81
afterExecute(event: GameEvent) {
    event.clearStepCache(null);                      // ① 清步骤缓存

    const handlerType = event.getDefaultHandlerType() as `on${Capitalize<string>}`;
    const option: HandlerOption = { state: "end" };
    event.callHandler(handlerType, event, option);   // ② 调用 onXxx handler
    event.updateStep();                              // ③ 提交 pending step
}
```

⚠️ **两处都调用了 `callHandler`**，这在老文档中常被遗漏。`state` 分别为 `"begin"` / `"end"`。

### isPrevented —— 存活检查

```ts
// apps/core/noname/library/element/GameEvent/compilers/ContentCompilerBase.ts:36-65
isPrevented(event: GameEvent): boolean {
    const { player } = event;

    if (event.name === "phaseLoop") {
        return false;                       // ← 特例：永不阻止
    }
    if (!player) {
        return false;
    }
    if (player.isDead() && !event.forceDie) {
        game.broadcastAll(function () {
            while (_status.dieClose.length) {
                _status.dieClose.shift().close();
            }
        });
        event._oncancel?.();
    } else if (player.isOut() && !event.includeOut) {
        if (event.name == "phase" && player == _status.roundStart && !event.skill) {
            _status.roundSkipped = true;    // ← 条件比想象中严格
        }
    } else if (player.removed) {
        void 0;                            // ← 什么都不做（但仍会 finish）
    } else {
        return false;                       // ← 正常情况，不阻止
    }

    event.finish();
    return true;
}
```

**四条判定**：

| 条件 | 处理 |
|------|------|
| 事件名是 `phaseLoop` | **永远不阻止**（特殊绕过） |
| 无 `player` | 不阻止 |
| `player.isDead() && !forceDie` | 关闭死亡弹窗，调 `_oncancel`，**阻止** |
| `player.isOut() && !includeOut` | 若为 `phase` 且是 `roundStart` 且无 `skill`，设 `roundSkipped`，**阻止** |
| `player.removed` | **阻止**（但无额外动作） |
| 其他 | 不阻止 |

⚠️ **`roundSkipped` 的完整条件**是 `event.name == "phase" && player == _status.roundStart && !event.skill`，三项缺一不可。

---

## 7. goto / redo 的延迟语义

### step 的属性实现

```ts
// apps/core/noname/library/element/gameEvent.ts:726-748
#step: number = 0;
#nextStep: number | null = null;

get step() {
    return this.#step;
}
set step(num) {
    this.#nextStep = num;        // ← 只写 pending
}

updateStep() {
    if (this.#nextStep === null) return;
    this.#step = this.#nextStep; // ← 真正提交
    this.#nextStep = null;
}

goto(step: number) {
    this.step = step;            // → setter → #nextStep
    return this;
}
redo() {
    this.goto(this.step);
    return this;
}
```

### 为什么延迟

因为**本轮循环正在执行 `content[#step]`**，若立即改 `#step` 会导致：
1. 后续 `afterExecute → updateStep()` 的行为难以预测
2. 步骤函数内部的 `event.step` 读取会突然变化

延迟提交保证：**步骤函数执行期间，`event.step` 是稳定的**。

### 提交时机

`updateStep()` 在两处被调用（均在 `ContentCompilerBase`）：

- `beforeExecute` — 提交上一轮 `afterExecute` 后新产生的 pending
- `afterExecute` — 提交本轮产生的 pending

### 实际跳转时序

以 `goto(8)` 为例：

```
轮次 N：正在执行 content[k]
  ├─ beforeExecute → updateStep()（提交历史 pending）
  ├─ step++ → #nextStep = k+1
  ├─ 执行 content[k]  ← 内部调用 goto(8) → #nextStep = 8（覆盖 k+1）
  ├─ waitNext()
  └─ afterExecute → updateStep() → #step = 8

轮次 N+1：
  ├─ beforeExecute → updateStep()（无 pending）
  ├─ step++ → #nextStep = 9
  ├─ 执行 content[#step] = content[8]   ← 跳到 8
  └─ afterExecute → updateStep() → #step = 9
```

⚠️ **注意 `content[event.step]` 的执行**：每轮开头 `step++` 把 `#nextStep` 设为 `#step + 1`，然后执行 `content[#step]`（当前值，未提交的自增）。下一轮开头 `updateStep()` 提交它。所以**每轮执行的是"上一轮末尾提交的值"**，一致且可预测。

---

## 8. 三种写法的等价性

同一个逻辑的三种写法：

```js
// ✅ 现代 async
event.setContent(async (event, trigger, player) => {
    const r = await player.chooseCard().forResult();
    if (r.bool) {
        await player.discard(r.cards);
    }
});

// 🚫 数组
event.setContent([
    async (event, trigger, player) => {
        const r = await player.chooseCard().forResult();
        if (r.bool) {
            await player.discard(r.cards);
        }
    },
]);

// 🚫 step
event.setContent(function () {
    "step 0";
    player.chooseCard().set("prompt", "选择一张牌");
    "step 1";
    if (result.bool) {
        player.discard(result.cards);
    }
});
```

**编译后的执行路径**：

```
async 写法  →  AsyncCompiler.filter 命中  →  包装为 [fn]  →  ArrayCompiler
数组写法    →  ArrayCompiler.filter 命中  →  直接编译
step 写法   →  StepCompiler.filter 命中  →  切分为 [fn0, fn1, ...]  →  ArrayCompiler
```

**三种写法最终都汇聚到 ArrayCompiler。**

---

## 9. 本篇小结

- 编译目标：把三种写法统一成 `(event) => Promise<void>`
- **`ArrayCompiler` 注册在最前，是所有函数型 content 的最终执行引擎**（async 被 AsyncCompiler 包成数组后也走它）
- `regularize` 处理字符串（**查表** `lib.element.content`）与可迭代对象
- 缓存 key 是 **regularize 后的 target**，不是原始 content
- ArrayCompiler 的**四参数实为 `[event, event._trigger, event.player, event._result]`**
- `_result` 赋值优先级：**step 返回值 > waitNext 结果 > 原值**
- **越界保护**：`step >= content.length` 时自动 `finish()`
- `isPrevented` 为真时**跳过函数执行**，但仍走 `waitNext`/`afterExecute`
- step 语法靠**正则切分函数体**实现，`step 0` 之前的内容是注入每个 step 的 `stepHead`
- `goto`/`redo` **延迟生效**，由 `updateStep()` 在 `beforeExecute`/`afterExecute` 中提交
- `isPrevented` 中 `phaseLoop` 永不阻止；`roundSkipped` 需三个条件同时满足

**下一步** → [08-trigger-system.md](08-trigger-system.md)：技能触发系统
