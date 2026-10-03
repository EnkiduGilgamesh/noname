# 09 · 技能执行完整链路

> 本篇回答：**一个技能从"被时机命中"到"产生效果"，中间经过了什么？**
>
> 本篇是 [08](08-trigger-system.md) 的实操展开，加入真实的技能定义与执行追踪。

---

## 1. 技能定义的完整字段

```js
lib.skill.技能ID = {
    // ── 注册 ──
    trigger: { player: "phaseDrawBegin" },

    // ── 排序 ──
    priority: 0,
    firstDo: false,
    lastDo: false,

    // ── 发动方式 ──
    forced: false,
    direct: false,
    silent: false,

    // ── 多次触发 ──
    getIndex(event, player, triggername) { return 1; },

    // ── 是否发动 ──
    cost: async (event, trigger, player) => {},
    check: (trigger, player, triggername, indexedData) => true,

    // ── 效果 ──
    content: async (event, trigger, player) => {},

    // ── 提示 ──
    prompt: "",
    prompt2: "",
    popup: true,
    logTarget: null,
    line: null,
    logLine: true,

    // ── 生命周期 ──
    oncancel: (trigger, player) => {},

    // ── 特殊 ──
    forceDie: false,
    forceOut: false,
    usable: undefined,
    frequent: false,
};
```

---

## 2. 完整执行时序

以"摸牌阶段开始时摸两张牌"为例：

```
① 事件触发时机
   phaseDraw 事件的 loop()：
     await this.trigger("phaseDrawBegin")
        │
        ▼
② GameEvent.trigger("phaseDrawBegin")            gameEvent.ts:462
   ├─ _status.video? → 否
   ├─ 前置检查通过
   ├─ lib.hookmap["phaseDrawBegin"] 存在？→ 是
   ├─ start = _status.currentPhase（回合主角）
   ├─ 按座次遍历，收集每个玩家注册的技能
   │    · lib.hook["1_player_phaseDrawBegin"] → ["example"]
   │    · 排序：priority 降序
   ├─ allbool = true
   └─ 创建 arrangeTrigger 事件
        next.doingList = [firstDo, doing_玩家1, doing_玩家2, ..., lastDo]
        next._trigger = phaseDraw 事件
        next.triggername = "phaseDrawBegin"
        next.playerMap = 座次排序后的玩家列表
        → push 到 phaseDraw.next
        │
        ▼
③ phaseDraw.waitNext() 取出 arrangeTrigger 并 await
        │
        ▼
④ arrangeTrigger content                       content.ts:3947
   取 doingList 中第一个（跳过 firstDo/lastDo）
   while (true):
     ├─ filterTrigger 过滤 → usableSkills = [example]
     ├─ 优先级剪枝 → todoList 只留最高优先级
     ├─ 只有一个 → event.current = example
     ├─ doneList.push(event.current)
     ├─ todoList.remove(event.current)
     └─ game.createTrigger("phaseDrawBegin", "example", 玩家1, phaseDraw事件, undefined)
          │  game/index.js:5988
          ├─ info 存在？是
          ├─ 玩家出局/死亡？否
          ├─ createEvent("trigger", false)
          ├─ next.skill = "example"
          ├─ next.forceDie = true      ← 关键
          ├─ next.includeOut = true    ← 关键
          ├─ next._trigger = phaseDraw事件
          └─ setContent("createTrigger")
          → await .forResult()
        │
        ▼
⑤ createTrigger content                        content.ts:4009
   ├─ ① 技能归属校验：玩家确实拥有 example？→ 是
   ├─ ② 决定发动方式
   │    forced? 否
   │    direct? 否
   │    typeof cost === "function"? —— 看技能定义
   │
   │    若有 cost：创建 "example_cost" 事件 → await
   │    若无 cost：player.chooseBool(提示) → await
   │      · AI 用 check() 判断
   │      · 玩家点击确定/取消
   │
   ├─ ③ 结果为 false？
   │    → info.oncancel?.()
   │    → return（技能不发动）
   │
   ├─ ④ 播报：player.logSkill(popup_info, targets, line, ...)
   ├─ ⑤ 统计：player.getStat("triggerSkill")[skill]++
   └─ ⑥ 创建效果事件
        const next = game.createEvent("example")   ← 事件名 = 技能名
        next.player = 玩家1
        next._trigger = phaseDraw事件
        next.triggername = "phaseDrawBegin"
        next.setContent(info.content)
        → push 到当前事件 next
        │
        ▼
⑥ 效果事件执行 → info.content(event, trigger, player)
   ├─ 此时 event._trigger 是 phaseDraw 事件
   ├─ 可读取 trigger.xxx 获取触发时的上下文
   └─ 创建新事件（如 draw）→ 递归回 ①
```

---

## 3. cost 与 content 的区别

| | `cost` | `content` |
|--|--------|-----------|
| 作用 | **能否发动**（代价、条件、选择目标） | **发动后的效果** |
| 返回值 | `result.bool` 决定是否继续 | 无要求 |
| 何时执行 | 询问阶段 | 确认发动后 |
| 事件名 | `${skill}_cost` | `${skill}` |
| 典型内容 | 弃牌、选择目标、判断条件 | 造成伤害、摸牌 |

### cost 中设置目标

cost 中选定的目标会通过 `result.targets` 传给 content：

```ts
// apps/core/noname/library/element/content.ts:4188-4200
let targets = null;
if (result.targets && result.targets.length > 0) {
    targets = result.targets.slice(0);
} else if (info.logTarget) {
    if (typeof info.logTarget === "string") {
        targets = trigger[info.logTarget];
    } else if (typeof info.logTarget === "function") {
        targets = info.logTarget(trigger, player, event.triggername, event.indexedData);
    }
}
if (get.itemtype(targets) === "player") {
    targets = [targets];
}
```

然后传给效果事件：

```ts
// apps/core/noname/library/element/content.ts:4225-4226
if (get.itemtype(targets) == "players") {
    next.targets = targets.slice(0);
}
```

> 💡 所以 content 里可以读 `event.targets` 拿到 cost 阶段选的目标。

### 无 cost 时的自动询问

若技能没有 `cost` 且非 `forced`，会自动 `chooseBool`：

```ts
// apps/core/noname/library/element/content.ts:4131-4137
const next = player.chooseBool(str);
if (event.frequentSkill) next.set("frequentSkill", event.skill);
next.set("forceDie", true);
next.set("includeOut", true);
next.ai = () => !check || check(trigger, player, event.triggername, event.indexedData);
```

⚠️ **AI 是否发动由 `check` 决定**（`next.ai`）。若技能没定义 `check`，AI 默认**发动**（`!check` 为真）。

---

## 4. 三种发动路径对比

### 路径 A：forced / revealed —— 强制发动

```ts
// apps/core/noname/library/element/content.ts:4055-4056
if (event.revealed || info.forced) {
    result = { bool: true };
}
```

不询问，不播报（`popup` 判定中有 `!info.direct`，但 forced 仍会播报）。

### 路径 B：direct —— 直接发动

```ts
// apps/core/noname/library/element/content.ts:4074-4079
if (info.direct) {
    if (player.isUnderControl()) {
        game.swapPlayerAuto(player);
    }
    result = { bool: true };
    event._direct = true;
}
```

⚠️ `direct` 会设置 `event._direct = true`，且**不播报**（因为 `!info.direct` 为假）。

### 路径 C：cost / chooseBool —— 需要确认

见上文。这是最常见的路径。

### 常见组合

| 场景 | 推荐配置 |
|------|---------|
| 锁定技 | `forced: true` |
| 被动提示技（询问是否发动） | 无 `cost`，有 `check` |
| 主动技（代价在 cost 中处理） | 有 `cost` |
| 内部辅助技（不该弹窗） | `silent: true` 或 `direct: true` |

---

## 5. 静默技能与内部技能

`arrangeTrigger` 中有一条优先规则：

```ts
// apps/core/noname/library/element/content.ts:3967-3972
const silentSkill = event.choice.find(item => {
    const skillInfo = lib.skill[item.skill];
    return skillInfo && (skillInfo.silent || !lib.translate[item.skill]);
});
if (silentSkill) {
    event.current = silentSkill;
}
```

**`silent: true` 或没有翻译文本的技能，在同优先级竞争中自动优先。**

用途：内部辅助技能（如"某个效果的实际执行者"）不应与玩家可见技能竞争，也不应弹窗。

---

## 6. 一次时机多次触发：getIndex

```ts
// apps/core/typings/Skill.d.ts:1485
getIndex?(event: GameEvent, player: Player, triggername: string): number | Iterable<any>;
```

### 返回数字

```js
getIndex(event, player, triggername) {
    return 3;      // 入队 3 个条目，可触发 3 次
}
```

在 `addList` 中展开：

```ts
// apps/core/noname/library/element/gameEvent.ts:542-552
if (typeof info.getIndex === "function") {
    const indexedResult = info.getIndex<any>(event, player, name);
    if (typeof indexedResult === "number") {
        for (let i = 0; i < indexedResult; i++) {
            list.push({ skill, player: this.player, priority, indexedData: true });
        }
    }
    // ...
}
```

### 返回可迭代对象

```js
getIndex(event, player, triggername) {
    return event.cards.map(card => ({ card }));   // 每张牌一个条目
}
```

### indexedData 的作用

1. **跳过去重**：`addTrigger` 中 `if (!toadd.indexedData) { /* 去重检查 */ }`
2. **传给 cost/content**：通过 `event.indexedData` 可用
3. **取消联动**：`event.result = "cancelled"` 时取消同技能后续条目

```ts
// apps/core/noname/library/element/content.ts:3998-4004
if (get.itemtype(event.doing.player) === "player" && result === "cancelled") {
    for (let i = 0; i < event.doing.todoList.length; i++) {
        if (event.current.skill === event.doing.todoList[i].skill) {
            event.doing.doneList.push(event.doing.todoList.splice(i--, 1)[0]);
        }
    }
}
```

---

## 7. 技能触发其他技能

技能 content 中创建事件，会再次触发时机：

```js
content: async (event, trigger, player) => {
    // 造成伤害 → 会触发 damageBefore/damageBegin/damageEnd/damageAfter
    await player.damage(1);
}
```

这构成递归：

```
技能A content → damage 事件 → trigger("damageBegin") → 技能B → ...
```

⚠️ **注意无限递归风险**：技能 A 触发某事，该事又触发技能 A。通常靠：
- `cost` 中的条件判断
- `player.hasSkillTag` 检查
- 事件属性标记（如 `event._fromSkillA = true`）

---

## 8. 与青囊类"主动技"的区别

上面的都是**触发技**（`trigger`）。还有**主动技**（在出牌阶段主动使用）：

```js
lib.skill.qingnang = {
    // 无 trigger！
    enable: "phaseUse",
    filterCard: ...,
    selectCard: 1,
    filterTarget: ...,
    content: async (event, trigger, player) => { /* ... */ },
};
```

这类技能通过 `enable` 注册到 **`player.chooseToUse` 的候选列表**，而非 `hookmap`。

| | 触发技 | 主动技 |
|--|--------|--------|
| 注册 | `trigger` → `lib.hookmap` | `enable` → 出牌阶段候选 |
| 发动 | 时机自动回调 | 玩家主动选择使用 |
| 入口 | `createTrigger` | `chooseToUse` |

⚠️ 本文档聚焦**事件系统**，主动技涉及 `chooseToUse` 的另一套机制（见 `docs/game-event/chooseToUse.md`）。

---

## 9. 调试技巧

### 追踪技能是否进队列

在 `arrangeTrigger` 的 `doing.todoList` 上打点，或观察事件树中是否出现 `arrangeTrigger` / `trigger` 事件。

### 追踪技能是否发动

技能效果事件的**名字就是技能名**：

```ts
// apps/core/noname/library/element/content.ts:4211
const next = game.createEvent(event.skill);
```

所以在事件历史里看到 `example` 事件，说明技能确实发动了。

### 常见"技能没效果"的原因

| 原因 | 排查 |
|------|------|
| 技能归属校验失败 | 检查 `hiddenSkills`/`invisibleSkills`/`additionalSkills` |
| `cost` 返回 false | 看 cost 内部条件 |
| `chooseBool` 返回 false | 检查 `check` 函数 |
| content 抛错被吞 | 看 `console.error`（联机或 `ignore_error` 时） |
| 时机没注册 | 检查 `lib.hookmap` 是否有该时机 |

---

## 10. 本篇小结

- 技能定义的关键字段：`trigger`（注册）、`priority`/`firstDo`/`lastDo`（排序）、`forced`/`direct`/`silent`（发动方式）、`cost`/`check`（是否发动）、`content`（效果）
- **cost 中选的目标通过 `result.targets` 传给 content，content 里读 `event.targets`**
- 三条发动路径：`forced/revealed` → `direct` → `cost`/`chooseBool`
- 无 `cost` 时自动 `chooseBool`，**AI 由 `check` 决定，未定义则默认发动**
- `silent` 或无翻译的技能在同优先级竞争中**自动优先**
- `getIndex` 实现一次时机多次触发，`indexedData` 跳过去重
- 技能效果事件**以技能名为事件名**，便于追踪
- 技能可触发技能，注意无限递归

**下一步** → [10-results-and-promises.md](10-results-and-promises.md)：结果与 Promise 语义
