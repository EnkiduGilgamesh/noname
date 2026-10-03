# 附录 C · 易错点与调试技巧

> 踩坑清单与排查手册。按"症状 → 原因 → 解法"组织。

---

## C.1 源码阅读陷阱

### 陷阱 1：以为被注释的代码 = 功能已废弃 ⚠️ 最重要

```ts
// apps/core/noname/library/element/gameEvent.ts:230-244
this.#start = (async () => {
    if (this.parent) {
        this.parent.childEvents.push(this);
    }
    game.getGlobalHistory("everything").push(this);
    // if (this.manager.eventStack.length === 0) {     ← 已注释
    // 	this.manager.rootEvent = this;                ← 已注释
    // }
    // this.manager.eventStack.push(this);             ← 已注释
    this.manager.setStatusEvent(this, true);           ← 现行写法
    await this.loop().then(() => {
        // this.manager.eventStack.pop();              ← 已注释
        this.manager.popStatusEvent();                 ← 现行写法
    });
})();
```

**误判**：以为事件栈机制被废弃。
**真相**：这是**等价重构** —— 入栈逻辑搬进了 `setStatusEvent` 内部，且 `internal = true` 时确实会 push（`GameEventManager.ts:28-34`）。

### 陷阱 2：以为 `forced` 覆盖逻辑生效

```ts
// apps/core/noname/library/element/gameEvent.ts:855, 884
//if(info.forced!=undefined) this.forced=info.forced;   ← 已注释
//this.forced=info.forced;                              ← 已注释
```

`backup()` 保存了 `forced`，`restore()` 也会恢复它，但**从技能信息覆盖 `forced` 的逻辑已注释**。

### 陷阱 3：以为 `send()` 的 `_args` 由 `createEvent` 写入

`game/index.js` 的 `createEvent`（`6016-6025`）**不写** `_args`。写入点在 `player.js` 的各交互方法等 40+ 处。

---

## C.2 常见误解速查

| ❌ 误解 | ✅ 实际 |
|--------|--------|
| `game.loop()` 是主循环 | 只是 `event.start()`；主循环是 `phaseLoop` |
| `GameEvent.loop()` 是主循环 | 是**单事件状态机** |
| `next` 是树结构 | `next` 是**串行队列** |
| `getParent()` 找不到返回 `undefined` | 默认返回**空对象 `{}`**（需 `forced=true`） |
| `await event` 会启动事件 | **有 parent 时不启动**，只等父事件跑到它 |
| `await event` 能拿结果 | 返回 `undefined`，需 `.forResult()` |
| `finish()` 立即终止 | 只设标志，下轮迭代才生效 |
| `popStatusEvent()` 总发公告 | **有条件**发布 |
| `setContent("foo")` 把字符串当 content | 是**查表**取 `lib.element.content.foo` |
| `cost_data` 是 `result.cost_data` 别名 | 独立字段，**无自动同步** |
| content 的 `trigger` 参数是框架上下文对象 | 是 **`event._trigger`** |
| `_result` 是最后子事件的结果 | **步骤函数返回值优先** |
| `clearStepCache(key)` 只删指定 key | **无条件整表清空** |
| 编译器按 async→array→step 匹配 | 注册顺序是 **Array → Async → Step** |
| 数组/step 写法的第 4 参数是 `event._result` | 正确，但**第 2 是 `_trigger`** |
| `tempSkills` 每回合过期 | 在**触发时机时**检查过期 |
| 事件错误总会被抛出 | 联机非 debug 或 `ignore_error` 时**被吞** |

---

## C.3 事件不执行

### 症状：事件创建了但没跑

| 原因 | 排查 |
|------|------|
| 没被 push 到任何 `next` | 检查 `game.createEvent` 的父事件是否正确 |
| 父事件已 `finished` 且 `#inContent` | `childEvent.resolve()` 会让它跳过（`gameEvent.ts:188-190`） |
| 父事件的 `next` 没人消费 | 父事件是否在 `loop()` 中 `waitNext()` |
| `manager.tempEvent` 被其他事件占用 | `waitNext` 会 `cancel` 自己（`gameEvent.ts:314-321`） |

### 症状：`await event` 永久挂起

**原因**：`then()` 在有 `parent` 时只 `await parent.waitNext()`，若父事件不会跑到该事件，就永远等待。

**排查**：
```js
console.log(event.parent?.name);        // 父事件是什么
console.log(event.parent?.finished);    // 父事件是否已结束
console.log(event.parent?.next.indexOf(event));  // 它在队列里吗
```

---

## C.4 技能不触发

### 排查顺序

```
① lib.hookmap[时机名] 是否为 true
   → 否：技能没注册成功
       · 检查 trigger 字段拼写
       · 检查技能是否真的被玩家拥有
   → 是：继续

② trigger 的角色配置是否匹配
   player / source / target / global

③ 起始玩家是否正确
   [_status.currentPhase, event.source, event.player, game.me, game.players[0]]

④ 技能归属校验是否通过（content.ts:4012-4044）
   · hiddenSkills：明置条件是否满足
   · invisibleSkills：是否可见
   · additionalSkills：是否在列表中

⑤ filterTrigger 是否过滤掉

⑥ cost / chooseBool 是否返回 false
```

### 常用调试代码

```js
// 时机是否注册
lib.hookmap["phaseDrawBegin"]

// 谁注册了
lib.hook["1_player_phaseDrawBegin"]
lib.hook.globalskill["player_phaseDrawBegin"]

// 玩家拥有哪些技能
player.getSkills()
player.hiddenSkills
player.invisibleSkills
player.additionalSkills
player.tempSkills
```

---

## C.5 技能发动了但没效果

| 原因 | 排查 |
|------|------|
| content 抛错被吞 | 看 `console.error`（联机非 debug） |
| 没 `await` 异步操作 | 检查 `await player.draw()` 等 |
| `event.targets` 为空 | cost 是否正确设置了目标 |
| 技能被 `neutralize` | 检查 `_neutralized` |
| 事件被 `untrigger` | 检查 `_triggered === 5` |

### 确认技能是否真的发动

技能效果事件**以技能名为事件名**：

```ts
// apps/core/noname/library/element/content.ts:4211
const next = game.createEvent(event.skill);
```

在事件历史里看到 `exampleSkill` 事件 = 技能确实发动了。

---

## C.6 顺序问题

### 症状：技能触发顺序不符合预期

**优先级链**：

```
1. firstDo（跨玩家，按座次）
2. 各玩家自己的 todoList（priority 降序，同 priority 按座次）
3. lastDo（跨玩家，按座次）
```

排序代码：

```ts
// apps/core/noname/library/element/gameEvent.ts:424-426
if (typeof map.player === "string") {
    map.todoList.sort((a, b) => b.priority - a.priority || evt.playerMap.indexOf(a) - evt.playerMap.indexOf(b));
} else {
    map.todoList.sort((a, b) => b.priority - a.priority);
}
```

### 易忽略：静默技能抢占

```ts
// apps/core/noname/library/element/content.ts:3967-3972
const silentSkill = event.choice.find(item => {
    const skillInfo = lib.skill[item.skill];
    return skillInfo && (skillInfo.silent || !lib.translate[item.skill]);
});
```

⚠️ **没有翻译文本的技能会自动优先**。若技能定义时忘了写 `lib.translate`，可能行为异常。

---

## C.7 时序陷阱

### 陷阱：`goto` 不立即生效

```ts
goto(step) {
    this.step = step;      // → setter → #nextStep（pending）
    return this;
}
```

**必须等 `updateStep()`** 才提交。这在两处发生（`ContentCompilerBase` 的 `beforeExecute`/`afterExecute`）。

所以：

```js
content: async (event) => {
    event.goto(5);
    console.log(event.step);   // ← 还是旧值！不是 5
}
```

### 陷阱：`step++` 与 `content[event.step]`

```ts
// ArrayCompiler.ts:28-33
compiler.beforeExecute(event);   // updateStep + callHandler
event.step++;                    // 写 #nextStep
const original = content[event.step];   // 读 getter → #step（未含本次自增）
```

### 陷阱：`finish()` 后创建的子事件不执行

```ts
event.finish();
const next = game.createEvent("xxx");
// next 会被立即 resolve（因为 #inContent && finished）
```

---

## C.8 暂停与卡死

### 症状：游戏卡住不继续

**排查五个闸门**：

```js
_status.paused      // pause 闸门是否开启
_status.paused2     // pause2
_status.paused3     // pause3
_status.over        // over
_status.pauseManager.delay.isStarted   // delay
```

**常见原因**：

| 原因 | 说明 |
|------|------|
| `pause` 未释放 | 某处设了 `_status.paused = true` 但没设回 false |
| `delay` 任务未完成 | `setDelay` 的 Promise 永不 resolve |
| `waitNext` 中 `tempEvent` 冲突 | 其他事件抢占了当前事件 |

### 调试代码

```js
// 事件栈
_status.eventManager.eventStack.map(e => e.name)

// 当前事件
_status.eventManager.getStatusEvent()?.name

// 队列长度
_status.eventManager.getStatusEvent()?.next.length
```

---

## C.9 联机问题

| 症状 | 排查 |
|------|------|
| 客机技能无反应 | 客机不走时机流程（`_triggered = null`）；只做交互 |
| 主机报错客机正常 | 错误被 `catch` 吞（`gameEvent.ts:267-275`） |
| 客机卡住 | `waitPause` 未释放 |
| 随机结果不一致 | 是否用 `Math.random()` 而非 `event.getRand()` |
| 录像重放不同 | 同上 |
| 弹窗出现在错误客户端 | 检查 `event.isMine()` |

### 联机特有的行为差异

```ts
// ① 不走时机流程
if (trigger && !game.online) {
    this._triggered = 0;
}

// ② getParent 走 _modparent
if (game.online && event._modparent) {
    event = event._modparent;
} else {
    event = event.parent;
}
```

---

## C.10 性能与递归

### 陷阱：无限递归

```js
// ⚠️ 技能 A 监听 damage，content 里又造成伤害
lib.skill.a = {
    trigger: { player: "damageEnd" },
    content: async (event, trigger, player) => {
        await player.damage(1);     // ← 又触发 damageEnd → 递归
    },
};
```

**防护手段**：

```js
content: async (event, trigger, player) => {
    if (event._fromSkillA) return;          // 标记防重入
    const next = player.damage(1);
    next._fromSkillA = true;
}
```

或用 `cost` 中的条件判断：

```js
cost: (event, trigger, player) => {
    return !trigger._fromSkillA;
}
```

### 陷阱：事件树过深

**症状**：栈溢出 / 游戏卡顿。

**排查**：

```js
// 打印事件树深度
let depth = 0, e = _status.event;
while (e?.parent) { depth++; e = e.parent; }
console.log("事件树深度:", depth);
```

---

## C.11 调试工具速查

### 观察事件栈

```js
_status.eventManager.eventStack.map(e => e.name)
```

### 观察事件树

```js
// 向上
_status.event.getParent("phaseUse")
_status.event.getParent(3)

// 直接父事件
_status.event.parent?.name
```

### 观察时机注册

```js
lib.hookmap                                    // 所有有时机的时机名
lib.hook["1_player_phaseDrawBegin"]            // 玩家1注册的
lib.hook.globalskill["global_gameStart"]       // 全局技能
```

### 观察技能状态

```js
player.getSkills(true)          // 含隐藏
game.expandSkills(player.getSkills())
player.tempSkills               // 临时技能（含过期时间）
player.getStat("triggerSkill")  // 触发技发动次数
```

### 观察暂停

```js
_status.paused, _status.paused2, _status.paused3
_status.pauseManager.delay.isStarted
```

### 配置开关

```js
lib.config.ignore_error    // 是否吞掉错误
lib.config.debug           // 调试模式
```

---

## C.12 开发建议

1. **优先用 async 写法**，避免 step/数组写法（虽有大量存量代码）
2. **`check` 一定要写**，否则 AI 总是发动可选技能
3. **`forced` 时不要写 `cost`**（不会执行）
4. **异步操作必须 `await`**
5. **取结果必须 `.forResult()`**
6. **随机数用 `event.getRand()`**，不用 `Math.random()`
7. **联机技能必须判断 `event.isMine()`**
8. **调试时开启 `lib.config.ignore_error = false`** 让错误暴露
9. **技能 content 中注意防重入**，避免无限递归
10. **`silent`/无翻译技能会抢占同优先级**，必要时提高 `priority`

---

## C.13 相关文档

| 主题 | 文档 |
|------|------|
| 事件生命周期 | [05-event-lifecycle.md](05-event-lifecycle.md) |
| 事件关系与 then 语义 | [06-event-relationships.md](06-event-relationships.md) |
| content 编译 | [07-content-system.md](07-content-system.md) |
| 触发系统 | [08-trigger-system.md](08-trigger-system.md) |
| 技能执行 | [09-skill-execution.md](09-skill-execution.md) |
| 结果与 Promise | [10-results-and-promises.md](10-results-and-promises.md) |
| 暂停与联机 | [11-pause-and-online.md](11-pause-and-online.md) |
| 中断机制 | [12-interruption.md](12-interruption.md) |
| 扩展开发 | [13-extending.md](13-extending.md) |
