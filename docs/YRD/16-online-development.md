# 16 · 联机开发指南（大厅 / 房间 / 主机客机）

> 本篇回答：**这套联机是怎么跑起来的？我想加一个联机功能，应该动哪里？为什么我的技能联机就没效果？**
>
> 前 15 篇讲游戏机制与技能/界面开发，本篇讲**联机层**。全部结论对照当前仓库源码，
> 标注精确的 `路径:行号`，可直接跳转。

---

## 0. 三条根本认知（先读这节）

联机开发中绝大多数困惑，都源于下面三点没建立起来：

| 认知 | 含义 | 后果 |
|------|------|------|
| **① 服务端只是"信使"** | 大厅服务器**不跑游戏逻辑**，它只维护房间列表、转发消息 | 不要指望在服务端做校验/结算；一切游戏规则都在主机 |
| **② 主机 = 一台普通单机** | 房主客户端跑完整游戏逻辑，客机只做交互 | 「主机权威」不是设计出来的，是**天然结果** |
| **③ 客机没有事件树** | 客机只重放与自己相关的交互，不存在完整 `GameEvent` 树 | `getParent` 走 `_modparent`，`_triggered` 恒为 `null` |

> 🔬 **一句话总结**：这套联机是 **"主机权威 + 客机重放交互"**，不是状态同步（lockstep / rollback 都不是）。
> 主机把「某个玩家需要做的选择」发下去，客机做完把结果发回来。

**与第 11 篇的分工**：第 11 篇讲的是**事件系统内部**如何配合联机（`PauseManager`、`_modparent`、`_args` 重放、错误吞掉）。
本篇讲**联机这一层本身**：进程拓扑、协议、房间生命周期、以及"我要加联机功能该动哪里"。

---

## 1. 进程拓扑：先看清有几个"角色"

联机里有**四个**角色，很容易混淆前两个：

```
┌──────────────────────────────────────────────────────────────┐
│  ① 大厅服务器 (packages/server)                                │
│     WebSocket :8082，纯信使：房间列表 / 约战 / 转发              │
│     不加载任何游戏代码                                          │
└──────────────────────────────────────────────────────────────┘
        ▲ ws                          ▲ ws
        │                             │
┌───────┴────────┐          ┌─────────┴──────────┐
│ ② 房主 (owner)  │◄────────►│ ③ 客机 (client)     │
│  game.online    │  ws 直连 │  game.online = true │
│    = false      │ 或经服务器│                    │
│  跑全部游戏逻辑  │  转发     │  只做交互           │
│  lib.node 存在  │          │  lib.node 不存在     │
└────────────────┘          └────────────────────┘
```

### ① 大厅服务器：真的只是信使

```ts
// packages/server/src/server/createServer.ts:40-49
export function createServer(options: ServerOptions = {}): ServerInstance {
    const port = options.port ?? 8082;

    const clients = new Map<string, Client>();
    const rooms = new Map<string, Room>();
    const events: EventItem[] = [];
```

服务端只有三张表：`clients`（连接）、`rooms`（房间）、`events`（约战）。
**没有任何 `game` / `lib` / `player` 引用** —— 它不知道你在玩什么。

它提供的全部能力，就是 `handlers` 里那 9 个：

| handler | 作用 |
|---------|------|
| `create` | 建房 |
| `enter` | 进房 |
| `changeAvatar` | 改昵称头像 |
| `key` | 绑定 `onlineKey` |
| `events` | 约战（发起/加入/退出） |
| `config` | 房主同步房间配置 |
| `status` | 大厅状态 |
| `send` | **转发**给房内某客户端 |
| `close` | 断开某客户端 |

### ② 房主：游戏逻辑的唯一持有者

关键判断在 `broadcast`：

```js
// apps/core/noname/game/index.js:1904
if (!lib.node || !lib.node.clients || game.online) {
    return;
}
```

- `lib.node` 存在 → 我是房主（我有一组客机连接）
- `game.online` 为真 → 我是客机（我是"在线的那一个"）

⚠️ **命名陷阱**：`game.online` 的含义是「**我处于客机身份**」，而不是「当前是联机模式」。
判断"是否联机环境"要用 `_status.connectMode`。

### ③ 客机：`lib.node` 为 undefined

客机不维护 `lib.node`，所以 `game.broadcast()` 在客机上是**空操作**（第一行就 return）。
这让同一份技能代码在主客机上走不同分支，而不需要到处写 `if (game.online)`。

⚠️ 注意区分：`lib.node`（**房主**的客机连接集合，对象）与 `lib.configOL`（**房间配置**，主客机都有）。

> ⚠️ **重要陷阱**：`lib.node` **在 Electron / 手机端客机上同样存在**（它不是"房主专属"）。
> 见 §3.1 的说明 —— 判断房主要用 `lib.node?.clients`，不能用 `lib.node`。

### ④ 两种连接拓扑

服务端 `handlers.enter` 里有一句关键代码：

```ts
// packages/server/src/server/createServer.ts:183-185
client.owner = room.owner;
util.sendl(room.owner, "onconnection", client.wsid);
util.updateRooms();
```

之后客机发给服务器的任何消息，都会被转发给房主：

```ts
// packages/server/src/server/createServer.ts:337-341
// forward from slave to owner
if (client.owner) {
    util.sendl(client.owner, "onmessage", client.wsid, raw);
    return;
}
```

于是有两种拓扑：

| 拓扑 | 路径 | 何时使用 |
|------|------|---------|
| **服务器中转** | 客机 → 大厅服务器 → 房主 | 走 `packages/server` 大厅（`game.servermode = true`） |
| **直连房主** | 客机 → 房主（房主自己开了 WS 服务） | 房主自己兼做服务器（`lib.node` + `window.require`，即 Electron 端） |

⚠️ **两条路径的端口不同**：大厅服务器默认 **8082**（`createServer.ts:41`），
而**房主自开的**是 **8080**：

```js
// apps/core/noname/game/index.js:2422-2443
createServer() {
    lib.node.clients = [];
    // ...初始化 clients/banned/observing/torespond/waitForResult...
    lib.playerOL = {};
    lib.cardOL = {};
    lib.vcardOL = {};
    lib.wsOL = {};
    ui.create.roomInfo();
    ui.create.chat();
    if (game.onlineroom) {
        void 0;                                   // ← 走大厅时不重复开端口
    } else {
        const WebSocketServer = require("ws").Server;
        const wss = new WebSocketServer({ port: 8080 });   // ← 房主自开 8080
        game.ip = get.ip();
        wss.on("connection", lib.init.connection);
    }
}
```

> 💡 **`game.createServer()` 才是真正开端口的地方**。
> 下面的「启动服务器」按钮只负责**切模式 / 提示**：

```js
// apps/core/mode/connect.js:29-39
if (lib.node && window.require) {
    ui.startServer = ui.create.system("启动服务器", function (e) { ... }, true);
}
```

⚠️ 该按钮**只在 Electron / 有 `require` 的环境**出现，浏览器端没有。

---

## 2. 消息协议：两张表，一个约定

### 2.1 统一格式

**所有** WS 消息都是 JSON 数组，第一项是**路由名**：

```
["server", handlerName, arg1, arg2, ...]   // 客机 → 服务器/房主
["client", handlerName, arg1, arg2, ...]   // 服务器/房主 → 客机
["exec",   func,      arg1, arg2, ...]     // 特殊：发送一个函数让对端执行
```

客户端发送的实现：

```js
// apps/core/noname/game/index.js:2192-2203
send() {
    if (game.observe && arguments[0] != "reinited") {
        return;
    }
    if (game.ws) {
        const args = Array.from(arguments);
        if (typeof args[0] == "function") {
            args.unshift("exec");
        }
        game.ws.send(JSON.stringify(get.stringifiedResult(args)));
    }
}
```

> 💡 **`exec` 的由来**：如果第一个参数是函数，自动补一个 `"exec"` 路由名。
> 这就是 `game.broadcast(func, ...args)` 能把函数体本身发到客机执行的原理。

### 2.2 接收端：两张消息表

- **`lib.message.server`** — 房主/服务器收到的消息（`apps/core/noname/library/index.js:12298`）
- **`lib.message.client`** — 客机收到的消息（`apps/core/noname/library/index.js:12755`）

客机侧的分发（浏览器 WS）：

```js
// apps/core/noname/library/index.js:10682-10710
onmessage: function (messageevent) {
    if (messageevent.data == "heartbeat") {
        this.send("heartbeat");
        return;
    }
    var message = JSON.parse(messageevent.data);
    if (!Array.isArray(message) || typeof lib.message.client[message[0]] !== "function") {
        throw new Error("err");
    }
    // ...sandbox 处理...
    lib.message.client[message.shift()].apply(null, message);
}
```

房主侧的分发：

```js
// apps/core/noname/library/init/index.js:130-155
ws.on("message", function (messagestr) {
    const message = JSON.parse(messagestr);
    if (!Array.isArray(message) || typeof lib.message.server[message[0]] !== "function") {
        throw new Error("err");
    }
    // ...sandbox 处理...
    lib.message.server[message.shift()].apply(client, message);
});
```

⚠️ **注意 `this` 的差异**：
- `lib.message.server[xxx].apply(client, message)` → `this` 是 **Client 实例**（可 `this.send()`）
- `lib.message.client[xxx].apply(null, message)` → `this` 是 **null**

### 2.3 参数序列化：`stringifiedResult` / `parsedResult`

参数在发送前统一序列化，接收后还原。这样函数、`Player`、`Card` 等对象都能过线：

```js
// 发送端（apps/core/noname/library/element/client.js:60-62）
for (var i = 1; i < args.length; i++) {
    args[i] = get.stringifiedResult(args[i]);
}
```

```js
// 接收端（apps/core/noname/library/init/index.js:141-143）
for (var i = 1; i < message.length; i++) {
    message[i] = get.parsedResult(message[i]);
}
```

> 🔬 序列化发生在**沙箱边界内**（`security.enterSandbox` / `exitSandbox`），
> 因为函数跨沙箱传递需要特殊封送处理。

### 2.4 心跳与超时

服务端每 60 秒探测一次：

```ts
// packages/server/src/server/createServer.ts:315-327
client.heartbeat = setInterval(() => {
    if (client.beat) {
        client.close();          // 上一轮没回，判定掉线
        clearInterval(client.heartbeat);
        return;
    }
    client.beat = true;
    client.send("heartbeat");
}, 60000);
```

客机收到 `"heartbeat"` 字符串（**不是 JSON 数组**）会立刻回 `"heartbeat"`。

新连接还有 2 秒的 `key` 认证窗口，超时即拒：

```ts
// packages/server/src/server/createServer.ts:307-310
client.keyCheck = setTimeout(() => {
    util.sendl(client, "denied", "key");
    setTimeout(() => client.close(), 500);
}, 2000);
```

---

## 3. 关键 API 速查

### 3.1 全局对象

| 标识 | 含义 | 主客机差异 |
|------|------|-----------|
| `game.online` | **我是客机** | 房主 false / 客机 true |
| `game.onlineID` | 我在房间里的 id | 客机有 |
| `game.onlineroom` | 我通过大厅进了房间 | —— |
| `game.onlinehall` | 我在大厅（未进房） | —— |
| `game.onlinezhu` | **房主的** playerid | 房主侧维护 |
| `game.servermode` | 房主跑在大厅服务器上 | 影响重连存储 |
| `game.roomId` | 房间号 | 双方都有 |
| `game.wsid` | 我在服务器上的连接 id | 大厅阶段有 |
| `game.ip` | 显示用的联机地址 | 双方都有 |
| `lib.node` | Node 能力对象（`fs`/`path`） | ⚠️ **Electron/手机端双方都有**；房主判别见下 |
| `lib.node.clients` | **房主**的客机连接数组 | 只有房主有（**判断房主用它**） |
| `lib.configOL` | 房间配置 | 双方都有 |
| `lib.playerOL` | 客机侧 playerid → Player | 客机侧 |
| `lib.cardOL` / `lib.vcardOL` | 客机侧卡牌映射 | 客机侧 |
| `_status.connectMode` | **是否联机环境**（判断用这个） | 双方都 true |

> ⚠️ **`lib.node` 不是"房主标志"** —— 这是 Electron 端最容易踩的坑。
>
> `lib.node` 由 `init/node.js` 在**任何有 `process` 的环境**下设置：
>
> ```js
> // apps/core/noname/init/node.js:60-77
> const versions = window.process.versions;
> const electronVersion = parseFloat(versions.electron);
> lib.node = {
>     fs: require("fs"),
>     path: require("path"),
>     debug() { /* ... */ },
> };
> ```
>
> 所以 **Electron / 手机端客机上 `lib.node` 同样存在**（只是没有 `clients`）。
>
> 正确的房主判别是 `lib.node?.clients` —— 只有调过 `game.createServer()`
> （`game/index.js:2423`）的房主才会建这个数组。`game.broadcast` 用的正是它：
>
> ```js
> // apps/core/noname/game/index.js:1904
> if (!lib.node || !lib.node.clients || game.online) {
>     return;
> }
> ```
>
> 🔬 **注意 `isOnline()` 反过来依赖了 `lib.node`**（`player.js:13349-13354`），
> 这在 Electron 下恰好成立；但在**没有 `lib.node` 的纯浏览器客机**上，
> `isOnline()` 的判断路径不同，跨端行为需留意。

### 3.2 发送类 API

| API | 方向 | 说明 |
|-----|------|------|
| `game.send(...args)` | 客机 → 服务器/房主 | 发到 WS 上 |
| `game.broadcast(func, ...args)` | 房主 → 全部客机 | **只发给客机**，房主自己不执行 |
| `game.broadcastAll(func, ...args)` | 房主 → 全体（含自己） | 先 `broadcast` 再本地执行一次 |
| `player.send(...args)` | 房主 → 指定客机 | 单播，等价于 `player.ws.send(...)` |
| `event.send()` | 房主 → 该事件对应客机 | 见第 11 篇；会 `player.wait()` + `game.pause()` |
| `event.sendAsync()` | 同上，可 `await` | 客机结果通过 `lib.node.waitForResult` 回传 |

**`broadcast` vs `broadcastAll` 的选择依据**：

```js
// apps/core/noname/game/index.js:1924-1935
broadcastAll(func, ...args) {
    if (game.online) {
        return;
    }
    game.broadcast(func, ...args);
    if (typeof func == "string") {
        func = lib.message.client[func];
    }
    if (typeof func == "function") {
        func(...args);
    }
}
```

> ✅ **涉及本地 UI 一律用 `broadcastAll`**（房主自己也要看到效果）。
> ✅ 只是通知客机 → 用 `broadcast`。
> ✅ 传**字符串**会被当成 `lib.message.client` 的键，走"命名消息"（体积小，但要先在表里注册）。

### 3.3 判断类 API

```js
// apps/core/noname/library/element/player.js:13346-13354
isMine() {
    return this == game.me && !_status.auto && !this.isMad() && !game.notMe;
}
isOnline() {
    if (this.ws && lib.node && !this.ws.closed && this.ws.inited && !this.isAuto) {
        return true;
    }
    return false;
}
```

| 方法 | 用途 |
|------|------|
| `player.isMine()` | **是否该在本机弹 UI**（标准方式） |
| `player.isOnline()` | 该玩家是"已就绪的远程玩家" |
| `player.isOnline2()` | 有 ws 且未断（不要求 `inited`） |
| `player.isOffline()` | 有 ws 但已断线 |
| `event.isMine()` / `event.isOnline()` | 转调 player（`gameEvent.ts:1052-1057`） |

⚠️ **`isMine()` 是"要不要弹窗"的唯一正确答案**。用 `game.me == player` 会漏掉托管、发狂等状态。

### 3.4 等待 / 唤醒（房主侧）

房主让客机做选择，本质是 **`player.wait()` + `game.pause()`**，客机回 `result` 后 **`unwait()` + `game.resume()`**：

```js
// apps/core/noname/library/element/player.js:9937-9962
wait(callback) {
    if (lib.node) {
        if (typeof callback == "function") {
            callback._noname_waiting = true;
            lib.node.torespond[this.playerid] = callback;
        } else {
            lib.node.torespond[this.playerid] = "_noname_waiting";
        }
        clearTimeout(lib.node.torespondtimeout[this.playerid]);
        if (this.ws && !this.ws.closed) {
            var time = parseInt(lib.configOL.choose_timeout) * 1000;
            // ...显示计时器...
            lib.node.torespondtimeout[this.playerid] = setTimeout(function () {
                player.unwait("ai");        // 超时自动 AI
                player.ws.ws.close();       // 并踢掉该连接
            }, time + 5000);
        }
    }
}
```

客机回包走 `lib.message.server.result`：

```js
// apps/core/noname/library/index.js:12447-12455
result(result) {
    if (lib.node.observing.includes(this)) {
        return;
    }
    var player = lib.playerOL[this.id];
    if (player) {
        player.unwait(result);
    }
}
```

⚠️ **所有玩家都 `unwait` 完才 `resume`** —— 这是"等所有人选完"的实现：

```js
// apps/core/noname/library/element/player.js:9987-9996
for (var i in lib.node.torespond) {
    if (lib.node.torespond[i] == "_noname_waiting") {
        return;                          // 还有人在选，不恢复
    } else if (lib.node.torespond[i] && lib.node.torespond[i]._noname_waiting) {
        return;
    }
}
_status.event.result = result;
_status.event.resultOL = lib.node.torespond;
lib.node.torespond = {};
```

### 3.5 超时与托管

超时由 `lib.configOL.choose_timeout` 控制（房间配置，不是本机配置）：

```js
// apps/core/noname/game/index.js:2029-2030
} else if (_status.connectMode) {
    num = lib.configOL.choose_timeout;
}
```

| 现象 | 原因 |
|------|------|
| 客机超时后自动出牌 | `player.unwait("ai")` |
| 超时后该客机**掉线** | 紧跟 `player.ws.ws.close()`（`player.js:9959`） |
| 托管玩家 `isOnline()` 为 false | `isOnline()` 里有 `!this.isAuto` |

---

## 4. 房间生命周期

### 4.1 完整时序

```
① 启动 → 选「联机」模式 (mode/connect.js)
      ↓ 输入地址 / 点「联机大厅」
② game.connect(ip)                       game/index.js:2124
      ↓ new WebSocket(url)
③ ws.onmessage("roomlist", events, clients, wsid)   library/index.js:12820
      ↓ 发 key 认证；game.online = true；_status.connectMode = true
      ↓ ui.create.connectRooms(list)     大厅：房间列表
④ 建房: send("server","create", ...)      或 加入: send("server","enter", ...)
      ↓
⑤ 服务端 create/enter → 回 "createroom" 或通知房主 "onconnection"
      ↓
⑥ 客机侧进入 "init" 分支                   library/index.js:13087
      game.online = true; lib.playerOL = {}; ui.create.connectPlayers(ip)
      ↓
⑦ 房主点「开始游戏」→ send("startGame")   ui/create/index.js:3673
      ↓ 房主 resume() → lib.init.startOnline
⑧ 游戏循环开始
```

### 4.2 大厅阶段：`roomlist`

服务器连上就推一次全量：

```ts
// packages/server/src/server/createServer.ts:312
util.sendl(client, "roomlist", util.buildRoomList(), util.checkEvents(), util.buildClientList(), client.wsid);
```

客机收到后立即做 `key` 认证，并把自己切进"联机状态"：

```js
// apps/core/noname/library/index.js:12820-12831
roomlist: function (list, events, clients, wsid) {
    game.send("server", "key", [game.onlineKey, lib.version]);
    game.online = true;
    game.onlinehall = true;
    lib.config.recentIP.remove(_status.ip);
    lib.config.recentIP.unshift(_status.ip);
    // ...
    _status.connectMode = true;
```

> ⚠️ 注意这一步就设了 `game.online = true` —— **在大厅里就已经是"客机身份"**。
> 所以 `game.broadcast` 在大厅里也是空操作，这是对的。

`onlineKey` 是玩家的持久身份（存在 `localStorage`），用于封禁与重连：

```js
// apps/core/mode/connect.js:207-213
if (!game.onlineKey) {
    game.onlineKey = localStorage.getItem(lib.configprefix + "key");
    if (!game.onlineKey) {
        game.onlineKey = get.id();
        localStorage.setItem(lib.configprefix + "key", game.onlineKey);
    }
}
```

### 4.3 建房：房间配置由房主定义

房主建房后，服务器把房间挂进 `rooms`：

```ts
// packages/server/src/server/createServer.ts:152-166
create(client, key, nickname, avatar, config, mode) {
    if (client.onlineKey !== key) return;
    client.nickname = util.nickname(nickname);
    client.avatar = avatar;
    const room: Room = { key, owner: client };
    rooms.set(key, room);
    client.room = room;
    delete client.status;
    util.sendl(client, "createroom", key);
    util.updateRooms();
}
```

房主改配置时同步给服务器，服务器再广播房间列表：

```ts
// packages/server/src/server/createServer.ts:259-268
config(client, config) {
    const room = client.room;
    if (!room || room.owner !== client) return;
    if (room.servermode) {
        room.servermode = false;
    }
    room.config = config;
    util.updateRooms();
}
```

> 💡 **`lib.configOL` 是"房间配置"**，它是**房主本机配置的一个子集快照**，
> 由 `init` 消息带给每个客机（`library/index.js:12426`）。它决定：
> 模式、人数、`choose_timeout`、观战开关、禁将等。
>
> ⚠️ 写联机功能时，**影响一致性的参数必须放进 `lib.configOL`**，不能用本机 `lib.config`。

### 4.4 加入房间：服务端的准入检查

`enter` 里有完整的前置校验（`createServer.ts:168-186`）：

| 检查 | 失败响应 |
|------|---------|
| 房间不存在 | `enterroomfailed` |
| 无房主 | `enterroomfailed` |
| 游戏已开始且不允许观战 | `enterroomfailed` |

而房主侧的 `init` 还有一轮**更细的**校验（`library/index.js:12313-12427`）：

| 检查 | 结果 |
|------|------|
| `onlineKey` 在黑名单 | `denied: "banned"` |
| id 已在 `lib.playerOL`（重连） | 走 `reinit` 重连分支 |
| `version != lib.versionOL` | `denied: "version"` |
| 禁止扩展且开了扩展 | `denied: "extension"` |
| 游戏进行中且有观战位 | 加入 `lib.node.observing`，成为**观战者** |
| 游戏进行中且无观战位 | `denied: "gaming"` |
| 人数已满 | `denied: "number"` |
| 正常 | 分配座位 → `init` |

⚠️ **观战者是一个独立集合** `lib.node.observing`。
`lib.message.server` 里**每个** handler 开头几乎都有：

```js
if (lib.node.observing.includes(this)) {
    return;
}
```

> 🔬 **新增 server handler 时，务必加上这个判断**，否则观战者能操纵游戏。

### 4.5 重连

服务端一进来就带 `reconnect_info` 尝试复位：

```js
// apps/core/noname/mode/connect.js:67-77
game.connect(ip, function (success) {
    if (success) {
        var info = lib.config.reconnect_info;
        if (info && info[0] == _status.ip) {
            game.onlineID = info[1];
            if (typeof (game.roomId = info[2]) == "string") {
                game.roomIdServer = true;
            }
        }
        return;
    }
    // ...失败弹窗...
});
```

房主侧看到 `config.id` 已存在，就判定为重连而非新玩家：

```js
// apps/core/noname/library/index.js:12330-12349
} else if (config.id && lib.playerOL && lib.playerOL[config.id]) {
    var player = lib.playerOL[config.id];
    player.setNickname();
    player.ws = this;
    player.isAuto = false;
    this.id = config.id;
    game.broadcast(function (player) {
        player.setNickname();
    }, player);
    this.send("reinit", lib.configOL, get.arenaState(), game.getState ? game.getState() : {},
              game.ip, null, _status.onreconnect, _status.cardtag, _status.postReconnect);
}
```

⚠️ 重连要恢复的东西全在这条 `reinit` 里：**房间配置、竞技场状态、游戏状态、卡牌标签、重连钩子**。
如果你加了新的全局状态，**必须挂到 `getState()` 或 `_status.onreconnect` 上**，否则重连后丢失。

### 4.6 断线与退出

房主侧 `Client.close()`：

```js
// apps/core/noname/library/element/client.js:74-103
close() {
    lib.node.clients.remove(this);
    lib.node.observing.remove(this);
    // ...
    if (_status.waitingForPlayer) {
        for (var i = 0; i < game.connectPlayers.length; i++) {
            if (game.connectPlayers[i].playerid == this.id) {
                game.connectPlayers[i].uninitOL();
                delete game.connectPlayers[i].playerid;
            }
        }
        if (game.onlinezhu == this.id) {
            game.onlinezhu = null;
        }
        game.updateWaiting();
    } else if (lib.playerOL[this.id]) {
        var player = lib.playerOL[this.id];
        player.setNickname(player.nickname + " - 离线");
        game.broadcast(function (player) {
            player.setNickname(player.nickname + " - 离线");
        }, player);
        player.unwait("ai");           // 关键：让等待中的流程继续
    }
}
```

> ⚠️ **`player.unwait("ai")` 是防卡死的关键**。玩家掉线时若不唤醒，
> 主机会永远停在 `waitPause()`。写联机交互时务必确认掉线路径能唤醒。

服务端房主掉线时，会通知房内所有人 `selfclose`：

```ts
// packages/server/src/server/createServer.ts:366-376
rooms.forEach((room, key) => {
    if (room.owner === client) {
        clients.forEach(c => {
            if (c.room === room && c !== client) {
                util.sendl(c, "selfclose");
            }
        });
        rooms.delete(key);
    }
});
```

---

## 5. 联机模式开发：动哪里

### 5.1 目录职责

| 路径 | 职责 | 什么时候动 |
|------|------|-----------|
| `packages/server/src/server/createServer.ts` | 大厅服务器 | 改协议、加大厅功能 |
| `apps/core/mode/connect.js` | 「联机」模式入口 + 地址输入界面 | 改连接 UI |
| `apps/core/noname/library/index.js` | **`lib.message` 两张表 + 房间初始化** | **加自定义消息（最常见）** |
| `apps/core/noname/library/init/index.js` | `connection()` 建 Client、`startOnline` | 改握手、开局流程 |
| `apps/core/noname/library/element/client.js` | 房主侧 `Client` 封装 | 改发送/关闭行为 |
| `apps/core/noname/library/element/nodeWS.js` | 房主在**服务器模式**下代表客机 | —— |
| `apps/core/noname/game/index.js` | `connect`/`broadcast`/`countChoose` | 改连接与广播 |
| `apps/core/noname/ui/create/index.js` | `connectPlayers` / `connectRooms` | 改等待界面 |

### 5.2 加一条自定义消息（标准流程）

假设要加一个"客机请求看牌堆"的功能。

**第 1 步 · 注册处理器**（`lib.message.server`，`library/index.js:12298` 起）：

```js
// lib.message.server 内
showPile() {
    // this 是 Client 实例
    if (lib.node.observing.includes(this)) {
        return;                                  // ← 必须：拦观战者
    }
    if (!_status.waitingForPlayer) {             // ← 必须：只在合法阶段
        return;
    }
    const player = lib.playerOL[this.id];
    if (!player) {
        return;
    }
    this.send("pileData", ui.cardPile.childElementCount);
},
```

**第 2 步 · 注册客户端响应**（`lib.message.client`，`library/index.js:12755` 起）：

```js
// lib.message.client 内（注意 this 为 null，用箭头函数或纯参数）
pileData: (count) => {
    game.alert(`牌堆剩余 ${count} 张`);
},
```

**第 3 步 · 客机发起**：

```js
game.send("server", "showPile");
```

> ✅ 顺序无所谓（两张表都是对象字面量），但**名字必须一致**。
> ✅ 返回值不需要回调就别开 `dataSync`，`send` 单向足够。

### 5.3 需要返回值：`dataSync` 模式

如果要"请求-响应"，用现成的 `dataSync`（`library/index.js:12683-12721`）：

```js
// 客机发起（走 game.send，服务端/房主会回 dataReply）
// 房主侧在 switch 里加分支：
switch (type) {
    case "skill":
        directResult = await game.respondSkillData(id, requester, subject);
        break;
    // 新增类型加在这里
}
```

⚠️ 注释明确写着「**如果要增加类型请走这里**」。
`dataSync` 自带：观战过滤、请求方校验、`{ ok, id, result }` 响应封装。

### 5.4 沙箱与安全

联机消息跨沙箱传递，接收端会进出沙箱：

```js
// apps/core/noname/library/init/index.js:137-148
if (client.sandbox) {
    security.enterSandbox(client.sandbox);
}
try {
    for (var i = 1; i < message.length; i++) {
        message[i] = get.parsedResult(message[i]);
    }
} finally {
    if (client.sandbox) {
        security.exitSandbox();
    }
}
```

房主执行客机发来的函数时，还要正确计算调用栈层级：

```js
// apps/core/noname/library/index.js:13603-13617
exec: function (func) {
    const key = game.onlineKey;
    if (typeof func == "function") {
        const isMarshalled = security.isSandboxRequired() && security.importSandbox().Domain.current.isFrom(func);
        // 被封送的函数额外间隔了四层调用栈
        const level = isMarshalled ? 4 : 0;
        const args = Array.from(arguments).slice(1);
        ErrorManager.errorHandle(() => {
            func.apply(this, args);
        }, func, level);
    }
    // ...
}
```

⚠️ **`exec` 是最大的攻击面**。它执行客机传来的任意函数。
不要轻易扩展 `exec` 的可用能力；有明确用途时**优先加具名 handler**，而不是让客机传函数上来。

### 5.5 服务器模式下的 `NodeWS`

房主跑在**大厅服务器**里时（`game.servermode`），它并不直接持有客机 socket，
而是通过 `NodeWS` 把操作转发给服务器：

```js
// apps/core/noname/library/element/nodeWS.js:10-18
send(message) {
    game.send("server", "send", this.wsid, message);
}
close() {
    game.send("server", "close", this.wsid);
}
```

对应服务端：

```ts
// packages/server/src/server/createServer.ts:276-290
send(client, id, message) {
    const target = clients.get(id);
    if (target && target.owner === client) {      // ← 只能发给自己房里的
        try {
            target.send(message);
        } catch {
            target.close();
        }
    }
},
close(client, id) {
    const target = clients.get(id);
    if (target && target.owner === client) target.close();
},
```

> ✅ 所以 `Client` 的 `ws` 字段在主客机场景下可能是两种东西：
> 真实 `WebSocket`（直连）或 `NodeWS`（服务器模式）。**两者接口一致**（`send`/`close`/`on`）。

---

## 6. 写联机技能 / 联机功能的检查清单

### 6.1 必须做

| # | 事项 | 原因 |
|---|------|------|
| 1 | 弹 UI 前判 `event.isMine()` | 否则弹到错误的客户端 |
| 2 | 用 `event.getRand()` 而非 `Math.random()` | 否则录像/重放不一致 |
| 3 | 影响一致性的参数放 `lib.configOL` | 否则客机读不到 |
| 4 | 新 server handler 加观战过滤 | `lib.node.observing` |
| 5 | 所有等待路径都要有唤醒出口 | 掉线/超时 → `unwait("ai")` |
| 6 | 涉及本地 UI 用 `broadcastAll` | 房主自己也要执行 |
| 7 | 新的全局状态挂到 `getState()` / `onreconnect` | 否则重连丢失 |

### 6.2 绝对不要做

| # | 反例 | 后果 |
|---|------|------|
| 1 | 在客机上调用 `game.broadcast` | 静默无效（第一行 return） |
| 2 | 用 `game.online` 判断"是否联机" | 语义是"我是客机"；该用 `_status.connectMode` |
| 3 | 客机依赖完整事件树 | 客机没有；`getParent` 走 `_modparent` |
| 4 | 用 `Math.random()` 决定游戏结果 | 主客机不一致 |
| 5 | 直接用 `game.me` 判断"玩家自己" | 漏掉托管/发狂；该用 `isMine()` |
| 6 | 在服务器端写游戏规则校验 | 服务器没有游戏代码 |

### 6.3 联机特有现象速查

| 现象 | 根因 | 见 |
|------|------|-----|
| 技能静默失效，控制台有报错 | 联机非 debug 吞掉 content 错误 | 第 11 篇 §5 |
| 客机上技能"没反应" | 客机不走时机流程（`_triggered` 恒 `null`） | 第 11 篇 §5 |
| 弹窗出现在别人屏幕上 | 漏了 `isMine()` | 本篇 §3.3 |
| 游戏卡住不继续 | `waitPause()` 未释放 / 玩家未 `unwait` | 第 11 篇 §2、本篇 §3.4 |
| 两边随机结果不同 | 用了 `Math.random()` | 第 11 篇 §6 |
| 观战者能操作游戏 | 新 handler 漏了 `observing` 判断 | 本篇 §4.4 |
| 重连后某个状态丢了 | 没挂到 `getState()` / `onreconnect` | 本篇 §4.5 |
| 房主掉线全员重载 | 服务器发 `selfclose` | 本篇 §4.6 |

---

## 7. 调试与自测

### 7.1 本地开一个联机环境

```bash
# 方式一：独立大厅服务器
cd packages/server
pnpm dev                      # 默认 :8082，或 --port/-p 指定

# 方式二：游戏内（仅 Electron，有 window.require 时）
# 「联机」模式 → 右上角「启动服务器」
```

然后在游戏内：**开始 → 联机 → 地址填 `localhost:8082` → 连接**。

> 参考 `docs/how-to-start.md` 中「如何在本地开启联机服务器」。

### 7.2 最小可复现环境

```text
终端 A: pnpm dev            (大厅服务器)
窗口 1: 游戏 → 联机 → localhost:8082 → 创建房间
窗口 2: 游戏 → 联机 → localhost:8082 → 进入房间
```

⚠️ 两个窗口要用**不同的 `onlineKey`**。用浏览器无痕窗口，或清掉
`localStorage` 里的 `noname_key`（`lib.configprefix + "key"`）。

### 7.3 常用调试手段

```js
// 我是什么身份？
game.online          // true = 我是客机
lib.node             // 存在 = 我是房主
_status.connectMode  // true = 联机环境

// 房间与玩家
game.roomId
Object.keys(lib.playerOL || {})     // 客机侧玩家表
game.connectPlayers                  // 房主侧等待界面

// 等待状态（房主）
lib.node.torespond             // { playerid: "_noname_waiting" | result }
lib.node.torespondtimeout      // 超时定时器
lib.node.observing             // 观战者

// 连接状态（客机）
game.ws
lib.config.reconnect_info
```

### 7.4 排障顺序

1. **看控制台 `console.error`** —— 联机吞错，这是唯一线索。
2. **确认是谁的问题**：在主机和客机都打一行 `console.log(game.online, ...)`。
3. **确认有没有发出去**：在 `game.send` / `client.send` 打断点或加日志。
4. **确认 handler 名对得上**：`lib.message.server` / `client` 两张表都查一遍。
5. **确认有没有卡在等待**：房主看 `lib.node.torespond` 是否还有 `"_noname_waiting"`。

---

## 8. 本篇小结

**架构**

- 四个角色：**大厅服务器**（纯信使）、**房主**（跑全部逻辑）、**客机**（只做交互）、**观战者**（只读）
- 判断身份：`game.online` = 我是客机；`_status.connectMode` = 联机环境；
  房主要用 **`lib.node?.clients`** 判断（⚠️ 不能用 `lib.node`，见 §3.1）
- 两种拓扑：**服务器中转**（默认）与**直连房主**（Electron 启动服务器）

**协议**

- 消息一律 `[路由名, handler, ...args]`；`"exec"` 是"发函数过去执行"的特殊路由
- 两张表：`lib.message.server`（`this` 是 Client）与 `lib.message.client`（`this` 是 null）
- 参数进出都要 `stringifiedResult` / `parsedResult`，且发生在沙箱边界内
- 心跳 60s，`key` 认证窗口 2s

**生命周期**

- 大厅：`roomlist` → `key` 认证 → `game.online = true` + `_status.connectMode = true`
- 房间：服务端做粗校验（存在/满员/已开局），房主侧 `init` 做细校验（版本/黑名单/扩展/观战）
- 配置：`lib.configOL` 是房间配置，**影响一致性的参数必须放这里**
- 重连：走 `reinit`，恢复 `configOL + arenaState + getState() + cardtag + onreconnect`
- 掉线：`Client.close()` → `player.unwait("ai")`，**这是防卡死的关键**

**开发**

- 加功能最常见的位置是 **`lib.message` 两张表**；请求-响应走 `dataSync`
- 新 server handler 必加 `lib.node.observing` 过滤
- 弹 UI 必判 `isMine()`；随机数必用 `getRand()`；本地 UI 必用 `broadcastAll`
- `exec` 是最大攻击面，优先用具名 handler

---

## 附：源码地图

| 机制 | 文件 | 行号 |
|------|------|------|
| 服务端 handlers | `packages/server/src/server/createServer.ts` | `151-291` |
| 服务端连接/心跳/转发 | `packages/server/src/server/createServer.ts` | `293-386` |
| 服务端建房/进房 | `packages/server/src/server/createServer.ts` | `152-186` |
| `game.connect` | `apps/core/noname/game/index.js` | `2124-2191` |
| `game.send` | `apps/core/noname/game/index.js` | `2192-2203` |
| `game.broadcast` / `broadcastAll` | `apps/core/noname/game/index.js` | `1903-1935` |
| `game.countChoose` | `apps/core/noname/game/index.js` | `2014-2092` |
| `lib.message.server` | `apps/core/noname/library/index.js` | `12298-12754` |
| `lib.message.client` | `apps/core/noname/library/index.js` | `12755-...` |
| 房主 `init` 准入校验 | `apps/core/noname/library/index.js` | `12313-12427` |
| `lib.message.server.result` | `apps/core/noname/library/index.js` | `12447-12455` |
| `dataSync` | `apps/core/noname/library/index.js` | `12683-12721` |
| 客机 `init` / `reinit` | `apps/core/noname/library/index.js` | `13087-13300+` |
| `connection()` 建 Client | `apps/core/noname/library/init/index.js` | `127-160` |
| `startOnline` | `apps/core/noname/library/init/index.js` | `79-94` |
| `Client` 类 | `apps/core/noname/library/element/client.js` | `16-104` |
| `NodeWS` | `apps/core/noname/library/element/nodeWS.js` | `3-19` |
| WS 事件回调 | `apps/core/noname/library/index.js` | `10675-10745` |
| `player.wait` / `unwait` | `apps/core/noname/library/element/player.js` | `9937-10020` |
| `player.isMine` / `isOnline` | `apps/core/noname/library/element/player.js` | `13346-13366` |
| `ui.create.connectPlayers` | `apps/core/noname/ui/create/index.js` | `3650-3757` |
| `ui.create.connectRooms` | `apps/core/noname/ui/create/index.js` | `527-544` |
| 联机模式入口 | `apps/core/mode/connect.js` | `1-218` |
| `denied` 处理 | `apps/core/noname/library/index.js` | `13623-13666` |

**相关文档**

- 事件系统内部如何配合联机 → [11-pause-and-online.md](11-pause-and-online.md)
- 事件结果与 `_args` 重放 → [10-results-and-promises.md](10-results-and-promises.md)
- 联机常见坑汇总 → [appendix-c-pitfalls.md](appendix-c-pitfalls.md) §C.9
- 本地联机环境搭建 → `docs/how-to-start.md`
