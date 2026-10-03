# 附录 B · 术语表

> 中英对照与速查。按主题分组。

---

## B.1 事件系统核心

| 术语 | 英文/代码 | 含义 |
|------|----------|------|
| 事件 | `GameEvent` | 携带上下文数据的异步执行单元 |
| 事件树 | event tree | 由 `parent`/`childEvents` 构成的归属结构 |
| 事件栈 | `eventStack` | 当前执行路径，`GameEventManager` 维护 |
| 当前事件 | `_status.event` | 栈顶（或 tempEvent/rootEvent）指向的事件 |
| 根事件 | `rootEvent` | 栈空时的兜底事件 |
| 临时事件 | `tempEvent` | 软切换用的事件指针，不改栈 |
| 父事件 | `parent` | 事件的上级 |
| 子事件 | `childEvents` | 事件的直接下级 |
| 事件队列 | `next` | 串行执行队列（Proxy 包装） |
| 延迟队列 | `after` | 时机全部完成后才执行 |

---

## B.2 生命周期

| 术语 | 代码 | 含义 |
|------|------|------|
| 启动 | `start()` | 入栈 + 执行 `loop()` |
| 事件循环 | `loop()` | 单事件状态机 |
| 等待子事件 | `waitNext()` | 消费 `next` 队列 |
| 时机状态 | `_triggered` | 驱动时机流转的状态值 |
| 结束 | `finish()` | 设 `finished = true` |
| 取消 | `cancel()` | 终止 + 触发 `XXXCancelled` |
| 撤销触发 | `untrigger()` | 置 `_triggered = 5` |
| 无效化 | `neutralize()` | 可逆的事件失效 |
| 跳过 | `checkSkipped()` | 被 `skipList`/`isSkipped` 命中 |
| 内容执行中 | `#inContent` | content 正在运行的标志 |
| 已完成 | `finished` | 事件已结束的标志 |

### `_triggered` 取值

| 值 | 含义 |
|----|------|
| `null` | 不触发时机（`trigger=false` 或联机） |
| `0` | 初始态 |
| `1` | Before 已触发 |
| `2` | Begin 已触发 |
| `3` | End 已触发 |
| `4` | After 已触发 / 终止态 |
| `5` | 被 `untrigger` 强制终止 |

---

## B.3 时机（Trigger）

| 术语 | 代码 | 含义 |
|------|------|------|
| 时机 | trigger timing | 事件生命周期上的可挂载点 |
| 时机名 | triggername | `事件名 + 后缀` |
| 触发 | `trigger(name)` | 广播时机、收集并执行技能 |
| 时机索引 | `lib.hookmap` | `时机名 → true` 的快速索引 |
| 时机表 | `lib.hook` | `玩家ID_角色_时机名 → 技能[]` |
| 全局时机表 | `lib.hook.globalskill` | `角色_时机名 → 技能[]` |
| 时机别名 | `lib.relatedTrigger` | 如 `phaseAny` |
| 技能待办 | `todoList` | 待执行的技能条目 |
| 技能已办 | `doneList` | 已执行的技能条目 |
| 整理触发 | `arrangeTrigger` | 技能竞争与执行的事件 |
| 触发事件 | `createTrigger` | 单个技能的执行事件 |
| 停止判定 | `filterStop` | 中止后续技能的回调 |

### 时机后缀

| 后缀 | 触发点 |
|------|--------|
| `Before` | content 之前（最早） |
| `Begin` | content 之前（稍晚） |
| `End` | finished 之后 |
| `After` | 最后 |
| `Skipped` | 被跳过 |
| `Cancelled` | 被取消 |
| `Omitted` | Before 后被跳过 |
| `Neutralized` | 被无效化 |

### 四角色

| 角色 | 含义 |
|------|------|
| `player` | 事件的 `player` 是自己 |
| `source` | 事件的 `source` 是自己 |
| `target` | 事件的 `target` 是自己 |
| `global` | 任何人触发 |

---

## B.4 Content 编译

| 术语 | 代码 | 含义 |
|------|------|------|
| 内容 | `content` | 事件体 |
| 编译 | `compile()` | 把三种写法统一为异步函数 |
| 编译器 | compiler | Array/Async/Step 三种 |
| 规范化 | `regularize()` | 字符串查表、可迭代转数组 |
| 编译后内容 | `EventCompiledContent` | `(e) => Promise<void>` |
| 步骤 | `step` | 数组 content 的索引 |
| 跳转 | `goto(n)` | 延迟生效的步骤跳转 |
| 重做 | `redo()` | 重入当前步骤 |
| 提交步骤 | `updateStep()` | 把 `#nextStep` 提交为 `#step` |
| 步骤结果 | `_result` | 步骤间的结果传递 |
| 越界保护 | — | `step >= length` 时自动 finish |
| 阻止判定 | `isPrevented()` | 死亡/出局/移除检查 |

---

## B.5 技能

| 术语 | 代码 | 含义 |
|------|------|------|
| 技能 | skill | `lib.skill[id]` |
| 触发技 | trigger skill | 有 `trigger` 字段 |
| 主动技 | enable skill | 有 `enable` 字段 |
| 锁定技 | `forced` | 强制发动 |
| 直接发动 | `direct` | 不播报，直接执行 |
| 静默 | `silent` | 同优先级时优先 |
| 优先级 | `priority` | 时机竞争用，越大越先 |
| 最先/最后 | `firstDo` / `lastDo` | 插到所有玩家前/后 |
| 代价 | `cost` | 能否发动 |
| 效果 | `content` | 发动后的行为 |
| 索引 | `getIndex` | 一次时机多次触发 |
| 检查 | `check` | AI 是否发动 |
| 播报 | `popup` | 技能动画提示 |
| 日志目标 | `logTarget` | 日志中的目标 |
| 死亡可触发 | `forceDie` | 死亡时仍触发 |
| 出局可触发 | `forceOut` | 出局时仍触发 |
| 隐藏技能 | `hiddenSkills` | 未明置的技能 |
| 不可见技能 | `invisibleSkills` | 不可见的技能 |
| 附加技能 | `additionalSkills` | 附加的技能组 |
| 临时技能 | `tempSkills` | 会过期的技能 |

---

## B.6 结果与 Promise

| 术语 | 代码 | 含义 |
|------|------|------|
| 结果 | `result` | 事件的产出 |
| 取结果 | `forResult()` | `await` + 返回 `result` |
| then | `then()` | ⚠️ 有 parent 时不启动自身 |
| 参数 | `_args` | 联机重放的方法参数 |
| 属性集 | `_set` | 通过 `.set()` 设置的属性 |
| 逻辑父事件 | `_modparent` | 联机时的虚拟父事件 |
| 随机数 | `getRand()` | 事件级可重放随机数 |

---

## B.7 暂停与联机

| 术语 | 代码 | 含义 |
|------|------|------|
| 暂停管理 | `PauseManager` | 五个闸门 |
| 暂停点 | `waitPause()` | 在 `waitNext` 中调用 |
| 闸门 | `Deferred` | 可重置的 Promise |
| 通用暂停 | `pause` | `_status.paused` |
| 操作等待 | `pause2` | `_status.paused2` |
| 第三暂停 | `pause3` | `_status.paused3` |
| 结束 | `over` | `_status.over` |
| 延迟 | `delay` | 动画/延迟等待 |
| 本机 | `isMine()` | 是否本机玩家 |
| 联机 | `isOnline()` | 是否联机环境 |

---

## B.8 单例与全局对象

| 名称 | 职责 |
|------|------|
| `lib` | 静态库：技能、卡牌、武将、翻译、配置 |
| `game` | 游戏行为 API |
| `ui` | DOM 创建与交互 |
| `get` | 查询/计算/转换 |
| `ai` | AI 评估 |
| `_status` | 运行时状态 |

### `_status` 常用字段

| 字段 | 含义 |
|------|------|
| `event` | 当前事件 |
| `eventManager` | 事件管理器 |
| `currentPhase` | 当前回合角色 |
| `paused` / `paused2` / `paused3` | 暂停闸门 |
| `over` | 是否结束 |
| `roundStart` | 本轮起始玩家 |
| `gameStarted` | 游戏是否已开始 |
| `gameDrawed` | 是否已发初始牌 |
| `connectMode` | 是否联机 |
| `video` | 录像播放中 |
| `globalHistory` | 全局历史 |

### `lib` 常用字段

| 字段 | 含义 |
|------|------|
| `lib.skill` | 技能定义表 |
| `lib.element.content` | 内置 content 表 |
| `lib.hookmap` | 时机快速索引 |
| `lib.hook` | 时机技能表 |
| `lib.translate` | 翻译表 |
| `lib.phaseName` | 标准阶段名列表 |
| `lib.config` | 玩家配置 |
| `lib.relatedTrigger` | 时机别名 |

---

## B.9 对局流程

| 术语 | 代码 | 含义 |
|------|------|------|
| 对局循环 | `phaseLoop` | 主循环 |
| 回合 | `phase` | 一个玩家的回合 |
| 阶段 | phase | 回合内的细分 |
| 轮 | round | 所有玩家各行动一次 |
| 座次 | seat | `dataset.position` |
| 选将 | `chooseCharacter` | 模式提供 |
| 准备桌面 | `prepareArena` | 创建 UI |
| 初始发牌 | `gameDraw` | 发初始手牌 |
| 游戏开始 | `gameStart` | 时机 |

### 六个标准阶段

| 阶段 | content |
|------|---------|
| 准备阶段 | `phaseZhunbei` |
| 判定阶段 | `phaseJudge` |
| 摸牌阶段 | `phaseDraw` |
| 出牌阶段 | `phaseUse` |
| 弃牌阶段 | `phaseDiscard` |
| 结束阶段 | `phaseJieshu` |

---

## B.10 文档标记约定

| 标记 | 含义 |
|------|------|
| ✅ | 推荐做法 |
| ⚠️ | 容易踩坑或有历史包袱 |
| 🚫 | 已标记待废弃 |
| 🔬 | 可选的技术细节 |
