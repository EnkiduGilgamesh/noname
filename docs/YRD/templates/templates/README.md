# 技能模板库

> 11 类技能模板，全部基于**真实源码约定**。每个模板都可直接复制到 `character/skill.js`。
>
> ⚠️ 新代码请使用 **`async content` + `cost`**，不要用 `direct: true` 与 `"step 0"`（旧语法）。

---

## 索引

| # | 模板 | 何时使用 |
|---|------|---------|
| 01 | [被动触发技](01-被动触发技.js) | 满足条件时自动/询问发动 |
| 02 | [锁定技](02-锁定技.js) | 强制发动，不询问 |
| 03 | [有代价的触发技](03-有代价的触发技.js) | 发动前需弃牌/失去体力/选目标 |
| 04 | [视为技 viewAs](04-视为技viewAs.js) | 将 X 当 Y 使用或打出 |
| 05 | [主动技](05-主动技.js) | 出牌阶段主动发动 |
| 06 | [限定技与觉醒技](06-限定技与觉醒技.js) | 一局仅一次 |
| 07 | [状态切换技](07-状态切换技.js) | 转换技、需记录状态 |
| 08 | [直接效果技](08-直接效果技.js) | 摸牌/伤害/回复/弃牌 |
| 09 | [多目标技](09-多目标技.js) | 选择多个目标 |
| 10 | [附属技能](10-附属技能.js) | group / subSkill 关联 |
| 11 | [临时技能](11-临时技能.js) | addTempSkill 限时生效 |

---

## 通用骨架

任何触发技的最小结构：

```js
mypack_skill: {
    // 1. 何时触发
    trigger: { player: "phaseDrawBegin" },

    // 2. 条件判定（纯判定，禁止副作用，会被反复调用）
    filter(event, player, triggername, indexedData) {
        return true;
    },

    // 3. 是否发动（可选；没有 cost 且非 forced 时会自动 chooseBool 询问）
    // cost: async (event, trigger, player) => {...},

    // 4. 效果
    async content(event, trigger, player) {
        await player.draw(1);
    },
},
```

### 三个形参的含义

| 形参 | 实际含义 |
|------|---------|
| `event` | **技能效果事件**（`event.name` 就是技能 ID） |
| `trigger` | **触发源事件**（如 `phaseDraw` 事件） |
| `player` | 技能拥有者 |

⚠️ `trigger` 只在 `filter`/`cost`/`content` 内有效。**`await` 之后必须用形参 `trigger`**，不能依赖全局 `trigger`。

---

## 时机（trigger）速查

### 四个作用域

| 作用域 | 含义 |
|--------|------|
| `player` | 事件的 `player` 是自己 |
| `source` | 事件的 `source` 是自己 |
| `target` | 事件的 `target` 是自己 |
| `global` | 任何事件都触发 |

### 常用时机名

| 时机 | 含义 |
|------|------|
| `phaseZhunbeiBegin` | 准备阶段开始时 |
| `phaseJudgeBegin` | 判定阶段开始时 |
| `phaseDrawBegin` / `phaseDrawBegin1` / `phaseDrawBegin2` | 摸牌阶段开始时 |
| `phaseUseBegin` | 出牌阶段开始时 |
| `phaseDiscardBegin` | 弃牌阶段开始时 |
| `phaseJieshuBegin` | 结束阶段开始时 |
| `phaseBegin` / `phaseEnd` | 回合开始/结束时 |
| `damageBegin` / `damageEnd` | 造成/受到伤害时 |
| `recoverEnd` | 回复体力后 |
| `useCard` / `useCardToTarget` | 使用牌时 / 成为目标时 |
| `shaBegin` / `shaEnd` | 【杀】结算时 |
| `gainAfter` / `loseAfter` | 获得/失去牌后 |
| `dying` | 濒死时 |
| `dieBegin` | 死亡时 |
| `gameStart` | 游戏开始时 |
| `roundStart` / `roundEnd` | 一轮开始/结束时 |

> 完整列表：事件名 + 后缀（`Before`/`Begin`/`End`/`After`）。见 [08-trigger-system.md](../../08-trigger-system.md)

---

## 常用 API 速查

### 效果类（均返回可 await 的事件）

| API | 作用 |
|-----|------|
| `await player.draw(n)` | 摸 n 张牌 |
| `await player.recover(n)` | 回复 n 点体力 |
| `await player.loseHp(n)` | 失去 n 点体力（不触发伤害事件） |
| `await player.damage(n)` | 造成 n 点伤害 |
| `await player.discard({ cards, discarder })` | 弃牌 |
| `await player.gain({ cards, animate })` | 获得牌 |
| `await player.loseMaxHp()` / `gainMaxHp()` | 改体力上限 |
| `player.awakenSkill(skillId)` | 标记限定技已用 |

### 询问类（**必须 `.forResult()`**）

| API | 返回 |
|-----|------|
| `chooseToDiscard` | `{ bool, cards }` |
| `chooseCard` | `{ bool, cards }` |
| `chooseTarget` | `{ bool, targets }` |
| `chooseBool` | `{ bool }` |
| `chooseToUse` | `{ bool, card, cards, targets }` |
| `chooseToRespond` | `{ bool, card, cards }` |
| `chooseControl` | `{ bool, control }` |
| `chooseButton` | `{ bool, links }` |

### 状态与标记

| API | 作用 |
|-----|------|
| `player.storage.<skillId>` | 内部状态（**不显示**在武将牌上） |
| `player.markAuto(skill, [values])` | 加可见标记 |
| `player.unmarkAuto(skill, [values])` | 移除标记 |
| `player.addTempSkill(id, expire)` | 临时技能 |
| `player.addSkills([...])` | 永久获得技能 |
| `player.removeSkill(id)` | 移除技能 |
| `player.hasSkill(id)` | 是否拥有技能 |

---

## 十大避坑

1. **`filter` 禁止副作用** —— 它会被反复调用，改状态必须放 `content`
2. **`cost` 必须写 `event.result = await ....forResult()`** —— 忘记则技能永不发动且无报错
3. **用 `cost` 而非 `direct: true`** —— 后者已过时
4. **用 `async content` 而非 `"step 0"`** —— 后者是旧语法
5. **取结果必须 `.forResult()`** —— 只 `await` 得到 `undefined`
6. **异步操作必须 `await`** —— 否则产生竞态
7. **限定技必须 `awakenSkill(event.name)`** —— 否则无限发动
8. **临时技能 ID 必须已定义** —— 否则 `addTempSkill` 静默失败
9. **AI 回调里用 `get.player()`** —— `player` 变量不可直接引用
10. **`subSkill` 的子技能要配 `charlotte: true`** —— 否则显示在武将牌上

---

## 返回上级

[模板库总览](../README.md) · [YRD 文档](../../README.md)
