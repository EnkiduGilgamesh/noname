# 附录 A · 源码地图

> 每个关键机制对应的**精确文件与行号**。便于直接跳转对照。

---

## A.1 GameEvent 主类

文件：`apps/core/noname/library/element/gameEvent.ts`（1220 行）

### 声明与创建

| 行号 | 内容 |
|------|------|
| `19` | `export class GameEvent implements PromiseLike<void>` |
| `20-35` | `constructor(name, trigger, manager)` |
| `31-33` | `if (trigger && !game.online) this._triggered = 0;` |
| `34` | `game.globalEventHandlers.addHandlerToEvent(this)` |
| `36-40` | `static initialGameEvent()` |
| `41-43` | `get [Symbol.toStringTag]()` |

### 事件传参与 content（48-77）

| 行号 | 内容 |
|------|------|
| `49` | `_args: any[] = []` |
| `50` | `_set: [string, any][] = []` |
| `51-68` | `set(key, value)` |
| `69` | `content: EventCompiledContent` |
| `70-76` | `setContent(content)` |

### promise & result（79-135）

| 行号 | 内容 |
|------|------|
| `83` | `result: Partial<Result>` |
| `84` | `cost_data: Result["cost_data"]` |
| `91-93` | **`then()`** ← 有 parent 时不启动自身 |
| `99-101` | `catch()` |
| `108-122` | `finally()` |
| `131-134` | **`forResult()`** |

### 事件关系（137-216）

| 行号 | 内容 |
|------|------|
| `138` | `manager: GameEventManager` |
| `139` | `parent?: GameEvent` |
| `140` | `childEvents: GameEvent[] = []` |
| `149-176` | **`getParent(level, forced, includeSelf)`** |
| `155` | `const toreturn = forced ? undefined : ({} as GameEvent)` ← 反直觉 |
| `166-170` | 联机走 `_modparent` |
| `177-195` | **`next`（Proxy 包装）** |
| `183-187` | 传递 `onNextXxx` handler |
| `188-190` | `#inContent && finished` → `resolve()` |
| `196` | `after: GameEvent[] = []` |
| `197-203` | `insert(content, map)` |
| `204-210` | `insertAfter(content, map)` |
| `211-215` | `_trigger`, `triggername`, `getTrigger()` |

### 事件内部流程（218-335）

| 行号 | 内容 |
|------|------|
| `219` | `_triggered: number \| null = null` |
| `221-225` | `resolve()` |
| `226-246` | **`start()`** |
| `230-244` | ⚠️ 含被注释的旧 push/pop 代码 |
| `239` | `setStatusEvent(this, true)` ← 实际入栈 |
| `242` | `popStatusEvent()` ← 实际出栈 |
| `247-292` | **`loop()`** ← 单事件状态机 |
| `248-254` | 内部 `trigger` 辅助函数 |
| `255-257` | `checkSkipped()` |
| `261-265` | `Before` / `Begin` 触发 |
| `266-276` | 执行 content |
| `278-290` | finished 后的收尾分支 |
| `293-304` | **`checkSkipped()`** |
| `305-334` | **`waitNext()`** |
| `313` | `await _status.pauseManager.waitPause()` ← 唯一暂停点 |

### trigger（337-665）

| 行号 | 内容 |
|------|------|
| `338` | `doingList: triggerPlayerTodo[]` |
| `342` | `_triggering?: GameEvent` |
| `343` | `filterStop?: (this: this) => boolean` |
| `344-430` | **`addTrigger(skills, player)`** |
| `424-426` | 排序逻辑 |
| `431-461` | `removeTrigger(skills, player)` |
| `462-648` | **`trigger(name)`** |
| `463-465` | `_status.video` 短路 |
| `466-468` | `!gameDrawed` 时部分事件不触发 |
| `469-471` | `gameDrawEnd` 置位 |
| `472-486` | `gameStart` 特殊处理 |
| `487-489` | **`lib.hookmap[name]` 检查** |
| `494-496` | `filterStop` |
| `497-503` | 起始玩家查找 |
| `514-576` | `doingList` 与 `addList` |
| `585-621` | **`tempSkills` 过期清理** |
| `623-628` | 四角色收集 |
| `636-647` | 创建 `arrangeTrigger` |
| `650-662` | **`untrigger(all, player)`** |
| `663-664` | `notrigger` / `_notrigger` |

### 事件中断（667-723）

| 行号 | 内容 |
|------|------|
| `671` | `#inContent = false` |
| `672` | `finished = false` |
| `673-675` | **`finish()`** |
| `677-689` | **`cancel(all, player, notrigger)`** |
| `691` | `_neutralized = false` |
| `692-713` | **`neutralize(event)`** |
| `714-722` | **`unneutralize()`** |

### step（725-753）

| 行号 | 内容 |
|------|------|
| `725` | `// #region step @todo` |
| `726` | `#step: number = 0` |
| `727` | `#nextStep: number \| null = null` |
| `731` | `_result: Partial<Result> = {}` |
| `732-737` | `step` getter/setter（setter 只写 pending） |
| `738-744` | **`updateStep()`** |
| `745-748` | `goto(step)` |
| `749-752` | `redo()` |

### chooseToUse 适配（755-936）

| 行号 | 内容 |
|------|------|
| `756-762` | `custom: { add, replace }` |
| `763-904` | **`backup(skill)`** |
| `905-935` | **`restore()`** |
| `855`, `884` | ⚠️ `forced` 覆盖逻辑**被注释** |

### 参数属性（938-966）

| 行号 | 字段 |
|------|------|
| `938` | `type` |
| `939` | `source` |
| `940` | `player` |
| `941` | `players` |
| `942` | `target` |
| `943` | `targets` |
| `944` | `card` |
| `945` | `cards` |
| `946` | `skill` |
| `948` | `forced` |
| `949` | `num` |
| `951` | `directHit` |
| `955` | `nature` |
| `964` | `forceDie` |
| `965` | `includeOut` |

### 实用方法（968-1067）

| 行号 | 内容 |
|------|------|
| `968-972` | `changeToZero()` |
| `973-983` | `setHiddenSkill(skill)` |
| `984-992` | `getLogv()` |
| `994-1017` | **`send()`** |
| `1018-1035` | `sendAsync()` |
| `1037-1051` | **`getRand(name)`** |
| `1052-1054` | `isMine()` |
| `1055-1057` | `isOnline()` |
| `1058-1060` | `notLink()` |
| `1061-1067` | `isPhaseUsing(player)` |

### 缓存（1069-1207）

| 行号 | 内容 |
|------|------|
| `1069` | `// #region cache @todo` |
| `1078-1087` | `callHandler(type, event, option)` |
| `1088-1095` | `getDefaultHandlerType()` |
| `1096-1103` | `getDefaultNextHandlerType()` |
| `1110-1121` | `getHandler(type)` |
| `1125-1130` | `hasHandler(type)` |
| `1146-1149` | `pushHandler(type, ...handlers)` |
| `1152` | `// #region cache @todo` |
| `1153-1159` | `putStepCache(key, value)` |
| `1160-1165` | `getStepCache(key)` |
| `1166-1172` | **`clearStepCache(key)`** ← ⚠️ 无条件整表清空 |
| `1173-1187` | `callFuncUseStepCache(prefix, func, params)` |
| `1188-1197` | `putTempCache(key1, key2, value)` |
| `1198-1206` | `getTempCache(key1, key2)` |

### 待删除验证（1209-1219）

| 行号 | 内容 |
|------|------|
| `1209` | `// #region @todo 待删除验证` |
| `1210` | `_oncancel?` |
| `1211` | `excludeButton: Button[]` |
| `1212-1218` | `resume()` |

---

## A.2 GameEventManager

文件：`apps/core/noname/library/element/GameEvent/GameEventManager.ts`（52 行）

| 行号 | 内容 |
|------|------|
| `10` | `eventStack: GameEvent[] = []` |
| `11` | `rootEvent?: GameEvent` |
| `12` | `tempEvent?: GameEvent` |
| `13-15` | `get event()` |
| `16-18` | `getStartedEvent()` ← 不含 rootEvent |
| `19-21` | **`getStatusEvent()`** ← 含 rootEvent |
| `22-44` | **`setStatusEvent(event, internal)`** |
| `28-32` | 栈空分支 |
| `33-34` | `internal` 分支（**入栈**） |
| `35-36` | 已在栈中 → `tempEvent` |
| `37-39` | 否则抛错 |
| `41-43` | 变更公告 |
| `45-51` | **`popStatusEvent()`** ← 有条件公告 |

---

## A.3 content 编译链

目录：`apps/core/noname/library/element/GameEvent/compilers/`

### ContentCompiler.ts（106 行）

| 行号 | 内容 |
|------|------|
| `10-11` | `#compilerTypes` / `#compilers` |
| `14` | `#compiledContent = new WeakMap()` |
| `26-39` | `addCompiler(compiler)` |
| `49-57` | **`regularize(content)`** |
| `52` | `lib.element.content[content] ?? lib.element.contents[content]` |
| `67-97` | **`compile(content)`** |
| `74` | `regularize` 得到 target |
| `76-80` | 查缓存（**key 是 target**） |
| `82-93` | 责任链遍历 |
| `87-89` | 写入 `compiled` / `type` / `original` |
| `96` | 抛错 |
| `100-104` | **注册顺序：Array → Async → Step** |

### ArrayCompiler.ts（41 行）

| 行号 | 内容 |
|------|------|
| `6` | `type = "array"` |
| `8-10` | `filter` |
| `12-40` | **`compile`** |
| `19-21` | step 初始化 |
| `23-38` | while 循环 |
| `24-27` | **越界保护** |
| `28` | `beforeExecute` |
| `29` | `event.step++` |
| `31` | `isPrevented` 检查 |
| `33` | **`Reflect.apply(original, this, [event, event._trigger, event.player, event._result])`** |
| `35` | `waitNext()` |
| `36` | **`_result = result ?? nextResult ?? event._result`** |
| `37` | `afterExecute` |

### AsyncCompiler.ts（19 行）

| 行号 | 内容 |
|------|------|
| `10` | `type = "async"` |
| `12-14` | `filter`（`instanceof AsyncFunction`） |
| `16-18` | `compile` → 包装为数组 |

### StepCompiler.ts（129 行）

| 行号 | 内容 |
|------|------|
| `12` | `type = "step"` |
| `14-16` | `filter`（非 async/generator） |
| `18-25` | `compile` |
| `31` | `deconstructs` |
| `32` | `topVars` |
| `33` | `params` |
| `48-55` | 构造函数（取沙箱 Function 构造器） |
| `57-62` | `getResult()` |
| `64-91` | **`parseStep()`** |
| `68` | 正则 `\(?['"]step N['"]\)?;?` |
| `76-78` | `stepHead`（step 0 之前的内容） |
| `93-112` | **`packStep(code)`** |
| `114-128` | **`formatFunction(func)`** |
| `116` | 沙箱/非沙箱两条源码获取路径 |

### ContentCompilerBase.ts（82 行）

| 行号 | 内容 |
|------|------|
| `21-26` | **`beforeExecute(event)`** |
| `24` | `callHandler(handlerType, event, {state:"begin"})` |
| `25` | `updateStep()` |
| `36-65` | **`isPrevented(event)`** |
| `39-41` | `phaseLoop` 特例 |
| `46-52` | 死亡分支 |
| `53-56` | 离场分支（含 `roundSkipped` 条件） |
| `57-58` | `removed` 分支 |
| `74-81` | **`afterExecute(event)`** |
| `75` | `clearStepCache(null)` |
| `78` | `callHandler(..., {state:"end"})` |
| `79` | `updateStep()` |

### IContentCompiler.ts（40 行）

| 行号 | 内容 |
|------|------|
| `2-3` | `EventContent` / `EventCompileable` |
| `6-14` | `EventCompiledContent` |
| `22` | `type` |
| `31` | `filter(content)` |
| `39` | `compile(content)` |

---

## A.4 内置 content 定义

文件：`apps/core/noname/library/element/content.ts`（13296 行）

| 行号 | content | 说明 |
|------|---------|------|
| `11-13` | `emptyEvent` | 空事件 |
| `14-113` | `_save` | 濒死求桃 |
| `114+` | `chooseNumbers` | 选数字 |
| `1447` | — | 联机重放 `game[event.name].apply(game, event._args)` |
| `3618` | **`gameDraw`** | 初始发牌 |
| `3766-3818` | **`phaseLoop`** | ★ 对局主循环 |
| `3819-3924` | `loadPackage` | 加载包 |
| `3925-3932` | `loadMode` | 加载模式 |
| `3933-3946` | `forceOver` | 强制结束 |
| `3947-4008` | **`arrangeTrigger`** | ★ 技能竞争与执行 |
| `3960` | — | 优先级剪枝 |
| `3967-3972` | — | 静默技能优先 |
| `3998-4004` | — | 取消联动 |
| `4009-4226+` | **`createTrigger`** | ★ 技能执行 |
| `4012-4044` | — | 技能归属校验 |
| `4055-4056` | — | forced/revealed 路径 |
| `4074-4079` | — | direct 路径 |
| `4080-4108` | — | cost 路径 |
| `4109-4160` | — | chooseBool 路径 |
| `4163-4174` | — | 结果判定 |
| `4201-4205` | — | popup 播报 |
| `4211-4226` | — | 创建设施效果事件 |
| `4593-4856` | **`phase`** | ★ 回合事件（数组 content） |
| `4597` | — | `phaseBefore` |
| `4602` | — | `phaseList` 初始化 |
| `4667` | — | `roundStart` |
| `4672` | — | `phaseBeforeStart` |
| `4676` | — | `phaseBeforeEnd` |
| `4680-4689` | — | 翻面检测 + `cancel()` |
| `4766` | — | `phaseBeginStart` |
| `4771` | — | `phaseBegin` |
| `4774-4784` | — | 阶段入口 / `goto(11)` |
| `4785-4824` | — | 执行当前阶段 |
| `4792-4812` | — | 阶段名语法解析 |
| `4825-4836` | — | `event.num++` |
| `4837-4845` | — | `goto(8)` / `redo()` + `phaseEnd` |
| `4846-4848` | — | `phaseAfter` |
| `4849-4855` | — | 清理 `_status.currentPhase` |
| `4857` | **`phaseZhunbei`** | 准备阶段 |
| `5055` | **`phaseJieshu`** | 结束阶段 |

---

## A.5 游戏级 API

文件：`apps/core/noname/game/index.js`（10915 行）

| 行号 | 内容 |
|------|------|
| `5988-6009` | **`createTrigger(name, skill, player, event, indexedData)`** |
| `5999` | `createEvent("trigger", false)` |
| `6003-6004` | `forceDie = true` / `includeOut = true` |
| `6016-6025` | **`createEvent(name, trigger, triggerEvent)`** |
| `6017` | `new lib.element.GameEvent(...)` |
| `6018` | `getStartedEvent()` 作为默认父事件 |
| `6020` | `parent.next.push(next)` |
| `6316-6359` | **`addGlobalSkill(skill, player)`** |
| `6331-6335` | `lib.hook.globalskill` 与 `lib.hookmap` 置位 |
| `68-139` | `globalEventHandlers`（`_handlers` 二级映射） |

文件：`apps/core/noname/game/PauseManager.ts`（71 行）

| 行号 | 内容 |
|------|------|
| `3-9` | 五个闸门声明 |
| `11-26` | `setDelay(promise)` |
| `28-39` | **`waitPause()`** |
| `42-71` | `class Deferred` |
| `45-47` | `isStarted` |
| `48-53` | `start()` |
| `54-64` | `resolve()` |
| `65-70` | `then()` |

文件：`apps/core/noname/game/promises.js`（211 行）

Promise 化的文件/配置操作 API（`prompt`/`alert`/`readFile`/`writeFile`/`saveConfig`/`checkFile` 等）。

---

## A.6 库与状态

文件：`apps/core/noname/library/index.js`（14709 行）

| 行号 | 内容 |
|------|------|
| `383` | **`hook = { globalskill: {} }`** |
| `458` | `announce` |
| `461` | **`hookmap = {}`** |
| `462-468` | `#relatedTrigger`（`phaseAny`） |
| `469-471` | `get relatedTrigger()` |
| `475` | `imported = {}` |
| `476` | `layoutfixed` |

文件：`apps/core/noname/status/index.js`（186 行）

| 行号 | 内容 |
|------|------|
| `17` | `this.eventManager.setStatusEvent(event)` |
| `113` | `pauseManager = new PauseManager()` |
| `114-153` | `paused` / `paused2` / `paused3` / `over` 属性访问器 |
| `158` | `currentPhase` |
| `163` | `discarded` |

文件：`apps/core/noname/library/element/player.js`

| 行号 | 内容 |
|------|------|
| `5821` | `chooseToUse(params)` |
| `7852` | `draw(params)` |
| `8875` | `damage(params)` |
| `9766` | `judge(params)` |
| 多处 | `next._args = args`（联机重放参数） |

---

## A.7 类型定义

| 文件 | 关键内容 |
|------|---------|
| `apps/core/typings/Skill.d.ts` | `SkillTrigger`（`383`）、`firstDo`（`448`）、`lastDo`（`450`）、`getIndex`（`1485`） |
| `apps/core/typings/Result.d.ts` | `Result` 接口 |
| `apps/core/typings/global.d.ts` | 全局单例类型 |
| `apps/core/typings/NonameHookType.d.ts` | hook 类型 |
| `apps/core/noname/library/element/Player/type.d.ts` | `GainAnimate` 等 |

---

## A.8 官方文档对照

| 本系列 | `docs/game-event/` 对应 |
|--------|------------------------|
| [05](05-event-lifecycle.md) | `lifecycle.md` |
| [06](06-event-relationships.md) | `relationships.md` |
| [07](07-content-system.md) | `content.md` |
| [08](08-trigger-system.md) | `trigger.md` |
| [10](10-results-and-promises.md) | `interaction.md` |
| — | `chooseToUse.md`、`cache.md`、`eventHandlers.md`、`source-mapping.md` |
| [02](02-startup-to-game.md) | `docs/game-startup-flow.md` |
