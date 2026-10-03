# 02 · 从启动到游戏开始

> 本篇回答：**从打开页面到"游戏正式开始"，发生了什么？**
>
> 读完本篇，你应能说清根事件 `"game"` 是如何被创建并执行的。

---

## 1. 启动链路总览

```
index.html
  └─ <script type="module" src="./noname/entry.ts">
      └─ entry.ts
          ├─ 平台分支选择 preload
          ├─ GPL 确认
          └─ boot()                       ← 核心装配
              ├─ 基础环境准备
              ├─ 加载配置
              ├─ 初始化沙箱 / 安全层
              ├─ 导入模式、卡包、武将包、扩展
              ├─ loadMode()：mixin 模式能力
              ├─ ui.create.arena()
              └─ 创建根事件 + game.loop()
```

---

## 2. 入口：entry.ts

```ts
// apps/core/noname/entry.ts:1-6
import { lib, game, get, _status, ui, ai } from "noname";
import { boot } from "@/init/index.js";
import { userAgentLowerCase, device } from "@/util/index.js";
import "core-js-bundle";
import "vue/dist/vue.esm-browser.js";
```

### 平台分支

`preload` 的选择逻辑：

```ts
// apps/core/noname/entry.ts:12-29
const path = "/preload.js";
const { default: preload } = await import(/* @vite-ignore */ path).catch(() => {
    // Electron平台
    if (typeof window.require === "function") {
        return import("./init/node.js");
    } else {
        const isCordovaLike =
            typeof window.cordova !== "undefined" ||
            typeof window.NonameAndroidBridge !== "undefined" ||
            typeof window.noname_shijianInterfaces !== "undefined";

        if (import.meta.env.DEV || typeof lib.device == "undefined" || !isCordovaLike) {
            return import("./init/browser.js");
        } else {
            return import("./init/cordova.js");
        }
    }
});
await preload({ lib, game, get, _status, ui, ai });
```

优先级：`/preload.js` → Electron(`init/node.js`) → 浏览器(`init/browser.js`) → Cordova(`init/cordova.js`)

⚠️ **`isCordovaLike` 判定的意义**（源码注释明确说明）：若无条件走 cordova 分支，普通手机浏览器会请求 `/cordova.js` 并**卡死在 `deviceready`**。这是曾经的线上问题。

### GPL 确认

```ts
// apps/core/noname/entry.ts:33-47
if (!localStorage.getItem("gplv3_noname_alerted")) {
    if (confirm(/* GPLv3 提示文本 */)) {
        localStorage.setItem("gplv3_noname_alerted", String(true));
    } else {
        game.exit();
        return;
    }
}
```

首次运行会有确认框，`localStorage` 记住后不再提示。

### 进入 boot

```ts
// apps/core/noname/entry.ts:49
await boot();
```

---

## 3. boot()：核心装配

`boot()` 位于 `apps/core/noname/init/index.ts`（36.8 KB）。它做四类事：

### ① 基础环境准备

- 导入 polyfill
- 设置加载超时
- 把 `get`/`ui`/`ai`/`game` 挂到 `lib`
- **创建初始事件**：

```js
_status.event = lib.element.GameEvent.initialGameEvent();
```

`initialGameEvent` 是一个**已经 finish 的空事件**，作为事件栈的初始状态：

```ts
// apps/core/noname/library/element/gameEvent.ts:36-40
static initialGameEvent() {
    const event = new GameEvent();
    event.finish();
    return event;
}
```

### ② 加载配置

读取 `lib.config`（本地存档），决定启用哪些包、用哪个模式、触屏/布局设置等。

### ③ 初始化沙箱与安全层

- 初始化沙盒 Realms
- 初始化 `security`
- 设置 `CacheContext` proxy

### ④ 加载内容

```js
importMode(name)
importCardPack(name)
importCharacterPack(name)
importExtension(name)
```

这些函数位于 `apps/core/noname/init/import.ts`。

**重要**：动态 import **只是把模块加载进 `lib.imported`**，不等于已合并到 `lib.skill`/`lib.card`/`game`。

```js
// game.import(type, content) 的效果
lib.imported[type][result.name] = result;
```

例如：

```
lib.imported.mode.identity
lib.imported.character.standard
lib.imported.card.standard
```

---

## 4. loadMode()：把模式能力混入全局

这是**模式系统的核心**。模式不是被"调用"，而是**改写全局对象**：

```js
// apps/core/noname/init/loading.ts（示意）
mixinLibrary(mode, lib);
mixinGeneral(mode, "game", game);
mixinGeneral(mode, "ui", ui);
mixinGeneral(mode, "get", get);
mixinGeneral(mode, "ai", ai);
```

模式可以提供的能力：

| 模式字段 | 作用 |
|---------|------|
| `mode.game` | 扩展 `game` 方法，如 `chooseCharacter` |
| `mode.ui` | 扩展 UI |
| `mode.get` | 扩展查询逻辑 |
| `mode.ai` | 扩展 AI |
| `mode.skill` | 模式专属技能 |
| `mode.translate` | 模式专属翻译 |
| `mode.start` | **模式启动流程（对局主线）** |
| `mode.startBefore` | 根事件创建前的调整机会 |

随后保存 start 供后续使用：

```js
lib.init.start = currentMode.start;
lib.init.startBefore = currentMode.startBefore;
```

> 💡 **这就是为什么不同模式行为差异巨大，却共用同一套事件系统** —— 差异化通过 mixin 注入，而非分支判断。

---

## 5. 加载武将包、卡包、扩展

模式加载后，依次把其余导入内容合并到全局：

```
loadCharacter(imported character packs)   角色技能 → lib.skill
loadCardPile()
loadCard(imported card packs)             牌定义 → lib.card
loadPlay(imported play packs)
loadExtension(enabled extensions)         扩展注入
```

扩展可注入：角色、卡牌、技能、翻译、菜单、预处理逻辑。

---

## 6. 创建根事件 —— 事件系统的起点

```js
// startBefore：给模式在根事件创建前调整环境的机会
if (lib.init.startBefore) {
    lib.init.startBefore();
    delete lib.init.startBefore;
}

ui.create.arena();   // 创建游戏主界面容器

// ★ 关键语句
game.createEvent("game", false).setContent(lib.init.start);

delete lib.init.start;
await _status.onprepare;
game.loop();
```

逐个拆解：

| 语句 | 含义 |
|------|------|
| `createEvent("game", false)` | 创建名为 `"game"` 的根事件；`trigger=false` 表示**不自动触发** `gameBefore`/`gameBegin`/`gameEnd`/`gameAfter` |
| `.setContent(lib.init.start)` | content 是当前模式的 `start` |
| `game.loop()` | 启动事件 |

### 为什么 trigger 传 false

根事件 `"game"` 不对应任何游戏内时机，它只是**承载模式 start 的容器**。若为 `true`，会触发无意义的 `gameBefore` 等时机。

构造函数的处理：

```ts
// apps/core/noname/library/element/gameEvent.ts:20-35
constructor(name: string = "", trigger: boolean = true, manager = _status.eventManager) {
    // ...
    this.name = name;
    this.manager = manager;
    if (trigger && !game.online) {
        this._triggered = 0;      // ← 只有 trigger 为 true 才进入时机流程
    }
    game.globalEventHandlers.addHandlerToEvent(this);
}
```

`_triggered = 0` 是时机状态机的起点。为 `null` 时 `loop()` 会跳过时机阶段直接执行 content。

---

## 7. game.loop() —— 不是主循环

```js
// apps/core/noname/game/index.js（示意）
loop(event = _status.event) {
    if (!event) throw new Error("There is no _status.event when game.loop.");
    return event.start();
}
```

**它只启动当前事件。** 真正的循环在 `phaseLoop` 的 content 里（见 [03](03-game-loop.md)）。

> ⚠️ 这是最常见的误解：`game.loop()` 名字像主循环，实际只是 `event.start()` 的包装。

---

## 8. 模式 start 做了什么

以身份模式 `apps/core/mode/identity.js` 为例，`start` 是**步骤数组**（旧式写法）：

```
设置 _status.mode
处理录像播放（若有）
prepareArena          创建座位与牌堆 UI
新手教程 / 变更日志
选将前处理
game.chooseCharacter()  ★ 选将、分配身份
处理身份显示、主公增强
game.syncState()
event.trigger("gameStart")   ★ 宣告游戏开始
game.addVideo("init")
game.gameDraw(...)     ★ 初始发牌
game.phaseLoop(...)    ★ 进入对局循环
```

关键节点：

| 调用 | 作用 |
|------|------|
| `game.prepareArena()` | `ui.create.players()` + `ui.create.me()` + `ui.create.cardsAsync()` + `game.finishCards()` |
| `game.chooseCharacter()` | 由**模式**提供，差异极大 |
| `event.trigger("gameStart")` | 见下方特殊处理 |
| `game.gameDraw()` | 创建 `gameDraw` 事件发初始手牌 |
| `game.phaseLoop()` | 创建 `phaseLoop` 事件，开始回合循环 |

### gameStart 的特殊处理

`trigger("gameStart")` 不只是广播时机，还有额外副作用：

```ts
// apps/core/noname/library/element/gameEvent.ts:472-486
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
```

从这里开始，运行时认为游戏已正式开始。

---

## 9. 完整时序图

```
浏览器
  │ 加载 index.html
  ▼
entry.ts
  │ 平台分支 → preload
  │ GPL 确认
  ▼
boot()  ────────────────────────────────────────┐
  │ ① polyfill / 单例挂载 / initialGameEvent     │
  │ ② 加载 lib.config                            │
  │ ③ 沙箱 + security                            │
  │ ④ importMode / importCardPack / ...          │
  │ ⑤ loadMode() → mixin game/ui/get/ai          │
  │ ⑥ loadCharacter / loadCard / loadExtension   │
  │ ⑦ startBefore() + ui.create.arena()          │
  └──────────────────────────────────────────────┘
  │
  │ game.createEvent("game", false).setContent(start)
  ▼
game.loop() → event.start()
  │
  ▼
GameEvent.start()                            gameEvent.ts:226
  ├─ parent.childEvents.push(this)            :231
  ├─ game.getGlobalHistory("everything").push(this)  :234
  ├─ manager.setStatusEvent(this, true)       :239  ← 入栈
  ├─ await this.loop()                        :240
  │    └─ content(this)  ← 模式 start         :267
  │         ├─ prepareArena()
  │         ├─ chooseCharacter()
  │         ├─ trigger("gameStart")
  │         ├─ gameDraw()
  │         └─ phaseLoop()  ← ★ 对局循环
  └─ manager.popStatusEvent()                 :242  ← 出栈
```

---

## 10. 本篇小结

- 启动链路：`index.html` → `entry.ts` → 平台分支 → `boot()`
- `boot()` 负责**装配环境**：配置、沙箱、内容导入、模式 mixin
- **模式的本质是改写全局对象**（`game`/`ui`/`get`/`ai`），而非被调用
- 根事件 `"game"` 用 `trigger=false` 创建，content 是模式 start
- **`game.loop()` 只是 `event.start()`，不是主循环**
- 模式 start 主线：`prepareArena` → `chooseCharacter` → `gameStart` → `gameDraw` → `phaseLoop`
- `trigger("gameStart")` 有特殊副作用（设置 `_status.gameStarted`、显示牌堆按钮等）

**下一步** → [03-game-loop.md](03-game-loop.md)：没有主循环，对局靠什么推进
