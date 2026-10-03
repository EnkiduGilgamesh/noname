# 08 · 技能触发系统

> 本篇回答：**技能如何"挂"到时机上？触发时如何收集、排序、执行？**
>
> 本篇是事件系统最核心的部分：**控制反转的完整实现**。

---

## 1. 全貌：从"事件触发时机"到"技能产生效果"

```
事件 loop() 调用 this.trigger("phaseDrawBegin")
    │
    ▼
① GameEvent.trigger(name)                       gameEvent.ts:462
    ├─ 前置检查（video / gameDrawed / gameStart 特殊处理）
    ├─ lib.hookmap[name] 存在吗？→ 否，直接返回
    ├─ 确定起始玩家 start
    ├─ 按座次遍历所有玩家，为每人建 doing 结构
    │    └─ 收集：lib.hook[playerid_role_name] + lib.hook.globalskill[role_name]
    └─ 有技能吗（allbool）？→ 是，创建 arrangeTrigger 事件
    │
    ▼
② arrangeTrigger content                          content.ts:3947
    for each doing（每个玩家）：
      while (true):
        ├─ filterTrigger 过滤出可用技能
        ├─ 优先级剪枝：只保留 priority 最高的
        ├─ 解决同优先级冲突（选一个）
        │    ├─ silent 技能优先
        │    ├─ 只有一个 → 直接选
        │    └─ 多个 → player.chooseControl 让玩家选
        └─ game.createTrigger(...) → 创建 trigger 事件
    │
    ▼
③ createTrigger content                           content.ts:4009
    ├─ 技能归属校验（是否真拥有该技能）
    ├─ cost（若有）→ 能否发动
    │    或 chooseBool（无 cost）→ 询问是否发动
    ├─ 结果判定（false → oncancel 并返回）
    ├─ popup 播报（logSkill）
    └─ 创建 skillName 事件，content = info.content → 技能效果
    │
    ▼
④ 技能 content 执行 → 又创建新事件（递归回 ①）
```

---

## 2. 技能如何注册到时机

### lib.hookmap —— "这个时机有人关心吗"

```js
// apps/core/noname/library/index.js:461
hookmap = {};
```

**这是一个快速索引**：`lib.hookmap["phaseDrawBegin"] = true` 表示"有技能注册了 `phaseDrawBegin` 时机"。

⚠️ 它是**优化手段**：`trigger()` 第一步就查它，没有则直接返回，避免遍历所有玩家。

### lib.hook —— 谁关心

```js
// apps/core/noname/library/index.js:383
hook = { globalskill: {} };
```

`lib.hook` 的键格式为 `玩家ID_角色_时机名`：

| 角色 | 含义 |
|------|------|
| `player` | 事件的 `player` 是技能拥有者 |
| `source` | 事件的 `source` 是技能拥有者 |
| `target` | 事件的 `target` 是技能拥有者 |
| `global` | 全局时机，任何人触发 |

所以 `lib.hook["3_player_phaseDrawBegin"]` 是玩家 3 在"自己是回合主角"时注册的 `phaseDrawBegin` 技能列表。

### 全局技能

```js
// apps/core/noname/library/index.js:383
hook = { globalskill: {} };
```

全局技能的键是 `角色_时机名`（无玩家 ID）：

```
lib.hook.globalskill["global_phaseDrawBegin"]   ← global 角色的全局技能
lib.hook.globalskill["player_phaseDrawBegin"]   ← player 角色的全局技能
```

### 注册时机

技能注册发生在：
- 玩家获得技能时（`player.addSkill`）
- 扩展加载时
- `game.addGlobalSkill` 时

```js
// apps/core/noname/game/index.js:6316-6359（全局技能注册节选）
addGlobalSkill(skill, player) {
    let info = lib.skill[skill];
    if (!info) return false;
    lib.skill.global.add(skill);
    // ...
    if (info.trigger) {
        let setTrigger = function (i, evt) {
            let name = i + "_" + evt;
            if (!lib.hook.globalskill[name]) {
                lib.hook.globalskill[name] = [];
            }
            lib.hook.globalskill[name].add(skill);
            lib.hookmap[evt] = true;         // ← 置位快速索引
        };
        const map = lib.relatedTrigger, names = Object.keys(map);
        for (let i in info.trigger) {
            const evts = [];
            if (typeof info.trigger[i] == "string") {
                evts.add(info.trigger[i]);
            } else if (Array.isArray(info.trigger[i])) {
                evts.addArray(info.trigger[i]);
            }
            evts.forEach(evt => {
                names
                    .reduce((list, name) => {
                        if (evt.startsWith(name)) {
                            return list.addArray(map[name].map(j => j + evt.slice(name.length)));
                        }
                        return list;
                    }, [])
                    .forEach(evtx => setTrigger(i, evtx));
                setTrigger(i, evt);
            });
        }
    }
    return true;
}
```

### relatedTrigger —— 时机别名

```js
// apps/core/noname/library/index.js:462-471
//共联时机的map
#relatedTrigger = {
    get phaseAny() {
        return lib.phaseName;
    },
    //loseAsync: ["lose", "gain", "addToExpansion", "addJudge", "eqiup"],
};
get relatedTrigger() {
    return this.#relatedTrigger;
}
```

🔬 **`phaseAny` 返回的是 `lib.phaseName` 数组**（所有阶段名），不是"当前阶段名"：

```js
// apps/core/noname/library/index.js（lib.phaseName 定义）
phaseName = ["phaseZhunbei", "phaseJudge", "phaseDraw", "phaseUse", "phaseDiscard", "phaseJieshu", ...];
```

**用途**：技能可以注册 `phaseAny` 表示"任何阶段"。注册时展开为所有具体阶段名：

```js
names.reduce((list, name) => {
    if (evt.startsWith(name)) {                     // "phaseAny" 以 "phaseAny" 开头
        return list.addArray(map[name].map(j => j + evt.slice(name.length)));
        //                                  ↑ lib.phaseName 每个 + 后缀
    }
    return list;
}, [])
```

⚠️ `loseAsync` 那条映射在源码中是**注释掉的**。

---

## 3. GameEvent.trigger() 详解

```ts
// apps/core/noname/library/element/gameEvent.ts:462-500（节选）
trigger(name: string): GameEvent {
    // ① 录像播放中不触发
    if (_status.video) {
        return;
    }
    // ② 游戏发牌前，这些事件不触发时机
    if (!_status.gameDrawed && ["lose", "gain", "loseAsync", "equip", "addJudge", "addToExpansion"].includes(this.name)) {
        return;
    }
    // ③ gameDrawEnd 置位
    if (name === "gameDrawEnd") {
        _status.gameDrawed = true;
    }
    // ④ gameStart 的特殊处理
    if (name === "gameStart") {
        lib.announce.publish("Noname.Game.Event.GameStart", {});
        lib.announce.publish("gameStart", {});
        if (_status.brawl && _status.brawl.gameStart) {
            _status.brawl.gameStart();
        }
        if (lib.config.show_cardpile) ui.cardPileButton.style.display = "";
        if (lib.config.show_commonCardpile) ui.commonCardPileButton.style.display = "";
        _status.gameStarted = true;
        game.showHistory();
    }
    // ⑤ 快速索引检查
    if (!lib.hookmap[name]) {
        return;
    }
    if (!game.players || !game.players.length) {
        return;
    }
    // ⑥ filterStop
    const event = this;
    if (event.filterStop && event.filterStop()) {
        return;
    }
    // ⑦ 确定起始玩家
    let start = [_status.currentPhase, event.source, event.player, game.me, game.players[0]]
        .find(i => get.itemtype(i) == "player");
    if (!start) {
        return;
    }
    if (!game.players.includes(start) && !game.dead.includes(start)) {
        start = game.findNext(start);
    }
    // ... ⑧ 遍历收集
}
```

⚠️ **`lib.hookmap` 检查是第 ⑤ 步，不是第 1 步**。前面有 4 项前置逻辑，其中 `gameStart` 的处理相当重。

⚠️ 录像播放（`_status.video`）时**所有时机都不触发** —— 这是录像回放能确定性重放的原因。

### 起始玩家优先级

```ts
let start = [_status.currentPhase, event.source, event.player, game.me, game.players[0]]
    .find(i => get.itemtype(i) == "player");
```

取第一个"真的是玩家"的值。若该玩家已不在场也未死亡，用 `game.findNext(start)` 兜底。

### 按座次遍历收集

```ts
// apps/core/noname/library/element/gameEvent.ts:514-631（结构）
const firstDo: triggerPlayerTodo = { player: "firstDo", todoList: [], doneList: [] };
const lastDo: triggerPlayerTodo = { player: "lastDo", todoList: [], doneList: [] };
const doingList: triggerPlayerTodo[] = [];
const roles = ["player", "source", "target", "global"],
    map = lib.relatedTrigger,
    names = Object.keys(map);
const playerMap = game.players.concat(game.dead).sortBySeat(start);
let player = start;
let allbool = false;
do {
    const doing = {
        player: player,
        todoList: [],
        doneList: [],
        listAdded: {},
        addList(skill) { /* ... */ },
    };
    // tempSkills 过期清理
    // ...
    roles.forEach(role => {
        doing.addList(lib.hook.globalskill[role + "_" + name]);
        doing.addList(lib.hook[player.playerid + "_" + role + "_" + name]);
    });
    delete doing.listAdded;
    delete doing.addList;
    doingList.push(doing);
    player = player.nextSeat;
} while (player && player !== start);
doingList.unshift(firstDo);
doingList.push(lastDo);
```

**关键点**：

| 要点 | 说明 |
|------|------|
| 遍历顺序 | 从 `start` 开始，沿 `nextSeat` 绕一圈 |
| 每人一个 `doing` | 包含该玩家的 `todoList` / `doneList` |
| 四种角色 | 每个玩家都检查 `player`/`source`/`target`/`global` 四种注册 |
| `firstDo` / `lastDo` | **插在队首和队尾**，不受座次限制 |
| 排序基准 | `playerMap = game.players.concat(game.dead).sortBySeat(start)` |

### tempSkills 的过期清理

在收集每个玩家的技能前，会检查 `tempSkills`（临时技能）是否过期：

```ts
// apps/core/noname/library/element/gameEvent.ts:585-621（节选）
Object.keys(player.tempSkills)
    .filter(skill => {
        if (notemp.includes(skill)) {
            return false;          // 已在常驻技能中，不过期
        }
        const expire = player.tempSkills[skill];
        if (typeof expire === "function") {
            return expire(event, player, name);     // 函数式：返回 true 表示过期
        }
        if (get.objtype(expire) === "object") {
            return roles.some(role => {
                if (role !== "global" && player !== event[role]) {
                    return false;
                }
                const checkTrigger = trigger => {
                    if (trigger == name) return true;
                    const evt = names.find(evt => trigger?.startsWith(evt));
                    if (!evt) return false;
                    return map[evt].some(rawTrigger => {
                        return `${rawTrigger}${trigger.slice(evt.length)}` == name;
                    });
                };
                if (Array.isArray(expire[role])) {
                    return expire[role].length && expire[role].some(checkTrigger);
                }
                return checkTrigger(expire[role]);
            });
        }
        return false;
    })
    .forEach(skill => {
        delete player.tempSkills[skill];
        player.removeSkill(skill);      // ← 过期即移除
    });
```

> 💡 这是 `player.tempSkills` 的**唯一过期判定点**：临时技能在"下一次有人触发时机时"被检查并清理。

### 创建 arrangeTrigger

```ts
// apps/core/noname/library/element/gameEvent.ts:636-647
if (allbool) {
    const next = game.createEvent("arrangeTrigger", false, event);
    next.setContent("arrangeTrigger");
    next.doingList = doingList;
    next._trigger = event;          // ← 指回被触发的原事件
    next.triggername = name;
    next.playerMap = playerMap;     // ← 供排序使用
    event._triggering = next;
    next.then(() => (event._triggering = void 0));
    return next;
}
return null;
```

⚠️ **`playerMap` 被写入事件上**，是 `addTrigger` 排序依赖的字段：

```ts
// apps/core/noname/library/element/gameEvent.ts:424
map.todoList.sort((a, b) => b.priority - a.priority || evt.playerMap.indexOf(a) - evt.playerMap.indexOf(b));
```

⚠️ **`allbool` 为 false（没收集到任何技能）时返回 `null`**，不创建 arrangeTrigger 事件。

---

## 4. addList —— 技能入队与排序

```ts
// apps/core/noname/library/element/gameEvent.ts:527-576
addList(skill) {
    if (!skill) return;
    if (Array.isArray(skill)) {
        return skill.forEach(i => this.addList(i));
    }
    if (this.listAdded[skill]) return;      // 去重
    this.listAdded[skill] = true;

    const info = lib.skill[skill];
    const list = info.firstDo ? firstDo.todoList : info.lastDo ? lastDo.todoList : this.todoList;
    const priority = get.priority(skill);

    if (typeof info.getIndex === "function") {
        const indexedResult = info.getIndex<any>(event, player, name);
        if (typeof indexedResult === "number") {
            for (let i = 0; i < indexedResult; i++) {
                list.push({ skill, player: this.player, priority, indexedData: true });
            }
        } else if (indexedResult != null && typeof indexedResult !== "string" &&
                   typeof indexedResult[Symbol.iterator] === "function") {
            for (const indexedData of indexedResult) {
                list.push({ skill, player: this.player, priority, indexedData });
            }
        }
    } else {
        list.push({ skill: skill, player: this.player, priority: get.priority(skill) });
    }

    // 排序
    if (typeof this.player == "string") {
        // firstDo / lastDo：跨玩家按座次排
        list.sort((a, b) => b.priority - a.priority || playerMap.indexOf(a.player) - playerMap.indexOf(b.player));
    } else {
        list.sort((a, b) => b.priority - a.priority);
    }
    allbool = true;
}
```

### 三个队列的选择

```ts
const list = info.firstDo ? firstDo.todoList : info.lastDo ? lastDo.todoList : this.todoList;
```

| 技能属性 | 入队 |
|---------|------|
| `firstDo: true` | `firstDo.todoList`（**最先**，跨玩家按座次） |
| `lastDo: true` | `lastDo.todoList`（**最后**） |
| 默认 | 该玩家自己的 `todoList` |

### 排序规则

```ts
list.sort((a, b) => b.priority - a.priority);      // 优先级降序
```

`firstDo`/`lastDo` 额外按座次排：

```ts
list.sort((a, b) => b.priority - a.priority || playerMap.indexOf(a.player) - playerMap.indexOf(b.player));
```

### getIndex —— 一次注册多次触发

```ts
getIndex?(event: GameEvent, player: Player, triggername: string): number | Iterable<any>;
```

| 返回值 | 效果 |
|--------|------|
| `number` | 入队 **N 个** `indexedData: true` 条目（该技能可触发 N 次） |
| 可迭代对象 | 每个 `indexedData` 一条目 |
| 其他 | 不入队 |

> 💡 典型用途："摸牌阶段摸 X 张牌，每张都可触发"这类需要按次数触发的技能。

🔬 `indexedData: true` 的条目**跳过去重检查**（`addTrigger` 中），这正是它能重复触发的原因。

---

## 5. arrangeTrigger —— 技能竞争与执行

```ts
// apps/core/noname/library/element/content.ts:3947-4008
async arrangeTrigger(event, trigger, player) {
    const doingList = event.doingList.slice(0);

    while (doingList.length > 0) {
        event.doing = doingList.shift();          // ① 取一个玩家
        while (true) {
            if (trigger.filterStop && trigger.filterStop()) {
                return;                            // ② 外部中止
            }
            // ③ 过滤出真正可用的技能
            const usableSkills = event.doing.todoList.filter(info =>
                lib.filter.filterTrigger(trigger, info.player, event.triggername, info.skill, info.indexedData)
            );
            if (usableSkills.length == 0) {
                break;                             // 该玩家处理完毕
            } else {
                // ④ 优先级剪枝：只保留最高优先级
                event.doing.todoList = event.doing.todoList.filter(i => i.priority <= usableSkills[0].priority);

                if (get.itemtype(event.doing.player) !== "player") {
                    // ⑤ firstDo / lastDo：不竞争，直接取第一个
                    event.current = usableSkills[0];
                } else {
                    // ⑥ 普通玩家：同优先级需要竞争
                    event.choice = usableSkills.filter(n => n.priority == usableSkills[0].priority);

                    // 静默技能优先
                    const silentSkill = event.choice.find(item => {
                        const skillInfo = lib.skill[item.skill];
                        return skillInfo && (skillInfo.silent || !lib.translate[item.skill]);
                    });
                    if (silentSkill) {
                        event.current = silentSkill;
                    } else {
                        const currentChoice = event.choice[0];
                        const skillsToChoose = event.choice.map(i => i.skill).unique();
                        if (event.choice.length === 1 || skillsToChoose.length === 1) {
                            event.current = currentChoice;
                        } else {
                            // ⑦ 多个不同技能同优先级 → 让玩家选
                            const currentPlayer = currentChoice.player;
                            const next = currentPlayer.chooseControl(
                                skillsToChoose.map(skill => get.skillTranslation(skill, currentPlayer, true))
                            );
                            next.set("prompt", "选择下一个触发的技能");
                            next.set("forceDie", true);
                            next.set("arrangeSkill", true);
                            next.set("includeOut", true);
                            const result = await next.forResult();
                            if (result) {
                                event.current = usableSkills.find(info => info.skill == skillsToChoose[result.index]);
                            } else {
                                event.current = usableSkills[0];
                            }
                        }
                    }
                }

                // ⑧ 移出待办，加入已完成
                event.doing.doneList.push(event.current);
                event.doing.todoList.remove(event.current);

                // ⑨ 创建并执行 trigger 事件
                const result = await game.createTrigger(
                    event.triggername, event.current.skill, event.current.player,
                    trigger, event.current.indexedData
                ).forResult();

                // ⑩ 被取消时，同技能的后续条目也一并取消
                if (get.itemtype(event.doing.player) === "player" && result === "cancelled") {
                    for (let i = 0; i < event.doing.todoList.length; i++) {
                        if (event.current.skill === event.doing.todoList[i].skill) {
                            event.doing.doneList.push(event.doing.todoList.splice(i--, 1)[0]);
                        }
                    }
                }
            }
        }
    }
}
```

### 关键机制

| 步骤 | 机制 | 说明 |
|------|------|------|
| ③ | `filterTrigger` | 最终可用性检查（技能可能因条件不满足被过滤） |
| ④ | **优先级剪枝** | 保留 `priority <= 最高值`，即只留最高的 |
| ⑤ | firstDo/lastDo 不竞争 | 直接取第一个 |
| ⑥ | **静默技能优先** | `silent` 或**无翻译**的技能自动优先 |
| ⑦ | **同优先级选择** | 多个不同技能同优先级 → `chooseControl` 让玩家选 |
| ⑩ | 取消联动 | 被取消则同技能后续条目一并取消 |

⚠️ **④ 的剪枝方向**：`filter(i => i.priority <= usableSkills[0].priority)` 保留的是 **priority ≤ 最高值**的条目。由于 `usableSkills` 已按优先级降序，`usableSkills[0]` 就是最高优先级，所以等价于"只保留最高的"。

🔬 **⑥ 静默技能优先的妙处**：`!lib.translate[item.skill]` 表示"没有翻译文本"的技能——这类技能通常是**内部辅助技能**，不应弹窗询问玩家，所以自动优先静默执行。

### 玩家选择下一个技能的时机

仅当**同时满足**：
1. 是普通玩家（不是 firstDo/lastDo）
2. 有多个同优先级技能
3. 这些技能**不是同一个**（`skillsToChoose.length > 1`）

否则直接取第一个。

---

## 6. createTrigger —— 技能执行

创建：

```js
// apps/core/noname/game/index.js:5988-6009
createTrigger(name, skill, player, event, indexedData) {
    let info = get.info(skill);
    if (!info) {
        return false;
    }
    if ((player.isOut() || player.removed) && !info.forceOut) {
        return;
    }
    if (player.isDead() && !info.forceDie) {
        return;
    }
    let next = game.createEvent("trigger", false);
    next.skill = skill;
    next.player = player;
    next.triggername = name;
    next.forceDie = true;        // ⚠️ 常被遗漏
    next.includeOut = true;      // ⚠️ 常被遗漏
    next._trigger = event;
    next.indexedData = indexedData;
    next.setContent("createTrigger");
    return next;
}
```

⚠️ **`forceDie = true` 和 `includeOut = true`**：保证技能即使在玩家死亡/出局时**也执行**（用于结算类技能）。这两个字段直接决定 `isPrevented` 的判定，很关键但常被忽略。

### createTrigger content 主流程

```ts
// apps/core/noname/library/element/content.ts:4009-4052
async createTrigger(event, trigger, player) {
    const info = get.info(event.skill);

    // ① 技能归属校验：玩家真的拥有这个技能吗？
    if (!game.expandSkills(player.getSkills().concat(lib.skill.global)).includes(event.skill) && !event.uncheckHasSkill) {
        const hidden = player.hiddenSkills.slice(0);
        const invisible = player.invisibleSkills.slice(0);
        game.expandSkills(hidden);
        game.expandSkills(invisible);
        if (hidden.includes(event.skill)) {
            if (!info.silent && player.hasSkillTag("nomingzhi", false, null, true)) {
                return;
            } else if ((!info.direct && typeof info.cost !== "function") ||
                       (get.is.locked(event.skill, player) && typeof info.cost == "function")) {
                await event.trigger("triggerHidden");
            } else {
                event.skillHidden = true;
            }
        } else if (invisible.includes(event.skill)) {
            await event.trigger("triggerInvisible");
        } else {
            // 检查 additionalSkills
            let flag = true;
            for (const skill in player.additionalSkills) {
                if (skill.startsWith("hidden:")) continue;
                if (!game.expandSkills(player.additionalSkills[skill]).includes(event.skill)) continue;
                flag = false;
                break;
            }
            if (flag) {
                return;      // ← 确实没有该技能，放弃
            }
        }
    }
    // ...
}
```

**① 技能归属校验**处理三种"隐性持有"：

| 类型 | 说明 |
|------|------|
| `hiddenSkills` | 隐藏技能（未明置） |
| `invisibleSkills` | 不可见技能 |
| `additionalSkills` | 附加技能（前缀 `hidden:` 的除外） |

> 💡 这解释了为什么"技能明明在列表里却不触发" —— 可能是隐藏/不可见状态未满足明置条件。

### ② cost 与 chooseBool 两条路径

```ts
// apps/core/noname/library/element/content.ts:4054-4160（结构）
let result: Partial<Result>;
if (event.revealed || info.forced) {
    result = { bool: true };                    // 强制发动，无需询问
} else {
    const checkFrequent = info => {
        if (player.hasSkillTag("nofrequent", false, event.skill)) return false;
        if (typeof info.frequent == "boolean") return info.frequent;
        if (typeof info.frequent == "function") return info.frequent(trigger, player, event.triggername, event.indexedData);
        if (info.frequent == "check" && typeof info.check == "function") return info.check(trigger, player, event.triggername, event.indexedData);
        return false;
    };

    if (info.direct) {
        // 路径 A：direct —— 直接发动
        if (player.isUnderControl()) {
            game.swapPlayerAuto(player);
        }
        result = { bool: true };
        event._direct = true;
    } else if (typeof info.cost === "function") {
        // 路径 B：有 cost 函数 —— 创建 cost 事件
        if (checkFrequent(info)) event.frequentSkill = true;
        if (player.isUnderControl()) game.swapPlayerAuto(player);
        const next = game.createEvent(`${event.skill}_cost`);
        next.player = player;
        if (event.frequentSkill) next.set("frequentSkill", event.skill);
        next.set("forceDie", true);
        next.set("includeOut", true);
        next._trigger = trigger;
        next.triggername = event.triggername;
        next.skillHidden = event.skillHidden;
        next.indexedData = event.indexedData;
        if (info.forceDie) next.forceDie = true;
        if (info.forceOut) next.includeOut = true;
        next.skill = event.skill;
        next.setContent(info.cost);
        result = await next.forResult();
    } else {
        // 路径 C：无 cost —— 询问是否发动
        if (checkFrequent(info)) event.frequentSkill = true;
        let str;
        const check = info.check;
        if (info.prompt) {
            str = info.prompt;
        } else if (typeof info.logTarget == "string") {
            str = get.prompt(event.skill, trigger[info.logTarget], player);
        } else if (typeof info.logTarget == "function") {
            const logTarget = info.logTarget(trigger, player, event.triggername, event.indexedData);
            if (get.itemtype(logTarget).startsWith("player")) {
                str = get.prompt(event.skill, logTarget, player);
            }
        } else {
            str = get.prompt(event.skill, null, player);
        }
        if (typeof str == "function") {
            str = str(trigger, player, event.triggername, event.indexedData);
        }

        const next = player.chooseBool(str);
        if (event.frequentSkill) next.set("frequentSkill", event.skill);
        next.set("forceDie", true);
        next.set("includeOut", true);
        next.ai = () => !check || check(trigger, player, event.triggername, event.indexedData);

        if (typeof info.prompt2 == "function") {
            next.set("prompt2", info.prompt2(trigger, player, event.triggername, event.indexedData));
        } else if (typeof info.prompt2 == "string") {
            next.set("prompt2", info.prompt2);
        } else if (info.prompt2 != false) {
            if (lib.dynamicTranslate[event.skill]) {
                next.set("prompt2", lib.dynamicTranslate[event.skill](player, event.skill));
            } else if (lib.translate[`${event.skill}_info`]) {
                next.set("prompt2", lib.translate[`${event.skill}_info`]);
            }
        }
        // skillwarn 提示
        if (trigger.skillwarn) { /* ... */ }

        result = await next.forResult();
    }
}
```

**三条路径**：

| 条件 | 路径 | 行为 |
|------|------|------|
| `revealed` 或 `forced` | — | 直接 `{bool: true}`，**不询问** |
| `info.direct` | A | 直接发动，`event._direct = true` |
| `typeof info.cost === "function"` | B | 创建 `${skill}_cost` 事件，由 cost 决定 |
| 其他 | C | `chooseBool` 询问是否发动 |

### ③ 结果判定与取消

```ts
// apps/core/noname/library/element/content.ts:4163-4174
if (result && result.control) {
    result.bool = !result.control.includes("cancel");
}
if (!result || !result.bool) {
    if (info.oncancel) {
        info.oncancel(trigger, player);
    }
    if (event.indexedData === true) {
        event.result = "cancelled";       // ← 供 arrangeTrigger 的取消联动
    }
    return;
}
```

⚠️ **`event.result = "cancelled"`** 正是 `arrangeTrigger` 第 ⑩ 步检查的值，用于取消同技能的后续条目。

### ④ 播报与统计

```ts
// apps/core/noname/library/element/content.ts:4201-4209
if (info.popup != false && !info.direct && !("skill_popup" in result && !result["skill_popup"])) {
    const popup_info = typeof info.popup === "string" ? [event.skill, info.popup] : event.skill;
    const args = [trigger, player, event.triggername, event.indexedData, result];
    player.logSkill(popup_info, info.logLine === false ? false : targets, info.line, null, args);
}
if (info.usable !== undefined) {
    player.getStat("triggerSkill")[event.skill] ??= 0;
    player.getStat("triggerSkill")[event.skill]++;
}
```

### ⑤ 创建技能效果事件

```ts
// apps/core/noname/library/element/content.ts:4211-4226
const next = game.createEvent(event.skill);       // ← 事件名就是技能名
next.player = player;
next._trigger = trigger;
next.triggername = event.triggername;
next.setContent(info.content);
next.skillHidden = event.skillHidden;
if (info.forceDie) next.forceDie = true;
if (info.forceOut) next.includeOut = true;
if (get.itemtype(targets) == "players") {
    next.targets = targets.slice(0);
}
```

**技能效果是一个名为技能名的事件**，content 是 `info.content`。

> 💡 所以调试时看到事件名是技能名（`"jizhi"` 等），说明技能正在结算。

---

## 7. 完整技能定义示例

```js
lib.skill.example = {
    // ① 注册时机
    trigger: {
        player: "phaseDrawBegin",        // 自己是回合主角时
        // source: "damageBegin",         // 自己是伤害来源时
        // global: ["gameStart"],          // 全局时机
    },

    // ② 强制发动（不询问）
    forced: true,

    // ③ 时机优先级（数字越大约先）
    priority: 0,

    // ④ firstDo / lastDo：插到所有玩家之前/之后
    // firstDo: true,
    // lastDo: true,

    // ⑤ 静默发动（不弹提示）
    // silent: true,

    // ⑥ 直接发动，不走 cost
    // direct: true,

    // ⑦ 一次时机多次触发
    getIndex(event, player, triggername) {
        return 1;    // 触发 1 次
    },

    // ⑧ 能否发动（返回 event 用于异步）
    cost: async (event, trigger, player) => {
        // 无 cost 且非 forced 时会自动 chooseBool 询问
    },

    // ⑨ 效果
    content: async (event, trigger, player) => {
        await player.draw(2);
    },

    // ⑩ AI 是否发动（用于 chooseBool 路径）
    check: (trigger, player, triggername, indexedData) => true,

    // ⑪ 提示文本
    prompt: "是否发动【示例】？",
    prompt2: "摸两张牌",

    // ⑫ 取消回调
    oncancel: (trigger, player) => { /* ... */ },

    // ⑬ 允许死亡/出局时触发
    // forceDie: true,
    // forceOut: true,
};
```

---

## 8. 调试要点

| 现象 | 排查方向 |
|------|---------|
| 技能完全不触发 | ① `lib.hookmap[name]` 是否置位（注册是否成功）② `trigger` 角色配置是否匹配 ③ 起始玩家是否找对 |
| 时机触发了但技能没进队列 | `filterTrigger` 是否过滤掉；技能是否真的被玩家拥有 |
| 技能进队列但没发动 | `cost` 返回 false；`chooseBool` 玩家选了否；隐藏技能明置条件不满足 |
| 同优先级技能顺序不对 | `priority`、座次、`firstDo`/`lastDo` |
| 技能发动了但没效果 | 技能 content 报错被吞（联机或 `ignore_error`）；看 `console.error` |

---

## 9. 本篇小结

- **注册**：`lib.hookmap[name]` 是快速索引，`lib.hook[playerid_role_name]` 与 `lib.hook.globalskill[role_name]` 存技能列表
- 四种角色：`player` / `source` / `target` / `global`
- `trigger()` 的 **`hookmap` 检查是第 ⑤ 步**，前面有 `video`/`gameDrawed`/`gameStart` 等前置逻辑
- 收集按**座次遍历**，`firstDo`/`lastDo` 插在队首队尾
- **`tempSkills` 在此处过期清理**
- `arrangeTrigger` 的核心是**优先级剪枝 + 同优先级竞争**，`silent` 或无翻译技能自动优先
- `createTrigger` 创建的事件有 **`forceDie = true` 和 `includeOut = true`**
- 技能发动三条路径：`forced/revealed` → `direct` → `cost` → `chooseBool`
- 技能效果是**名为技能名的事件**，content 为 `info.content`
- 被取消时 `event.result = "cancelled"`，触发同技能后续条目的联动取消

**下一步** → [09-skill-execution.md](09-skill-execution.md)：技能执行的完整链路
