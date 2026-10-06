# 无名杀事件系统 · 自顶向下完整解析

本系列文档从**整体架构**出发，逐层下沉到**具体实现**，系统性还原《无名杀》事件驱动内核的全貌。

所有结论均以当前仓库源码为准，并标注**精确的文件与行号**，可直接对照阅读。

> 源码基线：`apps/core/noname/`，分支 `main`
> 与 `docs/game-event/`（按模块横向切分）互补：本系列强调**纵向主线**与**端到端视角**。

---

## 一、为什么需要这份文档

《无名杀》的核心是**事件系统**。游戏中的一切行为——出牌、技能发动、伤害结算、死亡、阶段推进——都由 `GameEvent` 对象表达并执行。

理解事件系统的难点不在于单个 API，而在于：

1. **没有传统的"游戏主循环"**。`game.loop()` 只启动一个事件，真正的循环藏在事件递归里。
2. **控制反转**。技能不主动调用流程，而是"注册到时机上"，由事件系统在恰当时机回调。
3. **两套 content 写法并存**。旧式 `step`/数组语法与现代 `async` 语法混合，读代码时容易迷失。
4. **静态库与运行时混入**。模式可以在运行时改写 `game`/`ui`/`get`/`ai`。

本文档体系的目标：给出**一条可跟踪的主线**，让读者能回答"此刻游戏在做什么、下一步会做什么"。

---

## 二、文档结构（自顶向下）

分层原则：**上层回答"是什么"，下层回答"怎么做"**。建议按顺序阅读。

### 第 0 层 · 全景

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 00 | [00-overview.md](00-overview.md) | 事件系统在整个游戏中的位置？一次对局的完整生命周期是什么？ |
| 01 | [01-mental-model.md](01-mental-model.md) | 该用什么心智模型理解它？核心抽象有哪些？ |

### 第 1 层 · 主线流程

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 02 | [02-startup-to-game.md](02-startup-to-game.md) | 从 `index.html` 到"游戏开始"，发生了什么？ |
| 03 | [03-game-loop.md](03-game-loop.md) | 没有主循环，对局靠什么持续推进？ |
| 04 | [04-turn-and-phase.md](04-turn-and-phase.md) | 一个回合如何展开？六个阶段如何驱动？ |

### 第 2 层 · 核心机制

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 05 | [05-event-lifecycle.md](05-event-lifecycle.md) | 单个事件从创建到结束，经历哪些状态？ |
| 06 | [06-event-relationships.md](06-event-relationships.md) | 事件之间如何组织？谁等谁？ |
| 07 | [07-content-system.md](07-content-system.md) | content 的三种写法如何统一编译执行？ |
| 08 | [08-trigger-system.md](08-trigger-system.md) | 技能如何"挂"到时机上？如何被收集、排序、执行？ |

### 第 3 层 · 专题深入

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 09 | [09-skill-execution.md](09-skill-execution.md) | 技能从"可发动"到"产生效果"的完整链路？ |
| 10 | [10-results-and-promises.md](10-results-and-promises.md) | 事件结果如何传递？await 一个事件意味着什么？ |
| 11 | [11-pause-and-online.md](11-pause-and-online.md) | 联机模式下事件如何同步？暂停如何实现？ |
| 12 | [12-interruption.md](12-interruption.md) | finish/cancel/untrigger/neutralize 有何区别？ |
| 13 | [13-extending.md](13-extending.md) | 如何编写技能与扩展？有哪些坑？ |

### 第 4 层 · 开发工具链

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 14 | [14-dev-toolchain.md](14-dev-toolchain.md) | 这套工具链（Skill / 检索脚本 / 知识库）是什么？怎么用？为什么这么设计？ |

### 第 5 层 · 界面开发

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 15 | [15-ui-development.md](15-ui-development.md) | 怎么在游戏里做自定义界面？为什么我的界面不显示 / 错位 / 文字挤成一列？ |

### 第 6 层 · 联机开发

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 16 | [16-online-development.md](16-online-development.md) | 联机是怎么跑起来的？大厅/房间/协议怎么工作？我要加一个联机功能该动哪里？ |

### 第 7 层 · 构建与打包

| # | 文档 | 回答的问题 |
|---|------|-----------|
| 17 | [17-build-and-packaging.md](17-build-and-packaging.md) | `pnpm build` 做了什么？`dist/` 怎么拼出来的？**extension 部分怎么处理**？各端安装包怎么来？**沙箱/无权限/断网时怎么打包**？ |
| 18 | [18-android-packaging.md](18-android-packaging.md) | **怎么把游戏打成 APK？** JDK/SDK 环境怎么搭？签名怎么配？为什么构建在 Java 这步就挂了？ |

> 前 13 篇讲**游戏本身的机制**，第 14 篇讲**我们为开发它而造的工具**，
> 第 15 篇讲**界面层实践**（对话框、样式注入、排障方法），
> 第 16 篇讲**联机层**（服务端、协议、房间生命周期、主机客机分工），
> 第 17 篇讲**构建系统**（本体/包体双路径、扩展产物链路、Electron/安卓/SEA 打包、
> CI 产物矩阵、**受限环境与离线打包**），
> 第 18 篇讲**安卓打包实战**（JDK 21 硬校验、Capacitor 同步三件事、`.pnpm` 修补、
> 签名与 debug 回退、SAF 文件模型）。

### 附录

| # | 文档 | 内容 |
|---|------|------|
| A | [appendix-a-source-map.md](appendix-a-source-map.md) | 源码地图：每个关键机制对应的文件与行号 |
| B | [appendix-b-glossary.md](appendix-b-glossary.md) | 术语表：中英对照与速查 |
| C | [appendix-c-pitfalls.md](appendix-c-pitfalls.md) | 易错点与调试技巧 |

### 模板库（可直接复制使用）

| 内容 | 位置 |
|------|------|
| 模板库总览 | [templates/README.md](templates/README.md) |
| 扩展骨架（9 个文件） | [templates/02-info.json](templates/02-info.json) ~ [09-sort.js](templates/09-sort.js) |
| 11 类技能模板 | [templates/templates/README.md](templates/templates/README.md) |

### 开发工具链

| 内容 | 位置 |
|------|------|
| **工具链文档** | [14-dev-toolchain.md](14-dev-toolchain.md) |
| **UI 开发指南** | [15-ui-development.md](15-ui-development.md) |
| **联机开发指南** | [16-online-development.md](16-online-development.md) |
| **构建与打包** | [17-build-and-packaging.md](17-build-and-packaging.md) |
| DSH Skill（自动加载的规范） | `.dsh/skills/noname-general-extension/SKILL.md` |
| 工具使用说明 | `.dsh/skills/noname-general-extension/scripts/README.md` |
| 技能检索引擎 | `scripts/skill-search.mjs`（7206 个技能） |
| 增量知识库 | `scripts/knowledge-base.json`（70 条，带指纹校验） |
| 知识库体检 | `scripts/kb-lint.mjs` |
| 扩展注册工具 | `scripts/register-extension.mjs` |

---

## 三、快速导航

**我想快速上手写技能** → [13-extending.md](13-extending.md) → [08-trigger-system.md](08-trigger-system.md) → [07-content-system.md](07-content-system.md)

**我要调试"技能没触发"** → [08-trigger-system.md](08-trigger-system.md) §收集条件 → [appendix-c-pitfalls.md](appendix-c-pitfalls.md)

**我要理解为什么事件卡住了** → [06-event-relationships.md](06-event-relationships.md) §waitNext → [11-pause-and-online.md](11-pause-and-online.md)

**我要迁移旧代码到 async** → [07-content-system.md](07-content-system.md) §编译链 → [appendix-c-pitfalls.md](appendix-c-pitfalls.md)

**我想了解开发工具链怎么用** → [14-dev-toolchain.md](14-dev-toolchain.md) → `scripts/README.md`

**我要做自定义界面 / 界面不显示或错位** → [15-ui-development.md](15-ui-development.md) §0 三条根本差异 → §2 高度与滚动

**我要做联机功能 / 联机时技能没效果** → [16-online-development.md](16-online-development.md) §0 三条根本认知 → §5 动哪里 → §6 检查清单

**我写完扩展但游戏里看不到** → [14-dev-toolchain.md](14-dev-toolchain.md) §6 扩展注册工具

**我要搞懂构建/打包，或扩展产物为什么会被覆盖** → [17-build-and-packaging.md](17-build-and-packaging.md) §3 → §5.3

**我要打 Windows 安装包 / 打包一路报错（沙箱、无管理员、断网）** → [17-build-and-packaging.md](17-build-and-packaging.md) §10 受限环境与离线打包

**我要打安卓 APK / 卡在 JDK 或 SDK** → [18-android-packaging.md](18-android-packaging.md) §1 前置环境 → §6 排错表

**我只想看懂主线** → 依次读 00 → 01 → 02 → 03 → 04

---

## 四、准确性保证

本系列文档中的**全部 203 处源码行号引用与 131 项技术断言均已逐条对照源码验证**（验证覆盖 `gameEvent.ts`、`GameEventManager.ts`、6 个编译器、`content.ts`、`game/index.js`、`library/index.js`、`PauseManager.ts`）。

其中几条**关键结论**经过了额外的等价模型实测验证：

| 结论 | 说明 |
|------|------|
| `start()` 确实会入栈 | 源码中被注释的手动 `push` 是**等价重构**，`setStatusEvent(this, true)` 内部同样 push；已用等价模型实测确认栈演化为完整祖先路径 |
| `then()` 有 parent 时不启动自身 | 避免了与父事件 `waitNext()` 的重复启动 |
| `clearStepCache()` 无条件整表清空 | `delete this._stepCache` 位于 `if` 之外 |
| ArrayCompiler 的四参数 | 实为 `[event, event._trigger, event.player, event._result]` |
| `_args` 是联机重放载体 | 写入点在 `player.js` 等交互方法（40+ 处），**不在** `createEvent` |

> ⚠️ 特别提示：`docs/game-event/` 下的部分既有文档在这些点上与源码不符（例如称事件栈机制已失效）。本系列以源码为准，并在正文中标注了"源码阅读陷阱"。

---

## 五、阅读约定

文档中的代码引用格式为 `路径:行号`，例如：

```
apps/core/noname/library/element/gameEvent.ts:247
```

术语首次出现时给出中英对照，完整列表见[附录 B](appendix-b-glossary.md)。

标记说明：

- ✅ **推荐** — 当前最佳实践
- ⚠️ **注意** — 容易踩坑或有历史包袱
- 🚫 **废弃** — 已标记待废弃，仅用于理解旧代码
- 🔬 **深入** — 可选的技术细节，跳过不影响主线理解

---

## 六、核心文件速查

| 文件 | 行数 | 职责 |
|------|------|------|
| `noname/library/element/gameEvent.ts` | 1220 | **GameEvent 主类**：生命周期、trigger、事件关系 |
| `noname/library/element/GameEvent/GameEventManager.ts` | 52 | 事件栈管理、`_status.event` 指针 |
| `noname/library/element/GameEvent/compilers/*.ts` | ~350 | content 编译链（4 个编译器） |
| `noname/library/element/content.ts` | 13296 | **所有内置 content 定义**（`arrangeTrigger`、`createTrigger`、`phase`、`phaseLoop` 等） |
| `noname/game/index.js` | 10915 | `createEvent`、`createTrigger` 等游戏级 API |
| `noname/library/element/player.js` | — | `player.phase()`、技能收集与 `tempSkills` 过期判定 |
| `noname/game/PauseManager.ts` | 71 | 暂停/延迟机制 |
| `noname/library/index.js` | 15004 | `lib.message` 主客机消息表、房间初始化、`lib.node` |
| `noname/library/element/client.js` | 104 | 房主侧的客机连接封装 |
| `noname/library/element/nodeWS.js` | 19 | 服务器模式下代表客机的伪 socket |
| `apps/core/mode/connect.js` | 218 | 联机模式入口（地址输入、大厅入口） |
| `packages/server/src/server/createServer.ts` | 433 | **大厅服务器**：房间列表、约战、消息转发 |

详细映射见[附录 A](appendix-a-source-map.md)。
