# 11 · 暂停机制与联机同步

> 本篇回答：**游戏如何暂停？联机时事件如何跨客户端同步？为什么联机下有的错误会被吞掉？**
>
> 本篇覆盖 `PauseManager`、`send/wait/resume`、`_modparent` 与联机分支差异。

---

## 1. PauseManager 结构

```ts
// apps/core/noname/game/PauseManager.ts:3-9
export default class PauseManager {
    pause = new Deferred();
    pause2 = new Deferred();
    pause3 = new Deferred();
    over = new Deferred();
    delay = new Deferred();
    #delayList: Promise<void>[] = [];
}
```

**五个独立的暂停闸门**，各自用途不同。

### Deferred —— 可重置的 Promise

```ts
// apps/core/noname/game/PauseManager.ts:42-71
class Deferred {
    #promise: Promise<void> | null;
    #resolver: (() => void) | null;
    get isStarted() {
        return !!this.#promise;
    }
    start() {
        if (this.isStarted) return;
        ({ promise: this.#promise, resolve: this.#resolver } = Promise.withResolvers());
    }
    resolve() {
        if (!this.isStarted) return;
        Promise.resolve()
            .then(() => this.#resolver && this.#resolver())
            .then(() => {
                this.#promise = null;
                this.#resolver = null;
            });
    }
    then(onfulfilled?, onrejected?) {
        if (!this.#promise) {
            return Promise.resolve().then(onfulfilled, onrejected);
        }
        return this.#promise.then(onfulfilled, onrejected);
    }
}
```

**核心特性**：

| 特性 | 说明 |
|------|------|
| `isStarted` | 是否处于"暂停中" |
| `start()` | 建立未决 Promise（幂等） |
| `resolve()` | 释放；**异步**清除内部状态 |
| `then()` | **未暂停时立即 resolve** |

🔬 `resolve()` 用 `Promise.resolve().then(...)` 延迟清除，保证等待方先被唤醒再重置状态。

🔬 `then()` 在未 start 时返回已 resolve 的 Promise，所以**未暂停时 `await` 不会阻塞**。

---

## 2. waitPause —— 唯一的暂停点

```ts
// apps/core/noname/game/PauseManager.ts:28-39
async waitPause() {
    if (_status.paused2 || _status.imchoosing) {
        if (!lib.status.dateDelaying) {
            lib.status.dateDelaying = new Date();
        }
    }
    await Promise.all(
        [this.pause, this.pause2, this.pause3, this.over, this.delay]
            .filter(i => i.isStarted)
    );
    if (lib.status.dateDelaying) {
        lib.status.dateDelayed += lib.getUTC(new Date()) - lib.getUTC(lib.status.dateDelaying);
        delete lib.status.dateDelaying;
    }
}
```

**被调用的唯一位置**是 `waitNext()`：

```ts
// apps/core/noname/library/element/gameEvent.ts:313
await _status.pauseManager.waitPause();
```

> 💡 **含义**：暂停只在"父事件准备处理下一个子事件"时生效。事件内部（content 执行中）不会暂停。

### 统计暂停耗时

```ts
if (_status.paused2 || _status.imchoosing) {
    if (!lib.status.dateDelaying) {
        lib.status.dateDelaying = new Date();
    }
}
// ...
if (lib.status.dateDelaying) {
    lib.status.dateDelayed += lib.getUTC(new Date()) - lib.getUTC(lib.status.dateDelaying);
    delete lib.status.dateDelaying;
}
```

累计"玩家思考/延迟"的时间，用于**排除在游戏时长统计之外**。

### delay 的批量管理

```ts
// apps/core/noname/game/PauseManager.ts:11-26
setDelay(promise: Promise<void>) {
    if (!this.delay.isStarted) {
        this.delay.start();
    }
    const newValue = promise.then(() => {
        if (!this.#delayList.includes(newValue)) {
            return;
        }
        this.#delayList.remove(newValue);
        if (this.#delayList.length === 0) {
            this.delay.resolve();      // ← 全部完成才释放
        }
    });
    this.#delayList.push(newValue);
    return newValue;
}
```

多个延迟任务并行时，**全部完成**才解除 `delay` 闸门。

---

## 3. 五个闸门的用途

| 闸门 | 触发方式 | 用途 |
|------|---------|------|
| `pause` | `_status.paused = true` | 通用暂停（如"暂停游戏"按钮） |
| `pause2` | `_status.paused2 = true` | 玩家操作等待（计入 `dateDelayed`） |
| `pause3` | `_status.paused3 = true` | 第三类暂停 |
| `over` | `_status.over = true` | 游戏结束 |
| `delay` | `pauseManager.setDelay(p)` | 动画/延迟等待（可多个） |

`_status` 上暴露为属性访问器：

```js
// apps/core/noname/status/index.js:113-153
pauseManager = new PauseManager();
get paused() {
    return this.pauseManager.pause.isStarted;
}
set paused(bool) {
    if (bool) {
        this.pauseManager.pause.start();
    } else {
        this.pauseManager.pause.resolve();
    }
}
// paused2 / paused3 / over 同构
```

---

## 4. 联机同步：核心问题

联机时，**事件树只在主机上完整存在**。客机只执行与自己相关的交互。

### send() —— 把事件发给客机

```ts
// apps/core/noname/library/element/gameEvent.ts:994-1017
send() {
    this.player.send(
        function (name, args, set, event, skills) {
            game.me.applySkills(skills);
            const next = game.me[name].apply(game.me, args);
            for (let i = 0; i < set.length; i++) {
                next.set(set[i][0], set[i][1]);
            }
            if (next._backupevent) {
                next.backup(next._backupevent);
            }
            next._modparent = event;      // ← 关键：记录"逻辑父事件"
            game.resume();
        },
        this.name,                        // 方法名
        this._args || [],                 // 方法参数
        this._set,                        // 事件属性
        get.stringifiedResult(this.parent),  // 父事件（序列化）
        get.skillState(this.player)       // 技能状态
    );
    this.player.wait();
    game.pause();
    return this;
}
```

**发送的五样东西**：

| 内容 | 用途 |
|------|------|
| `this.name` | 要调用的方法名 |
| `this._args` | 方法参数 |
| `this._set` | 事件属性（`.set()` 记录） |
| 父事件 | 序列化后的 `parent` |
| 技能状态 | 客机上恢复技能 |

### 客机侧执行

客机收到后：

1. `game.me.applySkills(skills)` — 恢复技能状态
2. `game.me[name].apply(game.me, args)` — **重放同名方法**
3. 逐条 `next.set(k, v)` — 恢复事件属性
4. `next._modparent = event` — 设置"逻辑父事件"
5. `game.resume()` — 解除暂停

> 💡 **这就是 `_args` 的用途**：让客机能够重放主机上发生的方法调用。

### _modparent —— 逻辑父事件

```ts
// apps/core/noname/library/element/gameEvent.ts:166-170
if (game.online && event._modparent) {
    event = event._modparent;
} else {
    event = event.parent;
}
```

联机时 `getParent()` **优先沿 `_modparent` 查找**，因为客机上没有完整的事件树，只能依赖主机传下来的"逻辑父事件"。

⚠️ 这是**联机与单机行为差异的根源之一**：单机沿真实 `parent`，联机沿 `_modparent`。

### sendAsync() —— 可 await 的发送

```ts
// apps/core/noname/library/element/gameEvent.ts:1018-1035
sendAsync() {
    return new Promise(resolve => {
        this.send();
        if (!lib.node?.waitForResult || !this.player.playerid) {
            resolve(null);
            return;
        }
        if (!Array.isArray(lib.node.waitForResult[this.player.playerid])) {
            lib.node.waitForResult[this.player.playerid] = [resolve];
        } else {
            lib.node.waitForResult[this.player.playerid].push(resolve);
        }
    });
}
```

用于需要在客机执行后**继续**的场景。客机的返回结果通过 `lib.node.waitForResult` 回调。

---

## 5. 联机下的行为差异

### ① 不同步时机流程

```ts
// apps/core/noname/library/element/gameEvent.ts:31-33
if (trigger && !game.online) {
    this._triggered = 0;
}
```

⚠️ **联机时 `_triggered` 恒为 `null`**，事件不走 `Before`/`Begin`/`End`/`After` 时机流程（客机上只执行交互）。

### ② getParent 走 _modparent

见上文。

### ③ 错误被吞掉

```ts
// apps/core/noname/library/element/gameEvent.ts:267-275
let next = this.content(this).catch(error => {
    if (lib.config.ignore_error || (_status.connectMode && !lib.config.debug)) {
        game.print("游戏出错：" + this.name);
        game.print(error.toString());
        console.error(error);      // ← 只打印，不抛出
    } else {
        throw error;               // ← 单机开发模式：抛出
    }
});
```

| 情形 | 行为 |
|------|------|
| 单机 + 默认配置 | **抛出**，便于定位 |
| `lib.config.ignore_error` | 吞掉，只打印 |
| 联机 + 非 debug | **吞掉**，只打印 |

> ⚠️ 这是"联机时技能静默失效但不报错"的根本原因。排查联机问题时，看控制台 `console.error`。

### ④ 部分事件不触发时机

```ts
// apps/core/noname/library/element/gameEvent.ts:463-465
if (_status.video) {
    return;
}
```

录像播放时所有时机不触发 —— 保证确定性重放。

### ⑤ 起始玩家查找

```ts
// apps/core/noname/library/element/gameEvent.ts:497-503
let start = [_status.currentPhase, event.source, event.player, game.me, game.players[0]]
    .find(i => get.itemtype(i) == "player");
if (!start) return;
if (!game.players.includes(start) && !game.dead.includes(start)) {
    start = game.findNext(start);
}
```

联机时 `game.me` 的优先级可能影响收集起点。

---

## 6. 可重放的随机数

```ts
// apps/core/noname/library/element/gameEvent.ts:1037-1051
getRand(name?: string) {
    if (name) {
        if (!this._rand_map) {
            this._rand_map = {};
        }
        if (!this._rand_map[name]) {
            this._rand_map[name] = Math.random();
        }
        return this._rand_map[name];
    }
    if (!this._rand) {
        this._rand = Math.random();
    }
    return this._rand;
}
```

**每个事件缓存自己的随机数**，重复调用返回同一值。

| 调用 | 行为 |
|------|------|
| `getRand()` | 事件级缓存，多次调用同一值 |
| `getRand("key")` | **命名**缓存，不同 key 不同值 |

用途：

1. **录像重放**：随机数固定在事件上，重放结果一致
2. **联机一致**：主机生成后同步给客机
3. **避免同一事件多次随机**导致的不一致

---

## 7. 判断本地/联机上下文

```ts
// apps/core/noname/library/element/gameEvent.ts:1052-1057
isMine() {
    return this.player?.isMine();
}
isOnline() {
    return this.player?.isOnline();
}
```

技能中常用于：

```js
content: async (event, trigger, player) => {
    if (event.isMine()) {
        // 这是本机玩家的操作，可以弹 UI
    }
    if (event.isOnline()) {
        // 联机环境
    }
}
```

⚠️ **`isMine()` 是判断"是否需要本机弹 UI"的标准方式**。在联机中，非本机玩家的事件不应弹窗。

---

## 8. 调试联机问题

| 现象 | 排查 |
|------|------|
| 客机上技能没反应 | 检查 `_modparent` 链；客机不走时机流程，只做交互 |
| 主机报错但客机正常 | 错误被 `catch` 吞掉（联机非 debug） |
| 客机卡住不继续 | `waitPause` 未释放；检查五个闸门状态 |
| 随机结果不一致 | 是否用了 `Math.random()` 而非 `event.getRand()` |
| 录像重放结果不同 | 同上 |
| 弹窗出现在错误的客户端 | 检查 `event.isMine()` 判断 |

### 常用调试手段

```js
// 查看暂停状态
_status.paused      // pause 闸门
_status.paused2     // pause2 闸门
_status.over        // over 闸门

// 查看当前事件
_status.event
_status.eventManager.eventStack
```

---

## 9. 本篇小结

- `PauseManager` 有**五个闸门**：`pause`/`pause2`/`pause3`/`over`/`delay`
- `waitPause()` 的**唯一调用点**是 `waitNext()`，所以暂停只在"准备处理下一个子事件"时生效
- `Deferred.then()` 在未暂停时**立即 resolve**
- `delay` 用 `#delayList` 管理多个并行延迟任务，**全部完成**才释放
- `send()` 发送 **方法名 + `_args` + `_set` + 父事件 + 技能状态**，客机用 `apply` 重放
- **`_args` 是联机重放的核心载体**
- 联机时 `getParent` 走 **`_modparent`**，且 `_triggered` 恒为 `null`（不走时机流程）
- **联机非 debug 或 `ignore_error` 时，content 错误被吞掉**
- `getRand()` 提供**事件级可重放随机数**，是录像与联机一致性的基础
- `isMine()` 用于判断是否该在本机弹 UI

**下一步** → [12-interruption.md](12-interruption.md)：事件中断机制详解
