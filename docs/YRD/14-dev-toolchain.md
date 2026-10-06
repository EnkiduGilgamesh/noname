# 14 · 扩展开发工具链

> 本篇记录一套**为《无名杀》武将扩展开发而构建的工具链**：DSH Skill、检索脚本、增量知识库。
>
> 与前面 13 篇的区别：前 13 篇讲**游戏本身的机制**，本篇讲**我们为开发它而造的工具**。

---

## 1. 这套工具解决什么问题

在 7206 个已有技能中开发新武将，会反复遇到四类摩擦：

| # | 问题 | 后果 | 解决方式 |
|---|------|------|---------|
| ① | 已有 7206 个技能，找不到可参考的实现 | 从零编写，重复造轮子 | **技能检索引擎** |
| ② | 每次检索的结论无法沉淀 | 周而复始地重复检索 | **增量知识库** |
| ③ | 知识可能过时 | 拿着失效结论写代码 | **证据指纹校验** |
| ④ | 写完扩展游戏里看不到 | 以为代码错了，反复排查 | **扩展注册工具** |

工具链的目标：**让每一次开发都比上一次更快、更准**。

---

## 2. 工具链总览

```
.dsh/skills/noname-general-extension/
├── SKILL.md                    ← DSH 自动加载的开发规范（入口）
└── scripts/
    ├── skill-search.mjs        ← 检索引擎 + 知识库 CLI（26.5 KB）
    ├── knowledge.mjs           ← 知识库模块：指纹计算与校验（8 KB）
    ├── build-index.mjs         ← 索引构建器（11.8 KB）
    ├── register-extension.mjs  ← 扩展注册与修复（17.5 KB）
    ├── knowledge-base.json     ← 知识库数据（13 条，入库）
    ├── skill-index.json        ← 索引产物（4 MB，不入库）
    └── README.md               ← 工具使用说明（7.9 KB）

docs/YRD/templates/             ← 配套模板库（21 个文件）
├── 02-info.json ~ 09-sort.js   ← 扩展骨架（9 个可直接复制）
└── templates/01 ~ 11           ← 11 类技能模板
```

### 四者关系

```
                    ┌─────────────────────┐
                    │      SKILL.md       │  工作流入口
                    │  （DSH 自动加载）    │
                    └──────────┬──────────┘
                               │ 指引
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ skill-search │  │  knowledge   │  │  register-   │
    │   .mjs       │◄─┤    .mjs      │  │  extension   │
    │  检索引擎     │  │  知识库      │  │    .mjs      │
    └──────┬───────┘  └──────────────┘  └──────────────┘
           │ 查询                            ▲ 注册
           ▼                                 │
    ┌──────────────┐                  ┌──────────────┐
    │skill-index   │                  │  扩展目录     │
    │  .json       │                  │ (apps/core/  │
    │（7206 技能） │                  │  extension/) │
    └──────────────┘                  └──────────────┘
```

---

## 3. DSH Skill

### 3.1 定位

**Skill 不是可执行插件**。我核实过 DSH 的机制：`dsh-skill` 只负责把 `SKILL.md` 的内容作为**指令文本**注入模型上下文，Skill **无法自行注册工具**。

但那句 `<skill_resources>` 提示写着 *"scripts, references, and assets load on demand"* —— 这就是可行路径：

> **Skill 提供规范与指引，脚本提供可执行能力，模型通过 `pwsh` 调用脚本。**

### 3.2 位置与发现机制

Skill 的发现路径（源码 `dsh-skill-filesystem/lib/index.js:150-187`）：

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 高 | `<项目根>/.dsh/skills/` | **本项目使用的位置** |
| | `<项目根>/.agents/skills/` | 备选 |
| | `~/.dsh/skills/` | 用户级 |
| 低 | 内置 bundle | 随 DSH 分发 |

放在**项目内**的好处：随项目走，可提交到仓库，团队共享。

### 3.3 文件格式

```markdown
---
name: noname-general-extension
description: 开发《无名杀》武将扩展、编写武将技能，或在已有技能中查找参考实现。
             当用户要求新增/修改武将、编写技能…时使用。内含增量知识库（带源码指纹校验）、
             技能检索引擎（7206 个技能）、扩展骨架、11 类技能模板、API 速查与避坑清单。
---

# 开发《无名杀》武将扩展
（正文：工作流、规范、避坑清单）
```

⚠️ **`description` 决定 Skill 何时被激活**——必须写清"何时使用"，包含足够的关键词。

### 3.4 定义的工作流

```
1. 明确需求
2. 🔍 检索         —— skill-search search（自动先查知识库）
3. 📘 沉淀结论     —— skill-search learn（开发后必做）
4. 查模板          —— docs/YRD/templates/
5. 查文档          —— docs/YRD/
6. 写代码
7. 🔧 注册扩展     —— register-extension fix / guideall
8. 验证
```

> **步骤 2 与步骤 3 是这套工具链的核心循环**：检索 → 沉淀 → 下次更快。

---

## 4. 技能检索引擎

### 4.1 索引构建

`build-index.mjs` 解析项目内全部技能定义，产出 `skill-index.json`。

**扫描范围**：

| 目录 | 内容 | 技能数 |
|------|------|--------|
| `apps/core/character/` | 本体武将包（26 个） | 5851 |
| `apps/core/extension/` | 扩展（含武将的） | 1299 |
| `apps/core/noname/library/` | 本体内置技能 | 56 |
| **合计** | | **7206**（6109 含描述，84.8%） |

**解析策略**——基于对全库形态的统计验证：

```
顶层技能：1 个 Tab 缩进 + `name: {`
子技能：  2 个 Tab 缩进
```

用**花括号配平**（跳过字符串与注释）定位块边界，因此对嵌套结构与字符串内的括号都正确处理。

**抽取的信息**：

| 类别 | 字段 |
|------|------|
| 标识 | `id`、`name`（中文名，来自 translate 表） |
| 描述 | `desc`（纯文本）、`descRaw`（原始） |
| 位置 | `source`、`pack`、`file`、`line`、`endLine` |
| 时机 | `triggers`（`角色:时机名`） |
| 结构 | `hasCost`、`hasViewAs`、`hasMod`、`hasEnable`、`hasSubSkill`… |
| 标记 | `forced`、`limited`、`juexingji`、`direct`、`silent` |
| API | `apis`（draw/damage/chooseTarget…） |

**特征分布**（实测）：

| 特征 | 数量 |
|------|------|
| 有 content 实现 | 5917 |
| 有子技能 | 2166 |
| 锁定技 | 1843 |
| 主动技 | 1612 |
| 有 cost | 1014 |
| 有 mod | 806 |
| 限定技 | 266 |
| 有 viewAs | 219 |

**高频触发时机 Top 5**：`phaseZhunbeiBegin`(334)、`damageEnd`(334)、`phaseJieshuBegin`(273)、`loseAsyncAfter`(230)、`phaseUseBegin`(218)

### 4.2 检索算法

无外部依赖，纯 Node 实现。核心是**多路加权匹配**：

| 匹配位置 | 权重 | 说明 |
|---------|------|------|
| 技能名 | ×4 | 最高 |
| 技能 ID | ×3 | |
| 结构特征 | ×3 | 使 `viewAs` 能命中视为技 |
| 触发时机 | ×3 | 使 `phaseDrawBegin` 直接命中 |
| 描述正文 | ×2 | |
| 完整短语命中 | +30 | 长查询的整句加成 |
| 有实现 | +2 | 可参考性 |

**分词**：中文 2~4 字滑动窗口 + 单字，英文按词，并展开同义词表：

```js
摸牌: ["draw"]      判定: ["judge"]      锁定技: ["forced"]
限定技: ["limited"] 视为: ["viewAs"]     濒死: ["dying"]
```

### 4.3 三个命令

```bash
node skill-search.mjs search "<语义描述>"    # 语义检索
node skill-search.mjs show <技能ID>          # 查看完整实现（带行号）
node skill-search.mjs similar <技能ID>       # 找结构相似的技能
```

`similar` 的相似度计算结合**描述 token 重合 + 触发时机重合 + 结构特征重合**，因此能找到"同一技能的多个版本"（如四个武圣）或"结构同族的技能"。

**实测效果**：

| 查询 | 命中 |
|------|------|
| `摸牌阶段多摸一张牌` | 劫营、知略、福绵 |
| `viewAs 将红色牌当杀` | 军神、迁附、瑰杰、炎斩 |
| `similar wusheng` | **四个不同版本的武圣** + 军神 |
| `受到伤害后获得造成伤害的牌` | 奸雄 |
| `判定 结果 红色黑色` | **知识库命中**（已沉淀的写法） |

---

## 5. 增量知识库

### 5.1 设计上的核心矛盾

需求是"知识库优先检索"，但这会引入一个陷阱：

> **知识库会过时。若无脑优先，源码一改就会拿陈旧结论误导开发。**

解决方案：**证据指纹**。

### 5.2 证据指纹机制

每条知识可记录其依据的源码位置与该处**内容哈希**：

```json
{
  "id": "kb-abafd679",
  "title": "判定并取结果用 judge().forResult()",
  "fingerprints": [
    {
      "file": "apps/core/character/key/skill.js",
      "start": 9876,
      "end": 9929,
      "hash": "7fda80372312"
    }
  ]
}
```

读取时重新计算哈希：

| 状态 | 含义 | 行为 |
|------|------|------|
| `fresh` | 指纹一致 | 正常命中，直接采用 |
| `stale` | 源码内容已变动 | **跳过并警告**，回退索引检索 |
| `missing` | 依据文件不存在 | 同上 |

**结论：知识库只会加速，不会误导。**

### 5.3 是否记录指纹

| 情形 | 是否带指纹 | 理由 |
|------|-----------|------|
| 依赖具体实现的结论 | ✅ 带 | 源码一改就应失效 |
| 经验性坑点、项目约定 | ❌ 不带 | 长期有效 |

当前 **13 条中 2 条带指纹**：

| 知识 | 指纹依据 |
|------|---------|
| 判定并取结果用 `judge().forResult()` | `rin_baoqiu @ key/skill.js:9876-9929` |
| 限定技必须调用 `awakenSkill` | `ns_chuanshu @ diy/skill.js:5403-5428` |

其余 11 条是经验性结论（如"`nosource: true`"、"游戏内制作扩展会覆盖文件"），不依赖具体位置，故不带指纹。

### 5.4 知识类型

| 类型 | 用途 | 当前数量 |
|------|------|---------|
| `pattern` | 写法结论 | 7 |
| `pitfall` | 坑点 | 3 |
| `fact` | 项目事实 | 3 |
| `recipe` | 需求→推荐技能 | 0 |

### 5.5 已沉淀的知识（13 条）

| # | 类型 | 标题 |
|---|------|------|
| 1 | 写法 | 判定并取结果用 `judge().forResult()` |
| 2 | 写法 | 令角色放弃摸牌用 `trigger.changeToZero()` |
| 3 | 写法 | 无来源伤害必须传 `nosource: true` |
| 4 | 写法 | `useCard` 会自动调用 `get.autoViewAs` |
| 5 | 写法 | 用 `get.tag({name}, 'damage')` 判定牌标签 |
| 6 | 写法 | `intro.content` 支持函数形式动态显示 |
| 7 | 写法 | 刷新身份显示用 `player.setIdentity()` |
| 8 | 坑点 | 限定技必须在 content 中调用 `awakenSkill` |
| 9 | 坑点 | 不要用游戏内「新建扩展」，会覆盖 `extension.js` |
| 10 | 坑点 | 游戏内「制作扩展」会覆盖 `extension.js`（含修复方法） |
| 11 | 事实 | 判定主公身份用 `player.isZhu`（属性非方法） |
| 12 | 事实 | 扩展必须登记到 `config.extensions` 才显示 |
| 13 | 事实 | 知识库检索可能命中无关条目 |

> 第 13 条是**对工具自身缺陷的记录**——检索"随机使用一张牌"时，知识库误命中了「不要用游戏内新建扩展」。这是分词 + 子串匹配的局限，已如实记录。

### 5.6 命令

```bash
node skill-search.mjs learn --title T --body B --kind K --keywords "..." --from <技能ID>
node skill-search.mjs kb list        # 全部条目（含失效状态）
node skill-search.mjs kb check       # 只看失效的
node skill-search.mjs kb show <id>   # 查看详情
node skill-search.mjs kb forget <id> # 移除
node skill-search.mjs kb stats       # 统计
```

---

## 6. 扩展注册工具

### 6.1 为什么需要它——两个独立问题

开发过程中真实遇到的两类摩擦：

#### 问题一：写了扩展，游戏里看不到

**机制**（`apps/core/noname/init/index.ts:635-661`）：

```ts
const extensions = config.get("extensions");     // 从配置读已登记列表
if (autoImport) { ...发现磁盘新扩展并登记... }    // 需「自动导入」开关
else if (searchParamsImportExtension) { ... }    // 或 URL 参数
```

扩展**必须登记到 `extensions` 数组**才显示。而登记开关 `extension_auto_import` **默认关闭**（`library/index.js:1550` `init: false`）。

**更棘手的是**：玩家配置存于**浏览器 `localStorage["noname_0.9_config"]`**（`configprefix = "noname_0.9_"`，见 `library/index.js:30`）——**服务端无法直接写入**。

| 存储 | 位置 | 服务端可改 |
|------|------|-----------|
| 默认配置模板 | `apps/core/game/config.json` | ✅ |
| **玩家实际配置** | 浏览器 `localStorage` | ❌ |

`config.json` 仅在**首次运行**时作默认值，之后一律以 `localStorage` 为准。

#### 问题二：游戏内「制作扩展」覆盖手写文件

`选项 → 扩展 → 制作扩展` 会**无提示覆盖**同名扩展的：

- `extension.js`（变成空白模板）
- `info.json`（重置为默认值）
- `README.md`（清空）

生成的模板特征：

```js
export default function(){
    return {name:"...", character:{ character:{}, translate:{} }, ...}
    //                     ↑ 空对象，且 precontent 是空函数，不会 import 武将包
}
```

**症状**：扩展能打开，但选将界面**找不到武将包**。

**关键洞察**：`character/` 目录下的文件**不会被删除**，武将数据完好——只需重建 `extension.js`。

### 6.2 工具命令

```bash
node register-extension.mjs status [名...]   # 检查注册状态
node register-extension.mjs list             # 列出磁盘扩展及状态
node register-extension.mjs fix [名...]      # 修复被覆盖的 extension.js
node register-extension.mjs guide <名>       # 生成单个扩展的 Console 脚本
node register-extension.mjs guideall         # 批量登记所有含武将的扩展
node register-extension.mjs patch <名>       # 写入 config.json（仅全新环境有效）
```

`guide` / `guideall` 选项：
- `--enable` —— 默认启用
- `--no-auto-import` —— 不开启「自动导入扩展」

### 6.3 推荐流程

```bash
node register-extension.mjs fix                 # 1. 修复被覆盖的
node register-extension.mjs guideall --enable   # 2. 生成登记脚本
```

把输出的脚本粘贴到**浏览器 Console**，然后 F5。

**脚本会顺带开启「自动导入扩展」** —— 之后新增扩展会被自动发现，**此操作只需做一次**。

### 6.4 为什么不能纯自动

因为 `localStorage` 是浏览器私有存储。工具把"必须由浏览器执行"的那一步**简化成一段可复制的脚本**，这是当前架构下的最优解。

生成的脚本形态：

```js
(() => {
  const NAMES = ["3D精选","玩点论杀","英雄杀","诸葛暗","霍去病"];
  const PREFIX = "noname_0.9_";
  const key = PREFIX + "config";
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(key)) || {}; } catch { cfg = {}; }
  if (!Array.isArray(cfg.extensions)) cfg.extensions = [];
  const added = [];
  for (const NAME of NAMES) {
    if (!cfg.extensions.includes(NAME)) { cfg.extensions.push(NAME); added.push(NAME); }
    cfg["extension_" + NAME + "_enable"] = true;
  }
  cfg["extension_auto_import"] = true;      // ← 关键：一劳永逸
  localStorage.setItem(key, JSON.stringify(cfg));
  localStorage.removeItem(PREFIX + "disable_extension");
  console.log("%c✓ 已登记 " + NAMES.length + " 个扩展", "color:#0a0;font-weight:bold");
})();
```

### 6.5 实测验证

`fix` 命令经过真实场景测试：

| 步骤 | 结果 |
|------|------|
| 用游戏模板覆盖 `extension.js` | ✅ 检测出「⚠空白模板」 |
| 执行 `fix` | ✅ 自动识别并重建 |
| 对比修复结果与原始版本 | ✅ **逐字一致** |
| 加载验证 | ✅ 编译成功 |

---

## 7. 配套模板库

`docs/YRD/templates/`，21 个文件：

| 类别 | 文件 | 说明 |
|------|------|------|
| 扩展骨架 | `02-info.json` ~ `09-sort.js` | 9 个可直接复制改名 |
| 技能模板 | `templates/01` ~ `11` | 11 类技能 |
| 说明 | 两处 `README.md` | 用法与规范 |

**11 类技能模板**：被动触发技、锁定技、有代价的触发技、视为技 viewAs、主动技、限定技与觉醒技、状态切换技、直接效果技、多目标技、附属技能、临时技能。

所有模板经**语法检查**（20/20 通过）与**端到端加载验证**。

---

## 8. 实战案例

工具链在两个真实武将开发中验证：

### 8.1 诸葛暗（3 体力 · 代位 / 乱命）

| 参考实现 | 借鉴点 |
|---------|--------|
| `rin_baoqiu`（暴球） | `judge().forResult()` 现代写法 |
| `ns_chuanshu`（传术） | 濒死触发 + `limited` + `awakenSkill` |
| `qingnang`（青囊） | 选目标与代价结构 |

**关键收获**：初稿用了 `judge().callback` + `getParent(2)` 的**旧式写法**（照抄 `fuji`），检索到暴球后改写为现代的 `await judge().forResult()`。

### 8.2 霍去病（3 体力 · 封狼 / 天妒）

| 参考实现 | 借鉴点 |
|---------|--------|
| `dddlingyong`（灵涌） | 判定 + 使用判定牌 + 循环结构 |
| `rin_baoqiu`（暴球） | 判定写法（**来自知识库，无需重新检索**） |

**知识库发挥作用**：检索时直接命中已沉淀的判定写法，省去一次检索。

**发现参考实现是旧式写法**（`"step 0"` + `callback`），依据知识库改写为 `async` + `await`。

**三处经核实纠正的写法**：

| 项 | 初稿 | 核实后 |
|---|------|--------|
| 无来源伤害 | 省略 `source` | **必须写 `nosource: true`** |
| 使用虚拟牌 | 手动 `get.autoViewAs` | **不需要**，`useCard` 内部会调 |
| `get.tag` 传参 | 担心需完整牌对象 | **`{name}` 即可** |

---

## 9. 设计取舍记录

### 9.1 为什么 Skill 不直接注册工具

DSH 的 Skill 机制**不支持** Skill 注册工具。可行的替代是"Skill 指引 + CLI 脚本"，功能等价且无需改动 DSH 本体。

### 9.2 为什么知识库不替代索引

即使知识库命中，**索引检索仍会执行**。理由：

- 知识库是**结论**（"该这么写"），索引是**素材**（"别人怎么写的"）
- 两者互补，缺一不可
- 知识库失效时能自动回退

### 9.3 为什么指纹只覆盖 2/13

指纹适用于**依赖具体实现**的结论。经验性坑点（如"游戏内制作扩展会覆盖文件"）不依赖某个代码位置，加了指纹反而会因无关的源码变动而误判失效。

### 9.4 已知局限

| 局限 | 说明 |
|------|------|
| 知识库检索噪声 | 分词 + 子串匹配会误命中（如搜"随机使用一张牌"命中"新建扩展"） |
| 扩展注册需人工一步 | `localStorage` 是浏览器私有存储，服务端写不了 |
| 索引需手动重建 | 源码变更后需 `rebuild`（知识库的失效检测是实时的，与索引无关） |
| 立绘需手动放置 | `image/character/<武将ID>.jpg`，无自动生成 |

---

## 10. 相关文档

| 主题 | 文档 |
|------|------|
| 工具使用说明 | `.dsh/skills/noname-general-extension/scripts/README.md` |
| 开发规范 | `.dsh/skills/noname-general-extension/SKILL.md` |
| 模板库 | [templates/README.md](templates/README.md) |
| 技能编写基础 | [13-extending.md](13-extending.md) |
| 触发机制原理 | [08-trigger-system.md](08-trigger-system.md) |
| 易错点全清单 | [appendix-c-pitfalls.md](appendix-c-pitfalls.md) |
| **官方构建系统与扩展产物链路** | [17-build-and-packaging.md](17-build-and-packaging.md) |

> 本篇 §6 讲的「扩展注册」是**运行时登记**问题（`localStorage` 里的开启列表）；
> 第 17 篇 §3 讲的是**构建期产物**问题（`packages/extension/` → `apps/core/extension/` → `dist/extension/`）。
> 两者都会表现为「扩展在游戏里看不到」，但排查路径完全不同。

### 源码依据

| 机制 | 位置 |
|------|------|
| Skill 发现路径 | `dsh-skill-filesystem/lib/index.js:150-187` |
| 扩展列表登记 | `apps/core/noname/init/index.ts:635-661` |
| 自动导入开关默认值 | `apps/core/noname/library/index.js:1550` |
| configprefix 定义 | `apps/core/noname/library/index.js:30` |
| 制作扩展覆盖逻辑 | `apps/core/noname/ui/create/menu/pages/exetensionMenu.js:362` |
| 玩家配置读写 | `apps/core/noname/game/index.js:9875-9887` |
