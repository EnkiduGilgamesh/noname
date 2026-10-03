# 12 · 事件中断机制

> 本篇回答：**`finish`/`cancel`/`untrigger`/`neutralize` 有何区别？该用哪个？**
>
> 这四个 API 极易混淆，误用会导致技能行为诡异。

---

## 1. 四种中断方式对比

| 方法 | 位置 | 核心动作 | 触发时机 | 可逆 |
|------|------|---------|---------|------|
| `finish()` | `gameEvent.ts:673` | `finished = true` | 无 | 否 |
| `cancel(all, player, notrigger)` | `:677` | `untrigger` + 记录 skipped + `XXXCancelled` | `XXXCancelled` | 否 |
| `untrigger(all, player)` | `:650` | `_triggered = 5` | 无 | 否 |
| `neutralize(event)` | `:692` | 标记失效 + `eventNeutralized` | `eventNeutralized` | **是**（`unneutralize`） |

---

## 2. finish() —— 最轻量

```ts
// apps/core/noname/library/element/gameEvent.ts:671-675
#inContent = false;
finished = false;
finish() {
    this.finished = true;
}
```

⚠️ **只设标志位，不立即终止执行。**

实际终止发生在三处：

1. `GameEvent.loop()` 下一轮迭代
```ts
while (true) {
    await this.waitNext();
    if (!this.finished) { /* 继续 */ }
    else { /* 收尾 */ }
}
```

2. `ArrayCompiler` 循环条件
```ts
while (!event.finished) { ... }
```

3. `isPrevented()` 检查

### `#inContent && finished` 的连锁效果

```ts
// apps/core/noname/library/element/gameEvent.ts:188-190
if (event.#inContent && event.finished) {
    childEvent.resolve();
}
```

**content 执行期间若已 finish，之后创建的子事件立即"已解决"**（不会真正执行）。

> 💡 这是"调用 `finish()` 后，后续代码里创建的事件都不生效"的原因。

### 适用场景

- content 内部提前结束（如"不需要弃牌则直接结束"）
- `isPrevented` 判定后终止

---

## 3. cancel() —— 带播报的取消

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

### 三步

1. `untrigger(all, player)` — 置 `_triggered = 5` 并终止 `_triggering`
2. 若非 `notrigger`：
   - 若是阶段事件，记入 `skipped` 历史
   - 置 `_cancelled = true`
   - 触发 `XXXCancelled`
3. `finish()`

### 参数

| 参数 | 说明 |
|------|------|
| `all` | 传给 `untrigger`；`true` 表示全部终止 |
| `player` | 传给 `untrigger`；`all=false` 时指定玩家 |
| `notrigger` | **真值时跳过 `XXXCancelled` 播报** |

⚠️ `notrigger` 的典型用法（`waitNext` 中自我抢占）：

```ts
// apps/core/noname/library/element/gameEvent.ts:318
this.cancel(true, null, "notrigger");
```

### 适用场景

- 翻面跳过回合：`event.cancel()`
- 技能或卡牌效果被取消

---

## 4. untrigger() —— 终止时机流程

```ts
// apps/core/noname/library/element/gameEvent.ts:650-662
untrigger(all = true, player?: Player) {
    if (all) {
        if (all !== "currentOnly") {
            this._triggered = 5;
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

### 两种模式

| 调用 | 效果 |
|------|------|
| `untrigger()` / `untrigger(true)` | `_triggered = 5`（终止态）+ finish 当前 `arrangeTrigger` |
| `untrigger("currentOnly")` | **不设** `_triggered`，只 finish `_triggering` |
| `untrigger(false, player)` | 把玩家加入 `_notrigger` |

🔬 **`"currentOnly"` 的用途**：只终止当前正在执行的技能触发，但**保留事件的后续时机**。

### _triggered = 5 的效果

`loop()` 的收尾分支：

```ts
if (this._triggered === 1) { await trigger("Omitted", 4); }
else if (this._triggered === 2) { await trigger("End", 3); }
else if (this._triggered === 3) { await trigger("After", 4); }
else if (this.after.length) { this.next.push(this.after.shift()!); }
else { return; }
```

值为 `5` 时**所有分支都不命中**，直接走 `after` 处理或返回结束。

---

## 5. neutralize() —— 唯一的可逆中断

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

### 机制

1. 幂等：已失效则直接返回
2. 置 `_neutralized = true`，记录失效事件
3. 触发 `eventNeutralized` 时机（其他技能可响应）
4. **给 arrangeTrigger 设 `filterStop`**：若期间被 `unneutralize`，则停止后续技能
5. 等待时机完成
6. **若仍处于失效状态**，才真正 `untrigger` + `finish`

> 💡 第 4~6 步的设计：给其他技能一个"**撤销失效**"的机会窗口。若在 `eventNeutralized` 期间调用 `unneutralize()`，则事件恢复正常。

### unneutralize —— 撤销

```ts
// apps/core/noname/library/element/gameEvent.ts:714-722
unneutralize() {
    if (!this._neutralized) {
        return;
    }
    this._neutralized = false;
    if (this.type == "card" && this.card && this.name == "sha") {
        this.directHit = true;
    }
}
```

⚠️ 特殊的【杀】处理：撤销失效的【杀】会设置 `directHit = true`（不可闪避）。

### filterStop 的配合

```ts
if (next) {
    next.filterStop = function () {
        if (!this._neutralized) {     // ← 已被撤销
            delete this.filterStop;
            return true;               // 停止后续技能
        }
        return false;
    };
}
```

在 `arrangeTrigger` 中：

```ts
// apps/core/noname/library/element/content.ts:3953-3955
if (trigger.filterStop && trigger.filterStop()) {
    return;
}
```

### 适用场景

- "取消此牌效果"类技能
- "无效化"类技能（如某些防御技）

---

## 6. 该用哪个：决策树

```
需要终止事件吗？
├─ 只是内部提前结束，无需播报
│    → finish()
│
├─ 需要触发 "XXXCancelled" 让其他技能响应
│    → cancel()
│
├─ 只需要终止当前正在触发的技能，保留后续时机
│    → untrigger("currentOnly")
│
├─ 要无效化事件效果，且允许其他技能撤销
│    → neutralize()
│
└─ 要终止所有时机流程
     → untrigger()
```

---

## 7. 实战：翻面跳过回合

`phase` 事件中的实现：

```ts
// apps/core/noname/library/element/content.ts:4678-4695
async (event, trigger, player) => {
    //规则集中的“回合开始后⑤”，进行翻面检测
    if (player.isTurnedOver() && !event._noTurnOver) {
        const next = player.turnOver();
        player.phaseSkipped = true;
        const players = game.players.slice(0).concat(game.dead);
        for (const current of players) {
            current.getHistory().isSkipped = true;
            current.getStat().isSkipped = true;
        }
        event.cancel();                      // ← 取消回合
        return next.forResult();
    } else {
        player.phaseSkipped = false;
        player.getHistory().isMe = true;
        player.getStat().isMe = true;
    }
},
```

要点：
- 用 `cancel()` 而非 `finish()` —— 需要记录 `skipped` 历史并触发 `phaseCancelled`
- 先设置各种历史/统计标志，再 `cancel()`
- `return next.forResult()` 等待 `turnOver` 事件完成

---

## 8. 实战：跳过阶段

```ts
// apps/core/noname/library/element/content.ts:4795-4797
if (phase[0].startsWith("skip")) {
    event.currentPhase = `phase${phase[0].slice(4)}`;
    skip = true;
}
```

配合：

```ts
// apps/core/noname/library/element/content.ts:4806-4812
if (skip) {
    next.isSkipped = true;
    if (phase.length > 1) {
        next._skipPhaseReason = phase[1];
    }
    game.log(player, "跳过了", event.currentPhase);
}
```

阶段事件的 `isSkipped = true` 会在 `checkSkipped()` 中被拦截：

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
    await this.trigger(this.name + "Skipped");     // ← 触发 XXXSkipped
    return true;
}
```

> 💡 **跳过的正确姿势**是设 `isSkipped`，让 `checkSkipped` 统一处理（会正确记录历史并触发 `XXXSkipped`）。

---

## 9. `_notrigger` —— 阻止特定玩家触发

```ts
// apps/core/noname/library/element/gameEvent.ts:663-664
notrigger: boolean;
_notrigger: Player[] = [];
```

通过 `untrigger(false, player)` 添加。

⚠️ 在当前源码中 `_notrigger` 的**消费点不明显** —— 它被记录但未见读取位置的明确逻辑。使用时需谨慎验证。

---

## 10. 中断与 arrangeTrigger 的交互

`arrangeTrigger` 会在每个技能前检查 `filterStop`：

```ts
// apps/core/noname/library/element/content.ts:3952-3955
while (true) {
    if (trigger.filterStop && trigger.filterStop()) {
        return;
    }
    // ...
}
```

**`trigger` 是被触发的原事件**（如 `phase`），而 `filterStop` 通常由 `neutralize` 设置。

所以链路是：

```
event.neutralize()
  → 给 arrangeTrigger 设 filterStop
  → arrangeTrigger 下次循环检查 filterStop
  → 返回 true 则停止执行后续技能
```

---

## 11. 本篇小结

- **`finish()`** 只设标志，不立即终止；`#inContent && finished` 时新子事件立即 resolve
- **`cancel()`** = `untrigger` + 记录 skipped + `XXXCancelled` + finish；`notrigger` 参数可跳过播报
- **`untrigger()`** 置 `_triggered = 5` 跳过剩余时机；`"currentOnly"` 只终止当前技能触发
- **`neutralize()`** 是唯一**可逆**的中断，触发 `eventNeutralized` 给其他技能撤销机会
- `unneutralize()` 撤销失效；对【杀】会设 `directHit = true`
- 跳过阶段的正确方式是设 `isSkipped`，让 `checkSkipped()` 统一处理
- `arrangeTrigger` 通过 `filterStop` 与 `neutralize` 配合

**下一步** → [13-extending.md](13-extending.md)：扩展与技能开发指南
