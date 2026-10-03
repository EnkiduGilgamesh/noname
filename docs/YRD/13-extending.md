# 13 · 扩展与技能开发指南

> 本篇回答：**如何写一个技能/扩展？有哪些必须遵守的约定和常见坑？**
>
> 本篇是面向实践的操作指南，前置知识见 [07](07-content-system.md)、[08](08-trigger-system.md)、[10](10-results-and-promises.md)。

---

## 1. 最小可用技能

```js
lib.skill.mySkill = {
    trigger: { player: "phaseDrawBegin" },
    forced: true,
    content: async (event, trigger, player) => {
        await player.draw(1);
    },
};
```

**三要素**：`trigger`（何时）、`content`（做什么）、以及是否需要 `cost`。

---

## 2. 时机的选择

### 时机名 = 事件名 + 后缀

| 后缀 | 触发点 |
|------|--------|
| `Before` | content 之前（最早） |
| `Begin` | content 之前（稍晚） |
| `End` | 事件 finished 后 |
| `After` | 最后 |
| `Skipped` | 被跳过 |
| `Cancelled` | 被取消 |
| `Omitted` | Before 后即被跳过 |

```js
trigger: { player: "phaseDrawBegin" }   // 摸牌阶段开始时
trigger: { player: "damageEnd" }        // 造成伤害后
trigger: { global: "gameStart" }        // 游戏开始时
trigger: { source: "damageBegin" }      // 自己造成伤害时
trigger: { target: "useCardToTarget" }  // 成为目标时
```

### 四种角色

| 角色 | 含义 |
|------|------|
| `player` | 事件的 `player` 是自己 |
| `source` | 事件的 `source` 是自己 |
| `target` | 事件的 `target` 是自己 |
| `global` | 任何事件都触发 |

```js
trigger: {
    player: ["phaseDrawBegin", "phaseUseBegin"],   // 数组可注册多个
    global: "gameStart",
}
```

### 时机别名：phaseAny

```js
trigger: { player: "phaseAny" }   // 任何阶段
```

它会展开为 `lib.phaseName` 中的所有阶段。

⚠️ 注意是**前缀匹配**展开：`evt.startsWith(name)`，所以 `phaseAny` 会匹配 `lib.phaseName` 各项并保留后缀。

---

## 3. content 写法

### ✅ 推荐：单个 async 函数

```js
content: async (event, trigger, player) => {
    const result = await player.chooseCard("选择一张牌").forResult();
    if (result.bool) {
        await player.discard(result.cards);
    }
}
```

### ⚠️ 参数含义

| 参数 | 实际值 |
|------|--------|
| `event` | **技能效果事件**（`next = game.createEvent(event.skill)`） |
| `trigger` | **触发源事件**（即 `event._trigger`） |
| `player` | 技能拥有者 |

> 💡 `trigger` 是"什么事件触发了这个技能"。例如 `phaseDrawBegin` 触发时，`trigger` 就是 `phaseDraw` 事件。

### 读取触发上下文

```js
content: async (event, trigger, player) => {
    // 造成伤害的技能：从 trigger 拿伤害信息
    const num = trigger.num;
    const source = trigger.source;
    const targets = trigger.targets;
}
```

---

## 4. cost 的写法

`cost` 用于"能否发动"和"选择目标"：

```js
lib.skill.mySkill = {
    trigger: { player: "phaseUseBegin" },
    cost: async (event, trigger, player) => {
        // 选择一张手牌弃置
        const result = await player
            .chooseToDiscard("弃置一张牌发动", 1, "h")
            .set("ai", card => 1)
            .forResult();
        if (!result.bool) {
            return;    // 返回假值 → 技能不发动
        }
    },
    content: async (event, trigger, player) => {
        await player.draw(2);
    },
};
```

### cost 中选目标的传递

```js
cost: async (event, trigger, player) => {
    const result = await player
        .chooseTarget("选择一名角色", (card, player, target) => target != player)
        .set("ai", target => 1)
        .forResult();
    if (!result.bool) {
        event.cancelled = true;    // ← 阻止 content
    }
},
content: async (event, trigger, player) => {
    const targets = event.targets;   // ← cost 中选的目标
}
```

⚠️ cost 里如果 `return` 假值，技能不发动。也可以设 `event.cancelled = true`。

### 无 cost 时的自动询问

若不写 `cost` 且非 `forced`，系统会**自动 `chooseBool` 询问玩家**：

```ts
// apps/core/noname/library/element/content.ts:4131-4137
const next = player.chooseBool(str);
next.ai = () => !check || check(trigger, player, event.triggername, event.indexedData);
```

⚠️ **AI 是否发动由 `check` 决定**；**不写 `check` 则 AI 默认发动**。

```js
lib.skill.mySkill = {
    trigger: { player: "phaseDrawBegin" },
    // 不写 cost → 会自动询问玩家"是否发动"
    check: (trigger, player) => player.countCards("h") < 2,   // AI 判断
    content: async (event, trigger, player) => { await player.draw(1); },
};
```

---

## 5. 常用技能属性速查

| 属性 | 类型 | 作用 |
|------|------|------|
| `trigger` | object | 注册时机 |
| `forced` | boolean | 锁定技，不询问 |
| `direct` | boolean | 直接发动，不播报 |
| `silent` | boolean | 静默，同优先级时优先 |
| `priority` | number | 时机竞争优先级（越大越先） |
| `firstDo` | boolean | 插到所有玩家之前 |
| `lastDo` | boolean | 插到所有玩家之后 |
| `getIndex` | function | 一次时机触发多次 |
| `cost` | function | 能否发动 |
| `content` | function | 技能效果 |
| `check` | function | AI 是否发动 |
| `prompt` | string | 询问文本 |
| `prompt2` | string | 提示详情 |
| `popup` | boolean/string | 是否/如何播报 |
| `logTarget` | string/function | 日志目标 |
| `oncancel` | function | 取消回调 |
| `forceDie` | boolean | 死亡时仍可触发 |
| `forceOut` | boolean | 出局时仍可触发 |
| `usable` | number | 可用次数限制 |

---

## 6. 完整示例：一个"受伤时摸牌"的技能

```js
lib.skill.exampleSkill = {
    // 注册：自己是伤害目标时
    trigger: { player: "damageEnd" },

    // 锁定技
    forced: true,

    // 时机优先级（默认 0）
    priority: 0,

    content: async (event, trigger, player) => {
        // trigger 是 damage 事件
        const num = trigger.num || 1;        // 伤害点数
        const source = trigger.source;        // 伤害来源
        const nature = trigger.nature;        // 属性（fire/thunder/...）

        await player.draw(num);

        // 可以创建新事件
        if (source && source.isAlive()) {
            await source.damage(1);
        }
    },
};
```

---

## 7. 扩展的结构

```
extension/
  └─ 我的扩展/
      ├─ extension.js      入口
      ├─ info.json         元信息（可选）
      ├─ character/        武将
      ├─ card/             卡牌
      └─ image/            素材
```

### extension.js 基本结构

```js
export const type = "extension";

export default {
    name: "我的扩展",

    // 引入其他模块
    // character: {...},
    // card: {...},
    // skill: {...},
    // translate: {...},

    // 游戏开始前调用
    precontent() {
        // 初始化
    },
};
```

> 💡 具体的扩展 API 见 `docs/` 下其他文档与 `apps/core/extension/` 中的示例扩展。

### 内置扩展示例

仓库中有 8 个内置扩展可供参考：

```
apps/core/extension/
  ├─ 3D精选/
  ├─ boss/
  ├─ cardpile/
  ├─ coin/
  ├─ 杀海拾遗/
  ├─ 欢乐卡牌/
  ├─ 玩点论杀/
  └─ 英雄杀/
```

---

## 8. 常见坑（重点）

### 坑 1：忘记 `forResult()` 拿不到结果

```js
// ❌ r 是 undefined
const r = await player.chooseCard();

// ✅
const r = await player.chooseCard().forResult();
```

原因见 [10](10-results-and-promises.md)：`then()` 有 parent 时返回 `undefined`。

### 坑 2：忘记 `await`

```js
// ❌ 牌还没摸完就继续了
player.draw(2);
game.log(player, "摸了牌");

// ✅
await player.draw(2);
game.log(player, "摸了牌");
```

### 坑 3：`forced` 与 `cost` 冲突

```js
// ⚠️ forced=true 时不会执行 cost
lib.skill.xxx = {
    forced: true,
    cost: async () => { /* 不会执行！ */ },
};
```

`forced` 走"直接 `{bool: true}`"路径，跳过 cost。

### 坑 4：AI 默认发动

```js
// ⚠️ 不写 check → AI 总是发动
lib.skill.xxx = {
    trigger: { player: "phaseDrawBegin" },
    content: async (event, trigger, player) => { await player.draw(1); },
};
```

若这是可选技能，AI 会一直发动。**必须写 `check`**。

### 坑 5：`silent` 技能抢占

```js
// ⚠️ silent 或无翻译的技能在同优先级时自动优先
```

若技能不想被内部技能抢占，需要设 `priority` 高于它们。

### 坑 6：联机下错误被吞

联机非 debug 模式下，content 抛错**只打印不中断**（见 [11](11-pause-and-online.md)）。写联机技能时务必看 `console.error`。

### 坑 7：用 `Math.random()` 导致不一致

```js
// ❌ 录像重放/联机可能不一致
const r = Math.random();

// ✅
const r = event.getRand();
```

### 坑 8：`_result` 只读不改

在 step/数组写法中，`result` 是**上一步的结果**（`event._result`）。不要在 content 里依赖它的"实时值"。

### 坑 9：在 `filter*` 系列中 `await`

```js
// ❌ filterCard 必须同步返回
filterCard: async (card, player) => { ... }

// ✅
filterCard: (card, player) => { return true; }
```

### 坑 10：无限递归

```js
// ⚠️ 技能 A 触发某事，该事又触发技能 A
content: async (event, trigger, player) => {
    await player.damage(1);   // 若本技能也监听 damage，可能递归
}
```

防护手段：

```js
cost: (event, trigger, player) => {
    if (event._fromThisSkill) return false;    // 标记防重入
}
```

### 坑 11：死亡/出局时技能不触发

```js
lib.skill.xxx = {
    // 需要死亡时仍触发
    forceDie: true,
    // 需要出局时仍触发
    forceOut: true,
};
```

⚠️ 技能 `trigger` 创建的事件默认 `forceDie`/`includeOut` 为 `true`（见 `createTrigger`），但**技能自己的额外事件**需要单独设置。

### 坑 12：`popup` 与 `logTarget`

```js
lib.skill.xxx = {
    popup: false,              // 不播报动画
    logTarget: "targets",      // 日志目标取自 trigger.targets
    logLine: false,            // 不画连线
};
```

---

## 9. 调试流程

```
① 技能不触发？
   ├─ 检查 trigger 的角色配置（player/source/target/global）
   ├─ 检查时机名拼写（事件名 + 后缀）
   ├─ lib.hookmap[时机名] 是否为 true
   └─ 检查技能是否真的被玩家拥有（hiddenSkills？）

② 技能触发了但没发动？
   ├─ cost 是否返回假值
   ├─ chooseBool 是否被玩家/ AI 选了否
   ├─ check 函数是否正确
   └─ isPrevented 是否拦截（玩家死亡/出局）

③ 技能发动了但没效果？
   ├─ console.error 是否有报错（联机被吞）
   ├─ content 是否真的执行（事件名 = 技能名）
   └─ 是否 await 了异步操作

④ 效果顺序不对？
   ├─ priority 设置
   ├─ firstDo / lastDo
   └─ silent 技能抢占
```

### 实用调试代码

```js
// 查看当前事件栈
console.log(_status.eventManager.eventStack.map(e => e.name));

// 查看事件树
console.log(_status.event.getParent(1));

// 查看某时机的注册情况
console.log(lib.hookmap["phaseDrawBegin"]);
console.log(lib.hook["1_player_phaseDrawBegin"]);
```

---

## 10. 本篇小结

- 技能三要素：`trigger`（何时）、`cost`（能否）、`content`（做什么）
- **content 的 `trigger` 参数是触发源事件**，从中读取上下文
- **无 `cost` 且非 `forced` 会自动 `chooseBool` 询问；AI 由 `check` 决定，不写则默认发动**
- **`forced: true` 会让 `cost` 完全不执行**
- cost 中选的目标可通过 `event.targets` 在 content 中读取
- 12 个常见坑：`forResult`、`await`、`forced`+`cost`、AI 默认发动、`silent` 抢占、联机吞错、`Math.random`、`_result`、`filter*` 同步、无限递归、`forceDie`/`forceOut`、`popup`/`logTarget`
- 调试顺序：**是否触发 → 是否发动 → 是否有报错 → 顺序是否正确**

**下一步** → [appendix-a-source-map.md](appendix-a-source-map.md)：源码地图
