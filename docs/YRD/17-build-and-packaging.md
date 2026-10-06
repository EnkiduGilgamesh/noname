# 17 · 打包体系与扩展产物

> 本篇回答三个问题：
>
> 1. `pnpm build` 到底做了什么？产物 `dist/` 是怎么拼出来的？
> 2. **`extension` 部分是怎么处理的？** 为什么它不在本体的构建图里？
> 3. Electron / 移动端 / 服务端的包是怎么来的？
>
> 与第 14 篇的区别：14 篇讲**我们为开发扩展而造的工具**（检索、知识库、注册），
> 本篇讲**官方构建系统本身**——产物的形状、每份文件由哪一步产生。
>
> 源码基线：分支 `main`，`apps/core` 版本 `1.11.7`。
>
> ✅ **本篇结论已实机验证**（2026-01，Node 24.21.0 / pnpm 12.8.1 / Windows）。
> 验证方式与结果见 [§9 实测验证记录](#9-实测验证记录)。

---

## 0. 一句话结论

> **无名杀的打包 = 一次「本体 Vite 构建」+ N 次「包体独立构建」+ 一次「目录拼装」。**
> **而扩展（extension）完全不参与任何构建，它只是被 `fs.cp` 原样复制过去。**

这是本项目的核心设计，也是理解一切打包行为的钥匙。

---

## 1. 仓库布局与 workspace 划分

### 1.1 pnpm workspace

`pnpm-workspace.yaml:1-4`：

```yaml
packages:
  - apps/*
  - packages/*
  - packages/extension/*      # ← 注意这一条
```

| 路径 | 成员 | 角色 |
|------|------|------|
| `apps/core` | `noname` | **游戏本体**（版本号在此，`1.11.7`） |
| `apps/electron` | `@noname/electron` | 桌面客户端外壳 |
| `apps/mobile` | `@noname/mobile` | Capacitor 安卓外壳 |
| `packages/fs` | `@noname/fs` | 静态文件服务器 + 文件读写 API |
| `packages/jit` | `@noname/jit` | 浏览器内 TS/Vue 即时编译（service worker） |
| `packages/server` | `@noname/server` | 联机大厅服务器 |
| `packages/extension/*` | `@noname-extension/<名>` | **用户自建扩展（开发态）** |

`pnpm-workspace.yaml:18` 的 `sharedWorkspaceLockfile: false` 意味着**每个子包持有自己的 `pnpm-lock.yaml`**（`apps/core`、`apps/electron`、`apps/mobile`、`packages/fs`、`packages/jit`、`packages/server` 下各有一份）。改动依赖时不要只改根锁文件。

### 1.2 一个关键区分：两种「扩展」目录

项目里存在**两个同名概念**，混淆是踩坑的头号原因：

| 目录 | 角色 | 是否入库 | 谁写它 |
|------|------|---------|--------|
| `packages/extension/<名>/` | **扩展的源码工程** | ❌ 基本不入库（见下） | 开发者手写 / `pnpm init:extension` 生成 |
| `apps/core/extension/<名>/` | **扩展的构建产物** | ⚠️ 白名单入库 | 扩展工程的 `vite build` 输出 |

数据流向**单向且不可逆**：

```
packages/extension/英雄杀/          ──vite build──▶  apps/core/extension/英雄杀/
   src/index.ts                                        extension.js
   info.json                                           info.json
   audio/  image/                                      audio/  image/
   vite.config.ts                                      （vite.config.ts 不产出）
```

> ⚠️ **`apps/core/extension/` 是构建产物，不是源码。** 直接手改这里的 `extension.js`，
> 下次构建就会被覆盖（详见 §5.3）。这与第 14 篇 §6 记录的「游戏内制作扩展会覆盖文件」是**两个不同的覆盖来源**。

### 1.3 入库白名单

`packages/extension/.gitignore`：

```gitignore
*/                    # 默认忽略全部
!boss/**              # 仅白名单放行
!cardpile/**
!coin/**
!3D精选/**
!杀海拾遗/**
!欢乐卡牌/**
!玩点论杀/**
!英雄杀/**
```

`apps/core/.gitignore` 有**镜像的同一份白名单**（针对构建产物侧）：

```gitignore
extension/**
!extension/boss/**
!extension/cardpile/**
!extension/coin/**
!extension/3D精选/**
!extension/杀海拾遗/**
!extension/欢乐卡牌/**
!extension/玩点论杀/**
!extension/英雄杀/**
```

实测入库情况（`git ls-files`）：

| 目录 | 入库文件数 |
|------|-----------|
| `packages/extension/` | **1**（只有 `.gitignore` 本身） |
| `apps/core/extension/3D精选` | 47 |
| `apps/core/extension/杀海拾遗` | 687 |
| `apps/core/extension/英雄杀` | 55 |
| `apps/core/extension/玩点论杀` | 33 |
| `apps/core/extension/欢乐卡牌` | 29 |
| `apps/core/extension/boss`、`cardpile`、`coin` | 各 1（占位） |

**结论**：官方内置扩展（3D精选、杀海拾遗、英雄杀、玩点论杀、欢乐卡牌）是**以构建产物的形态直接入库的**，没有对应的 `packages/extension/` 源码工程。它们是「源码即产物」的例外。

反过来，你本地用 `pnpm init:extension` 建的扩展**不会入库**——它属于开发者私有工程。

---

## 2. 构建入口链路

### 2.1 命令地图

```
pnpm build                    ← 根 package.json:7 → tsx scripts/build.ts
  │
  ├─ 1. pnpm -F noname... build              （含依赖，先建 @noname/fs、@noname/jit）
  │      └─ apps/core/package.json:23 → tsx scripts/build.ts
  │           ├─ buildSelf()        ← 本体
  │           └─ buildIndividual()  ← 武将包 / 卡牌包 / 模式
  │           └─ writeBuildInfo()   ← 写 dist/game/build-info.json
  │
  ├─ 2. pnpm -F ./packages/extension/** build   ← 所有自建扩展工程
  │
  └─ 3. 目录拼装 → 根 dist/
```

根 `scripts/build.ts` 全文仅 25 行，是**编排脚本**，不含任何编译逻辑：

```ts
spawnSync("pnpm -F noname... build",       { shell: true, stdio: "inherit" });
spawnSync("pnpm -F ./packages/extension/** build", { shell: true, stdio: "inherit" });

await fs.rm("dist", { recursive: true, force: true });   // 先清空
await fs.mkdir("dist", { recursive: true });
await Promise.all([
	fs.cp("apps/core/dist",    "dist",           { recursive: true }),  // 本体产物 → 根
	fs.cp("apps/core/audio",   "dist/audio",     { recursive: true }),  // 素材（不进 vite）
	fs.cp("apps/core/image",   "dist/image",     { recursive: true }),
	fs.cp("apps/core/extension","dist/extension",{ recursive: true }),  // ★ 扩展：纯复制
	fs.cp("docs",              "dist/docs",      { recursive: true }),
	fs.cp(".nomedia",          "dist/.nomedia"),
	fs.cp("LICENSE",           "dist/LICENSE"),
	fs.cp("README.md",         "dist/README.md")
]);
```

注意 `-F noname...` 中的**三点号**：pnpm 的拓扑过滤语法，表示「`noname` 及其所有 workspace 依赖」。这保证 `@noname/fs`、`@noname/jit` 先于本体构建。

> ⚠️ `fs.rm("dist")` 在两次 build **之后**执行。若扩展构建失败，根 `dist` 会保留上一次的旧产物——排查时不要误以为「构建成功」。

### 2.2 两条构建路径对比

`apps/core/scripts/build.ts` 把产物分成两类，用两套 Rollup 配置：

| | **本体**（`buildSelf`） | **包体**（`buildIndividual`） |
|---|---|---|
| 入口 | `index.html`、`noname.js` | `character/<包>/index.ts`、`card/*.js`、`mode/*.js` |
| `preserveModules` | ✅ `true`（保留目录结构） | ❌ `false`（各自打成单文件） |
| `treeshake` | ❌ `false` | ✅ `true` |
| `external` | 仅 `["vue"]` | **整个 importMap 的 key** |
| 输出目录 | `dist/` | `dist/character`、`dist/card`、`dist/mode` |
| 目的 | 保留 `src/` 结构供 JIT 服务 | 独立可加载的包体 |

**为什么本体 `treeshake: false`？** 本体大量依赖副作用（往 `lib`/`game`/`ui` 上挂方法），摇树会删掉看似未使用的注册代码。

**为什么包体要 `external` 掉 importMap？** 包体运行时要引用**本体已加载的同一份 `lib`/`game` 实例**，若被打包进去就会产生第二份实例，状态不同步。`external: Object.keys(importMap)` 即 `["noname","vue","pinyin-pro","dedent"]`。

### 2.3 编译目标与无 hash 命名

`apps/core/scripts/build.ts:24`：

```ts
const target = ["chrome91", "safari16.4"];
```

对应项目声明的最低运行环境 `Chromium >= 91 || Safari >= 16.4.0`。

三份配置都统一关掉了 hash：

```ts
entryFileNames: "[name].js",
chunkFileNames: "[name].js",
assetFileNames: "[name][extname]",
```

**原因**：产物要支持「浏览器直接打开 + 文件系统读取 + 游戏内热改」。带 hash 的文件名会让 JIT 编译、扩展动态 `import`、增量更新全部失去稳定路径。

### 2.4 import map 与 `game.js` 注入

本体构建挂了三个插件：`viteStaticCopy`（复制静态资源）、`generateImportMap`、`jit()`。

`vite-plugin-importmap.ts` 做两件事：

**① 解析 import map 为真实路径**（`buildStart`）——把裸标识符解析成相对 `root` 的产物路径：

```ts
const resolved = require.resolve(importMap[key]);
resolvedImportMap[key] = normalizePath("/" + path.relative(root, resolved));
```

例如 `vue` → `vue/dist/vue.esm-browser.js`（`apps/core/scripts/build.ts:31` 已指定子路径），`noname` → `/noname.js`。解析失败则回退原值。

**② 生成 `dist/game/game.js`**（`closeBundle`）——这是一段**运行时引导代码**，不是构建产物模块。它负责：

| 步骤 | 作用 |
|------|------|
| 检测 `file:` 协议 | 不支持则 `alert` 提示升级浏览器/客户端 |
| 移除 `app/color.css` | 清理旧版残留 |
| 清理 `cordovaLoadTimeout` | 兼容旧 Cordova 端 |
| 注入 `<script type="importmap">` | 把上一步解析好的映射写进页面 |
| 注册 `service-worker.js` | 启用 JIT 即时编译；**首次加载会强制 `reload` 一次** |
| 加载 `/noname/entry.js` | 真正的游戏入口 |

同一份 importmap 也通过 `transformIndexHtml` 注入 `index.html` 的 `head-prepend`。

> 🔬 JIT 的首次重载逻辑：`sessionStorage.isJITReloaded` 未置位时，先注销旧 worker 再 `location.reload()`。这解释了开发时「第一次打开页面必刷新一次」的现象。

### 2.5 静态资源为什么不走 Vite

`apps/core/scripts/build.ts:40-51` 的 `staticModules` 里，`character` / `card` / `mode` 三行是**注释掉的**：

```ts
const staticModules: Target[] = [
	// { src: "character", dest: "" },
	// { src: "card", dest: "" },
	// { src: "mode", dest: "" },
	{ src: "layout", dest: "" },
	{ src: "font", dest: "" },
	{ src: "theme", dest: "" },
	{ src: "game", dest: "" },
	{ src: "noname", dest: "src" },
	{ src: "typings", dest: "src" },
	{ src: "noname.js", dest: "src" },
];
```

它们改为**单独构建**（`buildIndividual`）后复制到 `dist/src/<type>`，这正是 §2.2 那条路径的由来。

同时注意 `audio` 与 `image` **不在**这份列表里——它们体量大且无需处理，所以由根 `scripts/build.ts` 的 `fs.cp` 直接搬运。这就是为什么根编排脚本里会出现 `apps/core/audio`、`apps/core/image` 两行。

### 2.6 构建元信息

`apps/core/scripts/build.ts:232-250` 产出 `dist/game/build-info.json`：

```json
{ "channel": "test", "commit": "abc123...", "builtAt": "unknown" }
```

| 字段 | 来源 | 回退 |
|------|------|------|
| `channel` | 环境变量 `NONAME_BUILD_CHANNEL` | `"test"`（不在 `test/nightly/release` 白名单时） |
| `commit` | 环境变量 `NONAME_BUILD_COMMIT` | `git rev-parse HEAD`；失败为 `"local"` |
| `builtAt` | 环境变量 `NONAME_BUILD_TIME` | `"unknown"` |

读取侧在 `apps/core/noname/util/meta.ts:37-58`：**开发态直接返回 `dev` 常量**，不读文件；生产态按 `file:` 协议分流——是则走 `readLocalJson`，否则 `fetch(..., {cache:"no-store"})`。

`formatBuildLabel` 决定 UI 上显示什么：

| channel | 显示 |
|---------|------|
| `dev` | `dev` |
| `test` | `test @ <commit 前 8 位>` |
| `nightly` | `nightly <builtAt 前 10 字符>` |
| `release` | 空字符串（不显示） |

---

## 3. 扩展（extension）部分如何处理 ⭐

这是本篇的重点。**结论：扩展不参与 Vite 构建图的任何一环。**

### 3.1 三层证据

**证据一：本体构建脚本完全不含 extension 逻辑。**

`apps/core/scripts/build.ts` 中 `individuals` 只声明了三类：

```ts
const individuals: Record<IndividualType, IndividualContent[]> = {
	character: [],   // 扫描 character/ 下所有目录
	mode: [ { name: "identity", ... }, { name: "doudizhu", ... } ],
	card: [],        // 扫描 card/ 下所有文件
};

type IndividualType = "character" | "card" | "mode";   // ← 没有 "extension"
```

`extension` 既不在 `individuals`，也不在 `staticModules`。检索该文件全文，`extension` 一词只出现在 `getDirectoryEntry` 的**局部变量**（遍历 `["ts","js"]` 后缀）中，与扩展无关。

**证据二：扩展产物由扩展工程自己的 Vite 配置产出。**

`scripts/extension-template/default/vite.config.ts`：

```ts
build: {
	outDir: `../../../apps/core/extension/${info.name}`,   // ★ 直接写进本体扩展目录
	emptyOutDir: true,                                     // ★ 每次构建先清空
	lib: { entry: { extension: "src/index.ts" }, formats: ["es"] },
	rollupOptions: {
		external: ["noname"],
		output: {
			preserveModules: true,
			preserveModulesRoot: "./",
			entryFileNames: "[name].js",     // → extension.js
			chunkFileNames: "[name].js",
			assetFileNames: "[name][extname]",
		},
	},
}
```

`info.name` 直接来自 `info.json`——**扩展目录名 = `info.json` 的 `name` 字段**，不是工程目录名。

**证据三：根编排脚本对扩展只做 `fs.cp`。**

```ts
fs.cp("apps/core/extension", "dist/extension", { recursive: true })
```

一行，无编译、无转换、无 tree-shaking。

### 3.2 完整链路图

```
┌──────────────────────────────────────────────────────────────────┐
│ ① 脚手架：pnpm init:extension <名> --author <作者> [--vue]        │
│    scripts/initExtension.ts                                       │
│    scripts/extension-template/default/**  →  packages/extension/<名>/│
│    变量替换：{{EXTENSION_NAME}}、{{AUTHOR}}                        │
│    （--vue 再叠加 extension-template/vue/**）                     │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ ② 开发：src/index.ts 写扩展逻辑，audio/ image/ 放素材              │
│    开发态：pnpm dev → build:watch 监听，实时写入 apps/core/extension│
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ ③ 扩展构建：vite build （lib 模式，format: es，external: noname）  │
│    ├─ src/index.ts        ──▶ extension.js                        │
│    ├─ viteStaticCopy: audio/ image/ info.json LICENSE 原样复制     │
│    └─ outDir = apps/core/extension/<info.name>   （emptyOutDir）   │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ ④ 本体构建：pnpm -F noname... build                               │
│    ⚠️ 完全不感知 extension/ 的存在                                │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ ⑤ 拼装：fs.cp("apps/core/extension", "dist/extension")            │
│    → dist/extension/<名>/{extension.js, info.json, image/, audio/} │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2.1 实测验证（本节结论均已实机跑通）

以下为**真实执行** `pnpm init:extension` → `vite build` → `pnpm build` 的观测结果：

| 验证项 | 命令 | 实测结果 |
|--------|------|---------|
| 脚手架生成文件数 | `pnpm init:extension 验证扩展 --author 验证者` | 7 个（`.gitkeep` 已跳过 ✅） |
| 变量替换 | 同上 | `{{EXTENSION_NAME}}`→`验证扩展`、`{{AUTHOR}}`→`验证者` ✅ |
| 产物落点 | `pnpm -F @noname-extension/验证扩展 build` | 写入 `apps/core/extension/验证扩展/` ✅ |
| 产物文件集 | 同上 | `extension.js`、`extension.js.map`、`info.json`、`audio/`、`image/`、`LICENSE` ✅ |
| **未**产出 `vite.config.ts` | 同上 | ✅（不在 `viteStaticCopy` targets 内） |
| **未**产出 `src/` | 同上 | ✅（已内联进 `extension.js`） |
| 无 hash 命名 | 同上 | 文件名为 `extension.js`，非 `extension-<hash>.js` ✅ |
| 导出契约 | 读 `extension.js` | 同时导出 `type = "extension"` 与 `default` ✅ |
| **纯复制**（核心结论） | `pnpm build` 后比对 | 两侧文件列表**完全一致**，`extension.js` **SHA256 逐字节相同** ✅ |

> 🔬 **SHA256 逐字节相同**是本篇最硬的证据：它排除了「复制过程中被再次转译/压缩」的可能，
> 从密码学层面证明 `dist/extension/**` 与构建产物**完全一致，零变换**。
>
> 实测还验证了 `emptyOutDir` 的破坏性：手工放入 `手工文件.txt` 并篡改 `extension.js` 后重新构建，
> 该文件**被删除**、`extension.js` **被静默还原**——与 §3.4、§5.1 的描述一致。

### 3.2.2 实测发现的额外问题：嵌套 `.git` 会被一起打包

实测中出现一个原先未预料的现象：

```
apps/core/extension files: 1260
dist/extension files:      1352     ← 多出 92 个
差异全部为：\<扩展名>\.git\...      （92 个）
```

原因：本机 `apps/core/extension/` 下的 `新宇杀`、`英雄杀RE` 两个扩展**本身就是 git 仓库**
（各自内含完整 `.git/` 目录）。而 `fs.cp` **没有任何排除逻辑**——它是无条件递归复制。

排除嵌套 `.git` 后重新比对：**1260 = 1260，完全一致**。

**后果**：这 92 个文件（含 `objects/pack/*.pack`）会被原样带入 `dist/`，进而进入 `noname.full.zip`。
体积浪费之外，还可能泄露扩展作者的仓库历史。

**规避方式**（当前构建脚本均未实现，需手工处理）：

```powershell
# 构建前移走嵌套 .git（扩展本体不受影响），构建后再改回
Get-ChildItem apps\core\extension -Directory | ForEach-Object {
    $g = Join-Path $_.FullName ".git"
    if (Test-Path $g) { Rename-Item $g "$g.bak" }
}
pnpm build
```

> ⚠️ 这不是构建脚本的缺陷，而是「把扩展目录当作无脑复制的黑盒」这一设计
> 在**扩展自身含版本库**时的必然副作用。内置扩展（杀海拾遗等）无 `.git`，故不受影响。

### 3.3 扩展产物的目录契约

游戏运行时的加载逻辑（`apps/core/noname/init/import.ts:19-39`）决定了产物必须满足的**硬性契约**：

```ts
export async function importExtension(name: string) {
	if (!game.hasExtension(name) && !lib.config.all.stockextension.includes(name)) {
		await game.import("extension", await createEmptyExtension(name));
		return;
	}
	...
	await importFunction("extension", `/extension/${name}/extension`);
}
```

| 契约 | 要求 | 违反后果 |
|------|------|---------|
| 路径 | `extension/<名>/extension.js` | 找不到模块，加载失败 |
| 导出 | 必须导出 `type = "extension"` 与 `default` 函数 | `importFunction` 抛错：`Loaded Content doesn't match "extension"` |
| 目录名 | 必须等于 `info.json` 的 `name` | 与 `config.extensions` 登记项对不上 |
| 元信息 | `info.json` 提供 `name/intro/author/version` | 扩展**关闭时**信息面板显示默认兜底文案 |

`importFunction` 的后缀回退逻辑（`import.ts:54-64`）值得注意：

```ts
const modeContent = await import(path + ".js").catch(async e => {
	if (window.isSecureContext) {
		try { return await import(path + ".ts"); } catch { throw e; }
	}
	throw e;
});
```

即：**先试 `.js`，仅在安全上下文（HTTPS/localhost）下才回退试 `.ts`**。这是 JIT 即时编译能力在加载链上的体现——生产环境（非安全上下文）不会有 `.ts` 回退。

模板 `src/index.ts` 的导出形态正好满足契约：

```ts
import { lib, game, ui, get, ai, _status } from "noname";

export const type = "extension";

export default function (): importExtensionConfig {
	return { name: "{{EXTENSION_NAME}}", editable: false, ... };
}
```

> ⚠️ 模板的 `export default function ()` 中，**`content` 与 `precontent` 是空函数**，`package.character.character` 是空对象。
> 这意味着**新扩展选将界面看不到任何武将**——这不是 bug，是空骨架。参考第 14 篇 §6.1 记录的同类症状。

### 3.4 模板的静态复制策略

`viteStaticCopy` 承担「非代码资源」的搬运：

```ts
viteStaticCopy({
	targets: [
		{ src: "audio", dest: "" },
		{ src: "image", dest: "" },
		{ src: "info.json", dest: "" },
		{ src: "LICENSE", dest: "" },
	],
})
```

`dest: ""` 表示**平铺到 `outDir` 根**。配合 `emptyOutDir: true`，每次构建产物目录被完全重建——所以**手动扔进 `apps/core/extension/<名>/` 的任何文件都会丢失**。

工程目录里的 `.gitkeep` 占位文件（`audio/.gitkeep`、`image/.gitkeep`）**不会**被复制：`initExtension.ts:22` 显式跳过：

```ts
if (entry.name === ".gitkeep") return;
```

> ⚠️ 模板 `vite.config.ts` 的 `viteStaticCopy` targets 里**没有 `extension.js`**。这是正确的——`extension.js` 由 Rollup 从 `src/index.ts` 编译产出，不由静态复制生成。

### 3.5 两种扩展工程模板

`pnpm init:extension` 支持 `--vue`，实际是**两层模板叠加**：

```
extension-template/default/     ← 必选基础层
├── package.json        {{EXTENSION_NAME}} / {{AUTHOR}}
├── vite.config.ts
├── info.json           ★ 决定产物目录名
├── LICENSE
├── audio/.gitkeep
├── image/.gitkeep
└── src/index.ts

extension-template/vue/         ← 可选叠加层（--vue）
├── package.json        覆盖基础层（增加 vue 依赖等）
└── vite.config.ts      覆盖基础层（增加 vue 插件配置）
```

**叠加顺序很重要**（`initExtension.ts:79-89`）：先复制 `default`，再复制 `vue` 覆盖同名文件。

两层 `vite.config.ts` 的**唯一差异**在插件与 external：

| | `default` | `vue`（覆盖后） |
|---|---|---|
| 插件 | `viteStaticCopy` | `vue()` + `viteStaticCopy` |
| `external` | `["noname"]` | `["noname", "vue"]` |

即：Vue 模板额外挂 `@vitejs/plugin-vue`，并把 `vue` 也标为外部依赖——**因为本体已经通过 import map 提供了 `vue`**（`apps/core/scripts/build.ts:31`），扩展不应再打包一份，否则会出现两个 Vue 实例（组件注册、响应式系统互不相认）。这与 §2.2 中「包体 external 掉 importMap」是同一个理由。

对应的命令：

```bash
pnpm init:extension <name> [--author <作者>] [--vue]
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `<name>` | 必填 | 既作工程目录名，也作 `info.name` |
| `--author` | `无名玩家` | 写入 `info.json` 与 `package.json` |
| `--vue` | 否 | 叠加 Vue 模板 |

已存在同名目录时直接抛错退出（`initExtension.ts:72-77`）。

### 3.6 开发态的扩展构建

`scripts/dev.ts`（全文 4 行）：

```ts
spawn("pnpm -F @noname/fs dev --debug --dirname=../../apps/core", { shell: true });
spawn("pnpm -F ./packages/extension/** build:watch", { shell: true });
spawn("pnpm -F noname dev --open", { shell: true });
```

三条并行进程：

| 进程 | 作用 |
|------|------|
| `@noname/fs dev` | 文件读写服务器，监听 8089，**根目录指向 `apps/core`** |
| `packages/extension/** build:watch` | 扩展 `vite build --watch --mode development` |
| `noname dev` | 本体 Vite 开发服务器，8081 |

`--dirname=../../apps/core` 是关键：开发态文件 API 直接读写**本体源码目录**，因此扩展 watch 构建的产物落到 `apps/core/extension/` 后，**本体 dev server 立刻可用**，无需重启。

`build:watch` 使用 `--mode development`，经 `define` 注入：

```ts
define: { "process.env.NODE_ENV": JSON.stringify(mode) }
```

而 `vite.config.ts` 的 `build.lib` 在 watch 下仍产出**非压缩**（`minify: false`）带 `sourcemap: true` 的代码——便于调试。

### 3.7 扩展与「测试包」的取舍

`scripts/generateTestPack.ts:58-65` 是唯一对扩展做**筛选**的地方：

```ts
for (const i of fs.readdirSync("dist")) {
	if (["audio", "extension", "font", "image"].includes(i)) continue;   // 先跳过
	await fs.promises.cp(path.join("dist", i), path.join("output/testpack", i), { recursive: true });
}
for (const i of fs.readdirSync("dist/extension")) {
	if (!["boss", "cardpile", "coin"].includes(i)) continue;             // 只挑这三个
	await fs.promises.cp(path.join("dist/extension", i), path.join("output/testpack/extension", i), { recursive: true });
}
```

**测试包只含 `boss`、`cardpile`、`coin` 三个扩展。**

它们正是三个**空占位**扩展（`apps/core/extension/boss/` 下只有 `extension.js` 一个文件，各 1 个入库文件）。这是有意的：测试包用于验证本体功能，体积要小，玩家扩展不应混入。

素材同样做差集裁剪（`generateTestPack.ts:30-51, 66-70`）：

```ts
const folders = ["audio", "font", "image", "theme"];
const excludeDirs = ["audio/effect", "image/flappybird", "image/pointer"];
// ...
const oldAsset = new Set(JSON.parse(fs.readFileSync("apps/core/game/asset.json", "utf-8")));
asset = asset.filter(i => !oldAsset.has(i));    // ★ 只补本次新增素材
```

`apps/core/game/asset.json` 是**上一版已含素材的清单**，测试包只打包「新增」部分——这是夜间测试包的增量策略。

#### 实测校正：素材差集的真实行为

实测发现上面这段的**实际效果比字面描述复杂**，先看观测数据：

| 目录 | `dist` 全量 | `asset.json` 收录 | `testpack` 实际 |
|------|------------|------------------|----------------|
| `audio` | 有 | 9512 条 | **完全不含**（顶层跳过且差集无新增） |
| `image` | 4109 | 3964 条 | **仅 1 个**（`image/huhaibi.png`） |
| `theme` | 104 | 76 条 | **全部 104 个** |
| `font` | 有 | — | **完全不含** |

两个关键机制：

**① 顶层跳过只是「第一道闸」，差集是「第二道闸」。**
`audio`/`font`/`image` 在顶层被 `continue` 跳过，但它们仍会走**素材差集**那一遍。
`image` 拿到 1 个文件，正是因为它恰好有 1 个不在 `asset.json` 里的新素材：

```
$asset -contains 'image/huhaibi.png'   →  False      # 确实不在清单 → 判为"新增" → 保留
```

**② `.css` 被无条件跳过，导致 `theme/` 被整体带入。**

```ts
if (path.extname(file).toLowerCase() === ".css") continue;   // generateTestPack.ts:42
```

实测验证：`theme` 的 76 个**非 CSS** 文件**全部**在 `asset.json` 中（新增数 = 0），
但另有 **28 个 `.css`** 因被跳过而**从不参与**差集判定。结果是 76 + 28 = 104 个文件全部进入测试包。

> 换言之：**目录会被整体复制，只要它含有被跳过的文件类型。** 这解释了为什么 `theme/` 是全量的，
> 而 `image/` 只有 1 个——差异不在策略，而在**该目录是否含有 `.css`**。

**实践含义**：不能假设「测试包只含本体新增素材」。若你在本地新增了 `theme/` 下的资源，
它会因同目录存在 `.css` 而**整目录进入测试包**。

**扩展侧的筛选则是刚性的**：

```ts
for (const i of fs.readdirSync("dist/extension")) {
	if (!["boss", "cardpile", "coin"].includes(i)) continue;
}
```

实测：`dist/extension/` 下有 12 个扩展（含 5 个官方扩展与我新建的 `验证扩展`），
`output/testpack/extension/` **只有 `boss`、`cardpile`、`coin`** ✅。
它们正是三个**空占位**扩展（各仅 1 个入库文件 `extension.js`）——测试包用于验证本体功能，
体积要小，玩家扩展不应混入。

---

## 4. 各端打包

### 4.1 产物形态总览

| 命令 | 产物 | 内容 |
|------|------|------|
| `pnpm build` | `dist/` | 本体 + 全部内置扩展 + 全部素材（**完整包**） |
| `pnpm generateTestPack` | `output/testpack/` | 本体 + 3 个占位扩展 + **增量素材**（离线测试包） |
| `pnpm -F @noname/electron build:win` | `output/` | NSIS 安装程序 `.exe` |
| `pnpm -F @noname/mobile build:android` | `android/app/build/outputs/` | APK / AAB |
| `pnpm -F @noname/fs build:win` | `packages/fs/output/` | Node SEA 单文件服务器 |

### 4.2 Electron 桌面端

`apps/electron/build.ts` 编排 `electron-builder`，关键配置：

```ts
config: {
	asar: false,                          // ★ 不打包成 asar
	appId: "com.libnoname.noname",
	productName: "noname",
	directories: { output: "../../output" },
	files: [
		{ from: "dist", to: "" },                        // 主进程/预加载脚本
		{ from: "../../dist", to: "" },                  // ★ 游戏本体
		{ from: "../../dist/node_modules", to: "node_modules" },
		"package.json",
	],
	extraMetadata: { main: "app/main.js" },
}
```

三个设计点：

**① `asar: false`。** 扩展需要能被文件系统读写、玩家需要能直接替换素材——asar 归档会破坏这些能力。

**② `main: "app/main.js"` 靠 `extraMetadata` 注入**，而非写死在 `package.json`（那里是 `dist/app/main.js`）。因为 electron-builder 会把 `dist/` 内容**平铺**到应用根（`{ from: "dist", to: "" }`），路径要相应上移一层。

> ⚠️ **该路径必须与 `vite.config.ts` 的实际产物文件名一致**。本项目已把主进程改为
> **CJS**（`main.cjs`，原因见 §4.2.1），因此这里与 `package.json` 的 `main`
> 都必须是 `app/main.cjs` / `dist/app/main.cjs`。
> **写错不会报错**，只会表现为「双击 exe 毫无反应」。

**③ `dist/node_modules` 被显式带上。** 本体产物可能引用运行时依赖，`to: "node_modules"` 保持 Node 解析路径有效。

`build.ts:29` 在打包前先执行 `await buildVite()`，用 `vite-plugin-electron` 编译 `app/main.ts` + `app/preload.ts` 到 `dist/app/`。

各平台目标（`build.ts:31-56`）：

| 命令 | Platform / Target | 额外配置 |
|------|-------------------|---------|
| `build:win` | `WINDOWS.createTarget("nsis", Arch.x64)` | `icon: noname.ico`、`verifyUpdateCodeSignature: false`、NSIS 允许改安装目录 |
| `build:linux` | `LINUX.createTarget("AppImage", Arch.x64)` | — |
| `build:macos` | `MAC.createTarget("dmg", Arch.arm64, Arch.x64)` | `identity: null`（不签名，双架构） |

> ⚠️ `main()` 是 `async` 但调用处**没有 `await`**（`build.ts:33/45/48`），进程退出依赖 electron-builder 内部句柄。本地改脚本时不要依赖 `main()` 的 Promise 时序。

#### 4.2.1 ⚠️ 主进程必须产出 CJS（否则"双击 exe 毫无反应"）

**症状**：双击 `noname.exe`（或 `output\win-unpacked\noname.exe`）**没有任何反应**——
无窗口、无错误弹窗、进程秒退。命令行运行也看不到输出。

**这是本项目曾经的真实缺陷**，2026-10 定位并修复。**根因有四层** ——
前两层只在产物层面可见，**后两层才是"双击无反应"的直接原因**，
且它是前两层的修复**引入**的（改 CJS 时踩到）。

**① ESM 主进程无法 `import` electron 的命名导出**

`apps/electron/package.json` 声明了 `"type": "module"`。`vite-plugin-electron` 据此
**自动推导产物格式**：

```js
// vite-plugin-electron/dist/index.js:32,42
const esmodule = packageJson.type === "module";
...
formats: esmodule ? ["es"] : ["cjs"],
```

于是主进程产物是 ESM，里面写着：

```js
import { app, crashReporter, BrowserWindow, Menu, shell, dialog } from "electron";
```

而 Electron 的 `electron` 内置模块是 **CJS 形态**，其导出名无法被 Node 的
`cjs-module-lexer` 静态识别，启动即抛：

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

主进程在**加载第一行**就崩溃，窗口来不及创建 —— 所以「毫无反应」。

**② 打包 `@electron/remote` 会破坏其内部 interop**

即便格式改成 CJS，若把 `@electron/remote` 打进 bundle，Rollup 会为它多个内部模块
**重复生成** `const electron_1 = require("electron")`，使引用落到错误作用域：

```
TypeError: Cannot read properties of undefined (reading 'on')
    at handleRemoteCommand (...@electron/remote/.../main/server.js:313)
```

> 🔬 注意此报错出现在 **`@electron/remote` 自己的源码路径**上，
> 容易误以为与自己的代码无关 —— 实则是打包 interop 造成的。

**③ ⚠️ 改成 CJS 后 `import.meta.dirname` 失效（静默失败之一）**

`main.ts:14` 原本这样取应用目录：

```ts
const dirname = path.join(import.meta.dirname, "../");
```

`import.meta` **只存在于 ESM**。一旦产物改成 CJS，打包器只能把它替换成 `void 0`：

```js
// 产物 main.cjs:8 —— 修复前（行号对应产物，非源码）
const dirname = path.join(void 0, "../");
```

而 `path.join(undefined, "../")` **立即抛错**：

```
TypeError: The "path" argument must be of type string. Received undefined
```

**关键**：该语句位于**所有 `setPath()` 之前**（`main.ts:33-39`），
所以 `Home/` 目录**永远不会生成**——这正是判据的由来。

> 🔬 **为什么这一层最隐蔽**：
> - 抛错发生在 `app.whenReady()` 之前，Electron **来不及**弹窗或写日志
> - 进程秒退、**退出码 0**、无 stdout/stderr —— 完全"静默"
> - 产物语法是合法的（`node --check` 通过），ESM 报错也确实没了
> - **只有把 CJS 与 `import.meta` 一起看才能发现**

**修复**（`apps/electron/app/main.ts:14`）：CJS 下改用 `__dirname`：

```ts
const dirname = path.join(__dirname, "../");
```

**同期发现的两处连带问题**（均已修）：

| 位置 | 问题 | 修法 |
|------|------|------|
| `main.ts:93` | 仍指向 `app/preload.js`，而产物已是 `.cjs` | 改为 `app/preload.cjs`（指向不存在文件时 Electron **不报错**，只是 preload 静默失效） |
| `main.ts:104` | `import.meta.env.DEV` | ✅ 无需改：`vite` 会**静态替换**为 `false`，生产分支正常保留 |

**④ ⚠️ external 化会让默认导入丢失 `.default` 解包 —— 又一个静默失败**

第 ③ 层修好后**仍然**"无反应"。原因是把 `@noname/fs` 标为 external 后，
Rollup **不再插入 default 互操作包装**：

```js
// 源码 main.ts:6
import createApp from "@noname/fs";        // 默认导入

// 产物 main.cjs:6,9 —— 修复前
const createApp = require("@noname/fs");   // ← 拿到的是命名空间对象！
createApp({ ... });                        // ← TypeError: createApp is not a function
```

实测 `require("@noname/fs")` 返回的是 `{ default, defaultConfig }`，
**真正的函数在 `.default` 上**（该包用 tsup 的 `__toCommonJS` 产出，
带 `__esModule: true`）。

> 🔬 **为什么同样是"静默"**：这句在第 9 行，**仍在所有 `setPath()` 之前**，
> 所以 `Home/` 依旧不生成、依旧无任何输出。

**修复**（`apps/electron/app/main.ts`）—— 显式按 default 解包，并兼容两种形态：

```ts
import createAppModule from "@noname/fs";
// ...
const createApp = typeof createAppModule === "function" ? createAppModule : createAppModule.default;
```

> ✅ **通用启示**：一旦把某个 **CJS 依赖**标为 `external`，
> 凡是对它的 **`import x from "..."`（默认导入）** 都要确认 `.default` 解包。
> `@electron/remote/main/index.js` 是 `module.exports = require(...)` 的纯 CJS 再导出，
> **不受影响**（已验证）；而 tsup/esbuild 产物（带 `__esModule`）会受影响。

**如何验证 main 能跑通（无需 GUI）**：本次用一个 stub 掉 `electron` 的模拟器
把 `main.cjs` 完整跑了一遍，得到调用序列：

```
remote.initialize → setPath:home/appData/userData/temp/cache/crashDumps/logs
→ crashReporter.start → setAboutPanelOptions → whenReady
→ new BrowserWindow → loadURL(http://localhost:8089/index.html)
→ remote.enable → setApplicationMenu → Server listening on port 8089
```

**修复**（`apps/electron/vite.config.ts`）：

```ts
build: {
    // ① 显式覆盖 lib.formats —— 必须改 lib 而非仅 output.format，
    //    因为 lib.formats 优先级更高，且 mergeConfig 会保留插件的 build.lib
    lib: { entry: "app/main.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    rollupOptions: {
        // ② 依赖保持 external，让其自身 CJS 加载
        //    ⚠️ 必须用正则匹配子路径：main.ts 实际 import 的是
        //       "@electron/remote/main/index.js"，
        //       字符串 external 是精确匹配，写 "@electron/remote/main" 匹配不到
        external: ["electron", "@noname/fs", /^node:/, /^@electron\/remote(\/|$)/],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
    },
}
```

并同步两处 `main` 路径：

| 文件 | 字段 | 值 |
|------|------|-----|
| `apps/electron/package.json` | `main` | `dist/app/main.cjs` |
| `apps/electron/build.ts` | `extraMetadata.main` | `app/main.cjs` |

**修复效果**：

| | 修复前 | 修复后 |
|---|---|---|
| 产物 | `main.js`（ESM，1.64 MB） | `main.cjs`（CJS，**4.4 KB**） |
| 首行 | `import ... from "electron"` | `"use strict"; const electron = require("electron")` |
| `dirname` | `path.join(void 0, "../")` → **抛错** | `path.join(__dirname, "../")` ✅ |
| 依赖 | 全部打进 bundle | external，运行时 require |
| `Home/` | ❌ 从不生成 | ✅ 生成（即启动成功） |

> ⚠️ **体积骤降不是"丢了东西"**：`main.cjs` 从 1.64 MB 降到 4.4 KB，是因为
> `@electron/remote`、`@noname/fs` 等改为 external 后**不再内联**，改由
> `resources/app/node_modules/` 提供（该目录由 `files` 映射带入）。
> 若发现 `node_modules` 未随包分发，主进程会因找不到依赖而失败。

**排查提示**：遇到「Electron 双击无反应」，按此顺序查：

1. **看有没有 `Home/` 目录** —— 这是**最快、最可靠**的判据。
   它由 `main.ts:39` 的 `setPath("home", ...)` 创建，位置为
   `<应用根>/Home`（`win-unpacked` 下即 `resources\app\Home`）。
   **没有** ⇒ `main` 根本没执行到那里，问题在入口或入口早几行
2. 用 `cmd` 运行 exe 看 stderr（双击会吞掉输出）：
   `cmd /c "resources\app\..\noname.exe" 2>&1`
3. 检查 `main` 路径指向的文件**是否真的存在**（`.js` vs `.cjs` 错配最常见）
4. **检查产物里有没有 `void 0`**：
   ```powershell
   Select-String -Path resources\app\app\main.cjs -Pattern 'void 0'
   ```
   命中 ⇒ 有 `import.meta` 被 CJS 打成 undefined（见第 ③ 层根因）
5. 确认包内 `node_modules/@electron/remote`、`@noname/fs` 存在（external 化后必需）

### 4.3 安卓端（Capacitor）

`apps/mobile/buildAndroid.ts` 四步：

```
checkJavaVersion()   ← 强制 JDK 21，否则抛错
  ↓
pnpm build           ← 在 workspace 根执行，产出 dist/
  ↓
pnpm sync            ← tsx afterSync.ts（见下）
  ↓
gradlew assembleRelease
```

参数：

| 参数 | 作用 |
|------|------|
| `--variant=<name>` | Gradle 变体，默认 `release`（校验 `^[a-z][a-z0-9]*$`） |
| `--aab` | 构建 App Bundle（`bundleRelease`）而非 APK（`assembleRelease`） |
| `--skip-web-build` | 复用已有 `dist/`，跳过 `pnpm build` |

`capacitor.config.ts` 中 `webDir: "../../dist"` —— Capcitor 直接把根 `dist` 作为 Web 资源目录。这解释了为什么 `dist` 的目录结构必须与浏览器部署完全一致。

`afterSync.ts` 做三件 Capacitor 不覆盖的事：

**① 构建 preload 脚本**（`buildPreload`）——单独用 Vite lib 模式编译 `src/preload.ts` 为 `preload.js`，输出到 `dist/` 根。`inlineDynamicImports: true` 保证单文件。同时**清理旧产物**：

```ts
if (/^(preload(?:-.+)?|web-.+|index\.esm-.+)\.js$/.test(name)) rmSync(...)
```

**② `cap sync`** —— 同步 Web 资源与原生插件（Windows 下走 `cmd /c cap sync`）。

**③ 修补 Android assets 里的 `.pnpm` 目录**（`patchAndroidAssets`）：

```ts
renameSync(pnpmDir, androidSafePnpmDir);   // .pnpm → _pnpm
```

**这是一个隐蔽的坑**：pnpm 在 `node_modules` 下创建 `.pnpm` 目录，而 Android 构建工具链会把**以点开头的目录**当作隐藏文件忽略或拒绝打包，导致 Capacitor 插件在设备上找不到依赖。重命名为 `_pnpm` 绕过该限制。

### 4.4 服务端

`packages/fs` 提供两种形态：

| 命令 | 产物 | 机制 |
|------|------|------|
| `pnpm -F @noname/fs build` | `dist/*.cjs` + `dist/*.js` | tsup（`tsup.config.ts`） |
| `pnpm -F @noname/fs build:win` | `output/noname-server.exe` | **Node SEA** 单文件可执行 |

SEA（Single Executable Application）流程（`packages/fs/build.ts`）：

```
tsup bundle (cjs, minify: terser, noExternal 掉 fastify 全家桶)
  ↓
node --experimental-sea-config sea-config.json      → output/index.blob
  ↓
copyFileSync(process.execPath, "output/noname-server[.exe]")   ← 复制 node 二进制
  ↓
npx postject <目标> NODE_SEA_BLOB <blob> --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

平台差异：

| 平台 | 额外步骤 |
|------|---------|
| Windows | 无（追加 `.exe` 后缀） |
| Linux | 额外传 `--macho-segment-name NODE_SEA`（脚本原样复用 macOS 参数） |
| macOS | 先去签名 → postject → 再 **ad-hoc 重签名**（`codesign --sign -`） |

`noExternal` 列表（`build.ts:29`）确保 fastify 及其静态/跨域插件被**打进 bundle**，而不是留作运行时依赖：

```ts
noExternal: ["minimist", "fastify", "@fastify/static", "@fastify/cors"]
```

> 🔬 `sea-config.json` 内容仅一行——`{ "main": "output/entry.bundle.cjs", "output": "output/index.blob" }`，声明 tsup 产物为 SEA 主入口、blob 输出到 `output/index.blob`。注意它引用的 `entry.bundle.cjs` 正是 `build.ts` 中 tsup 的 `outExtension` 定制结果（`build.ts:31-35`）。

**实测体积**（`build:win`）：

| 文件 | 大小 |
|------|------|
| `entry.bundle.cjs` | 0.7 MB（业务代码） |
| `index.blob` | 0.7 MB（SEA 准备 blob） |
| **`noname-server.exe`** | **90.1 MB** |

> 90 MB 中绝大部分是**内嵌的 Node 运行时本身**（`copyFileSync(process.execPath, ...)` 复制的就是 node 二进制）。
> 这是 SEA 的固有代价，换来的是**零依赖单文件部署**。
> 实测确认二进制内含 `NODE_SEA_BLOB` 标记，且 `fastify` 已打入（`noExternal` 生效）。

`packages/server` 是纯 Node 服务（`tsup.config.ts`，产出 esm + cjs + d.ts），供联机大厅使用；并提供 `Dockerfile` 用于容器化部署。它**不参与** `pnpm build` 的完整包——联机服务器的部署与客户端发行是两条独立链路。

### 4.5 JIT 包

`packages/jit/build.ts` 连续执行四次 tsup 构建 + 一次目录复制，**产出三份不同用途的 bundle**：

| # | 入口 | 输出 | 平台 | 说明 |
|---|------|------|------|------|
| 1 | `src/index.ts` | `dist/` | node | 给构建期用的 Vite 插件，带 `dts: true` |
| 2 | `src/entry.ts` | `dist/` | browser | 浏览器侧入口 |
| 3 | `src/service-worker/index.ts` | `dist/service-worker/` | browser | **service worker**，`bundle: true` + `minify: terser` |
| 4 | — | `dist/public/` | — | `fs.cp("public", ...)`，含 `jit-test.ts` |

第 3 份把编译器整套打进单文件：

```ts
noExternal: ["typescript", "@vue/compiler-sfc", "dedent"],
```

它被本体以 **Vite 插件**形式使用（`apps/core/scripts/build.ts:7, 162`）：

```ts
import jit from "@noname/jit";
// ...
plugins: [viteStaticCopy({ targets: copies }), generateImportMap(importMap), jit()]
```

而 `dist/service-worker/` 正是 §2.4 中 `game.js` 注册的那个 worker，负责运行时把 `.ts` / `.vue` 编译成可执行模块。`public/jit-test.ts` 则是它的**能力嗅探文件**——`game.js` 里那段 `if (sessionStorage.canUseTs !== "true") await import("/jit-test.ts")` 就是用它探测浏览器是否真能编译 TS，结果缓存在 `sessionStorage.canUseTs`。

---

## 5. 易错点清单

### 5.1 改错了目录

| 现象 | 原因 | 正确做法 |
|------|------|---------|
| 改了 `apps/core/extension/X/extension.js`，构建后失效 | 那是产物目录，`emptyOutDir` 会清空 | 改 `packages/extension/X/src/index.ts` |
| 手改 `apps/core/noname/**` 后 `pnpm build` 没变化 | 本体构建有缓存/需先建依赖 | 确认 `pnpm -F noname... build` 完整跑完 |
| 新增素材放进 `apps/core/extension/X/image/` | 会被下次构建删除 | 放 `packages/extension/X/image/` |
| 发布包里多出 `.git/` 目录 | 扩展自身是 git 仓库，`fs.cp` 无排除逻辑 | 构建前移走嵌套 `.git`（见 §3.2.2） |

> ✅ 前两条已实测确认：手工放入的 `手工文件.txt` 在重建后被删除，
> 被篡改的 `extension.js` 被静默还原为 `const type = "extension";`。

### 5.2 扩展不生效

按顺序排查：

1. **产物是否存在** —— `apps/core/extension/<名>/extension.js` 是否生成？
2. **目录名是否等于 `info.json` 的 `name`** —— 不是工程目录名。
3. **是否导出 `type = "extension"`** —— 缺失会报 `Loaded Content doesn't match "extension"`。
4. **是否登记到 `config.extensions`** —— 见第 14 篇 §6，`localStorage` 里的 `noname_0.9_config`。
5. **`extension_<名>_enable` 是否为 `true`**。

### 5.3 两类「覆盖」要分清

第 14 篇 §6 记录的覆盖源是**游戏内「制作扩展」**（运行时，写磁盘）。
本篇 §3.4 的覆盖源是**扩展构建的 `emptyOutDir`**（构建时，清目录）。

两者症状相似（扩展「变空」），但**根因和修复方式完全不同**：前者用 `register-extension.mjs fix` 重建 `extension.js`；后者要回到源码工程重新构建。

### 5.4 CI 相关

`pnpm install --frozen-lockfile` 在所有工作流中使用。由于 `sharedWorkspaceLockfile: false`，**改依赖后必须提交对应子包的 `pnpm-lock.yaml`**，否则 CI 直接失败。

### 5.5 测试包与完整包的差异

`pnpm generateTestPack` **不会**包含 3D精选、杀海拾遗、英雄杀、玩点论杀、欢乐卡牌——只含 `boss`/`cardpile`/`coin`。
若你要验证某个内置扩展在离线包中的行为，必须用 `pnpm build` 的完整 `dist`。

---

## 6. CI/CD 一览

| 工作流 | 触发 | 产物 |
|--------|------|------|
| `build.yml` | push `main` | `pnpm build` → 强推 `dist/` 到 **`build-output` 孤儿分支** |
| `nightly-publish.yml` | 每日 `11 13 * * *` UTC（北京 21:11）+ 手动 | `pnpm generateTestPack` → artifact `测试包-<YYYYMMDD>`，保留 7 天 |
| `release.yml` | push tag `v*` | 草稿 Release + 4 类产物（见下） |
| `lint-check.yml` | — | `pnpm lint` |

`build.yml` 的分支部署值得注意（`:47-59`）：先把 `dist/*` 复制到 `/tmp/dist`，再 `git checkout --orphan build-output` + `git reset --hard` + `rm -rf *`，最后把产物铺回并强推。因为要先离开工作区才能安全清空，所以先备份到 `/tmp`。

**`release.yml` 的产物矩阵**：

| Job | Runner | 产物 |
|-----|--------|------|
| `build-packages` | ubuntu | `noname.core.zip`（仅 `apps/core/dist`）、`noname.full.zip`（根 `dist`），各附 `.sha256` |
| `build-installer` | windows | `noname.Setup.<VER>.exe` + `.sha256` |
| `build-android` | ubuntu | `noname.android.apk` + `.sha256`（JDK 21、Android SDK 36、签名 keystore 来自 Secrets） |
| `release` | ubuntu | 草稿转正 + 发布到 Discussions「Announcements」 |

**关于 `core.zip` vs `full.zip`**：

```
noname.core.zip  ←  cd apps/core/dist && 7z a ...    （本体构建产物）
noname.full.zip  ←  cd dist          && 7z a ...    （含素材、内置扩展、docs）
```

这解释了一个常见困惑：`apps/core/dist` 里**没有 audio/image/extension**，它们只在根 `dist` 里（由根编排脚本 `fs.cp` 补上）。

所有压缩包都会 `7z t` 做**完整性校验**后才上传。`cleanup-release` job 在任一环节失败时删除草稿 Release（`--cleanup-tag=false`，保留 tag）。

---

## 7. 一页速查

```
pnpm build                     完整包 → dist/
pnpm generateTestPack          测试包 → output/testpack/
pnpm dev                        开发（8081 本体 + 8089 文件 API）
pnpm serve                      静态服务 dist/（8089）
pnpm init:extension <名>        新建扩展工程
pnpm lint                       全仓 eslint

pnpm -F @noname/electron build:win    → output/*.exe
pnpm -F @noname/mobile  build:android → APK
pnpm -F @noname/fs      build:win     → packages/fs/output/noname-server.exe
pnpm -F @noname/server  dev           → 联机大厅（8082）
```

**扩展的三句话**

1. 源码在 `packages/extension/<名>/`，产物在 `apps/core/extension/<名>/`。
2. 扩展由**自己的** Vite 构建，本体构建完全不碰它。
3. 到 `dist/extension/` 只经历一次 `fs.cp`。

---

## 8. 相关文档

| 主题 | 文档 |
|------|------|
| 扩展开发工具链、注册工具 | [14-dev-toolchain.md](14-dev-toolchain.md) |
| 技能与扩展编写基础 | [13-extending.md](13-extending.md) |
| 启动流程（`game.js` 之后发生什么） | [02-startup-to-game.md](02-startup-to-game.md) |
| 扩展骨架模板 | [templates/README.md](templates/README.md) |
| 运行与打包 FAQ | [../how-to-start.md](../how-to-start.md) |

### 源码依据

| 机制 | 位置 |
|------|------|
| workspace 成员与 lockfile 策略 | `pnpm-workspace.yaml:1-18` |
| 根编排脚本（构建 + 拼装） | `scripts/build.ts:1-25` |
| 本体/包体双路径构建 | `apps/core/scripts/build.ts:131-204` |
| 包体类型定义（无 extension） | `apps/core/scripts/build.ts:58-65, 252-263` |
| 静态资源列表（character/card/mode 已注释） | `apps/core/scripts/build.ts:40-51` |
| 编译目标 | `apps/core/scripts/build.ts:24` |
| importmap 插件与 `game.js` 生成 | `apps/core/scripts/vite-plugin-importmap.ts:20-131` |
| build-info 写入 / 读取 | `apps/core/scripts/build.ts:232-250`、`apps/core/noname/util/meta.ts:37-76` |
| 扩展运行时加载契约 | `apps/core/noname/init/import.ts:19-71` |
| 扩展脚手架与变量替换 | `scripts/initExtension.ts:10-95` |
| 扩展工程 Vite 配置（outDir 指向本体） | `scripts/extension-template/default/vite.config.ts:28-41` |
| 开发态三进程 | `scripts/dev.ts:1-4` |
| 测试包扩展与素材筛选 | `scripts/generateTestPack.ts:30-70` |
| Electron 打包配置 | `apps/electron/build.ts:4-56` |
| Capacitor 配置（webDir） | `apps/mobile/capacitor.config.ts:6` |
| 安卓构建四步与 JDK 21 校验 | `apps/mobile/buildAndroid.ts:29-88` |
| preload 构建与 `.pnpm` 修补 | `apps/mobile/afterSync.ts:22-84` |
| Node SEA 打包 | `packages/fs/build.ts:18-95` |
| CI 分支部署 / 产物矩阵 | `.github/workflows/build.yml:34-59`、`release.yml:88-256`、`nightly-publish.yml:46-53` |
| 入库白名单 | `packages/extension/.gitignore:1-9`、`apps/core/.gitignore` |

---

## 9. 实测验证记录

本篇不是纯源码阅读的产物——以下所有结论都经过**真实执行**。

**环境**：Windows · Node `v24.21.0` · pnpm `12.8.1` · 分支 `main` @ `2d20ae4`

### 9.1 验证方法与结果

| # | 验证项 | 执行 | 结果 |
|---|--------|------|------|
| 1 | 完整构建 | `pnpm build` | ✅ 4 次 Vite 构建全部成功（本体 + character + mode + card） |
| 2 | 根 `dist` 拼装 | 检查 8 个 `fs.cp` 目标 | ✅ 全部就位（`audio`/`image`/`extension`/`docs`/`.nomedia`/`LICENSE`/`README.md`/本体） |
| 3 | 本体构建不碰扩展 | 观察构建日志 | ✅ `apps/core/scripts/build.ts` 全程未提及 `extension/` |
| 4 | 扩展脚手架 | `pnpm init:extension 验证扩展 --author 验证者` | ✅ 生成 7 文件，`.gitkeep` 跳过，变量替换正确 |
| 5 | 扩展独立构建 | `pnpm -F @noname-extension/验证扩展 build` | ✅ 产物直接写入 `apps/core/extension/验证扩展/` |
| 6 | 产物文件集 | 对比 `viteStaticCopy` targets | ✅ 有 `extension.js`/`info.json`/`audio`/`image`/`LICENSE`；无 `src/`、无 `vite.config.ts` |
| 7 | **纯复制（核心）** | `pnpm build` 后 SHA256 比对 | ✅ **逐字节相同**，文件列表完全一致 |
| 8 | `emptyOutDir` 破坏性 | 手工放文件 + 篡改后重建 | ✅ 手工文件被删、`extension.js` 被静默还原 |
| 9 | 导出契约 | 读 `extension.js` | ✅ 同时导出 `type = "extension"` 与 `default` |
| 10 | 无 hash 命名 | 检查产物文件名 | ✅ `extension.js`（非 `extension-<hash>.js`） |
| 11 | 测试包扩展筛选 | `pnpm generateTestPack` | ✅ 12 个扩展中**只有** `boss`/`cardpile`/`coin` 进入 |
| 12 | 素材差集机制 | 对比 `asset.json` 与 testpack | ⚠️ 发现原描述不准确，已按实测重写（见 §3.7） |
| 13 | build-info 回退 | 不设环境变量构建 | ✅ `channel:"test"`、`builtAt:"unknown"`、`commit` = `git rev-parse HEAD` |
| 14 | importmap 解析 | 检查 `dist/index.html` | ✅ 裸标识符已解析为 `.pnpm` 实路径 |
| 15 | `game.js` 生成 | 读 `dist/game/game.js` | ✅ 含 importmap 注入、SW 注册、`/noname/entry.js` 加载 |
| 16 | Node SEA 服务端 | `pnpm -F @noname/fs build:win` | ✅ 产出 **90.1 MB** `noname-server.exe`，可执行 |
| 17 | SEA blob 注入 | 二进制字符串检索 | ✅ 含 `NODE_SEA_BLOB`，且 `fastify` 已打入 |
| 18 | Electron 构建 | `pnpm -F @noname/electron build` | ✅ `dist/app/main.js`(1.6 MB) + `preload.js`，`minify:false` 已确认 |
| 19 | core.zip vs full.zip | 检查 `apps/core/dist` | ✅ **无** `audio`/`image`/`extension`/`docs`——印证两包差异 |
| 20 | lockfile 分布 | 检查 6 个子包 | ✅ 各自持有 `pnpm-lock.yaml` |

### 9.2 实测推翻/修正的两处

**① §3.2.2 嵌套 `.git` 泄漏（新增发现）**

原文档未预料：`fs.cp` 无排除逻辑，导致两个「本身是 git 仓库」的扩展
（`新宇杀`、`英雄杀RE`）把 **92 个 `.git` 内部文件**带进了 `dist/extension/`。
`1260 → 1352` 的差额全部来自此处。已在 §3.2.2 补充成因与规避方式。

**② §3.7 素材差集的真实行为（修正原描述）**

原文档称「测试包只打包新增素材」，实测**不完全准确**：

| 目录 | dist 全量 | testpack 实际 | 原因 |
|------|----------|--------------|------|
| `audio` | 有 | **0** | 顶层跳过 + 无新增 |
| `image` | 4109 | **1** | 恰有 1 个新素材 `huhaibi.png` |
| `theme` | 104 | **104**（全量） | 含 28 个 `.css`，而 `.css` 被无条件跳过 → 永不参与差集 |
| `font` | 有 | **0** | 顶层跳过 + 无新增 |

关键机制：**顶层跳过只是第一道闸，差集是第二道闸**；而 `.css` 因 `generateTestPack.ts:42`
被跳过，使含 CSS 的目录（如 `theme/`）**整体**进入测试包。已按实测重写 §3.7。

### 9.3 验证中遇到的环境问题（非项目缺陷）

两者均**重试即通过**，与代码无关：

| 现象 | 原因 | 处置 |
|------|------|------|
| `Error [TransformError]: spawn EPERM` | 沙箱禁止子进程管道通信，esbuild 无法启动 | 放宽沙箱后正常 |
| `[vite:esbuild-transpile] ... Access is denied` | Windows 临时目录被占用/杀软干扰 | 切换 `TEMP` 到工作区内后通过 |

> 若你在 CI 或本地遇到同类报错，先排除临时目录与杀软，再怀疑构建配置。
>
> 这两条的**完整成因与通用处置**见 [§10](#10-受限环境与离线打包)，那里给出了逐条对应关系。

### 9.4 复现命令

```bash
# 核心结论（扩展 = 纯复制）的一键复现
pnpm init:extension 验证扩展 --author 验证者
pnpm i
pnpm -F '@noname-extension/验证扩展' build
pnpm build

# 断言：两侧文件列表一致、extension.js SHA256 相同
$h1 = (Get-FileHash apps/core/extension/验证扩展/extension.js -Algorithm SHA256).Hash
$h2 = (Get-FileHash dist/extension/验证扩展/extension.js   -Algorithm SHA256).Hash
$h1 -eq $h2    # → True
```

### 9.5 验证后的清理

测试产生的 `packages/extension/验证扩展`、`apps/core/extension/验证扩展` 与临时日志
**均已删除**，仓库已还原至验证前状态（`git status` 仅显示文档改动）。

---

## 10. 受限环境与离线打包

> 本节回答：**在沙箱/无管理员权限/网络受限的机器上，`build:win` 一路报错怎么办？**
>
> 前九节讲**设计**（产物是什么形状）；本节讲**实操**——把一次真实打包中
> 踩到的 4 类阻塞、逐条成因与处置固化下来。
>
> ✅ **本节结论已实机验证**（2026-10，Windows · Node 24.21.0 · pnpm 12.8.1 · Electron 39.5.2 · electron-builder 26.7.0），
> 最终产出 **1.62 GB** 的 `noname Setup 1.11.7.exe`。

### 10.1 先给结论：能开权限就别硬扛

打包链路的 4 类阻塞里，**有 3 类在给予更高权限后会直接消失**。因此：

> ✅ **优先建议：用「完全访问权限 / 管理员」跑打包。**
>
> - 本机（非沙箱）：**以管理员身份**运行终端即可
> - 受限沙箱：把该命令**单次放行**为完全访问（`danger-full-access` 量级），而不是逐条绕
>
> 唯一的例外是 §10.4 的**网络下载**——那与权限无关，需用镜像解决。

下表是两种情况的对照。**同一现象在"有沙箱"下需要额外手段，在"无沙箱"下大多不必处理**：

| # | 现象 | 无沙箱 / 管理员 | 有沙箱（受限） |
|---|------|----------------|---------------|
| 1 | `spawn EPERM`（esbuild/tsx） | 直接通过 | **需放宽权限**；否则 `TEMP` 改到工作区也无效（根因是管道通信被拒） |
| 2 | `[vite:esbuild-transpile] Access is denied`（删临时文件失败） | 直接通过 | **把 `TEMP`/`TMP` 指到工作区内** |
| 3 | `winCodeSign` 解压失败：`Cannot create symbolic link : A required privilege is not held by the client` | 直接通过（管理员/开发者模式可建符号链接） | **关闭签名**（§10.3），或开 Windows 开发者模式 |
| 4 | `Get "https://github.com/..." : connection attempt failed` | 视网络而定 | **同左**——与权限无关，用本地镜像（§10.4） |

### 10.2 阻塞一：子进程管道（`spawn EPERM`）

**症状**：

```
Error [TransformError]: spawn EPERM
    at ensureServiceIsRunning (.../esbuild/lib/main.js:1978:29)
    at ... tsx/dist/index-*.mjs
```

**成因**：esbuild 以一个**长驻子进程**提供服务，父子之间通过**管道**通信。
受限沙箱禁止程序打开命名管道，于是 `spawn` 直接 `EPERM`。

**注意**：这**不是** `TEMP` 的问题。把 `TEMP` 改到工作区对第 2 类阻塞有效，对本类**无效**。

> ⚠️ **不要反复重试同一命令**。这是沙箱的既定边界，重试必然同样失败。
> 应当**放宽该次命令的权限**。

### 10.3 阻塞二：临时目录与符号链接

#### ① 临时文件删除被拒

**症状**：

```
[vite:esbuild-transpile] remove C:\Users\<用户>\AppData\Local\Temp\esbuild-<hash>: Access is denied
```

**成因**：esbuild 的临时文件写在系统 `TEMP`，受限沙箱下该路径不可写/不可删。

**处置**——把临时目录指到工作区内：

```powershell
$root = "<项目根>"
New-Item -ItemType Directory -Force "$root\.tmp" | Out-Null
$env:TEMP = "$root\.tmp"; $env:TMP = "$root\.tmp"
```

实测：仅此一改，`vite build` 即从"连接被拒"变为正常产出
（`dist/app/main.js` 1640 kB + `dist/app/preload.js`）。

#### ② `winCodeSign` 解压失败（符号链接）⭐

**症状**（会**反复重试**，每次换一个哈希目录名）：

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
  : ...\electron-builder\Cache\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
ERROR: Cannot create symbolic link : ...\libssl.dylib
command='...\7za.exe' x -snld -bd 'winCodeSign-2.6.0.7z' '-o...\<hash>'
```

**成因**：`winCodeSign-2.6.0.7z` 里含 **macOS 的符号链接**（`darwin/10.12/lib/*.dylib`）。
在 Windows 上创建符号链接需要**管理员权限或「开发者模式」**，二者皆无时解压报错。

**两个关键事实**（排查时容易走错方向）：

1. **只有 `darwin/` 下的 2 个文件失败，Windows 工具链全部解压成功。**
   实测手工解压后 `windows-10\x64\signtool.exe`、`windows-6\signtool.exe`、
   `rcedit-x64.exe` 等**都已就位**——所以**缺的不是工具，是一个权限**。
2. **目录名每次运行都变**（如 `136807847`→`370719663`→`493077647`）。
   因此**预置缓存目录并无法绕过**：`app-builder.exe`（Go 二进制）自行下载解压，
   它读的是自己写的 `.complete` 标记，外部预置的标记不被识别。

**处置（推荐）——关闭签名**：

`winCodeSign` 是**为了代码签名**才需要的。而本项目**本来就不签名**：

```ts
// apps/electron/build.ts:35
verifyUpdateCodeSignature: false,
```

因此可以直接跳过签名这一步，命令即可从"卡在解压"变为"跑通到 NSIS"：

```bash
npx electron-builder --win nsis --x64 \
  --config.asar=false --config.appId=com.libnoname.noname \
  --config.productName=noname --config.directories.output=../../output \
  --config.win.signAndEditExecutable=false \
  --config.win.verifyUpdateCodeSignature=false
```

> ⚠️ **副作用：`signAndEditExecutable: false` 会连带跳过「写图标」。**
> 日志会出现 `default Electron icon is used  reason=application icon is not set`，
> 安装后的程序用 **Electron 默认图标**，而非 `apps/electron/noname.ico`。
>
> 原因是「写图标」与「签名」同属**编辑可执行文件**这一步。
> **若要带图标**：以管理员身份运行（§10.1），此时符号链接可建、`winCodeSign` 正常解压，
> 无需关闭该开关。

**处置（备选）——开 Windows 开发者模式**：
`设置 → 系统 → 开发者选项 → 开发人员模式` 打开后，符号链接无需管理员即可创建，
`winCodeSign` 便能正常解压，可保留图标。

### 10.4 阻塞三：工具链下载（与权限无关）

**症状**：CDN 访问超时——

```
⨯ Get "https://github.com/electron-userland/electron-builder-binaries/releases/download/
   nsis-3.0.4.1/nsis-3.0.4.1.7z": ... failed to respond
```

**成因**：electron-builder 需要联网拉取 `nsis-3.0.4.1` / `nsis-resources-3.4.1`
（以及 Electron 二进制）。国内网络下 GitHub 直连不稳定。

**⚠️ 注意一个反直觉点**：这条**放权限也没用**——它与沙箱无关。

**处置：本地镜像 + 官方环境变量**

`binDownload.js:177` 支持一个覆盖 URL 的环境变量：

```js
// apps/electron/node_modules/.../app-builder-lib/out/binDownload.js:177-179
if (process.env.ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL) {
    url = process.env.ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL + "/" + filenameWithExt;
}
```

于是可以：**手工下载一次 → 起个本地 HTTP 服务 → 让 builder 从本地取**。

```bash
# ① 下载（Node 的 https 比 PowerShell 的 Invoke-WebRequest / curl 更稳；
#    后者在本机分别报 "connection closed" 与 schannel SEC_E_NO_CREDENTIALS）
node -e "…https.get 到 .tmp/ebcache/ 下…"

# ② 起本地镜像（把两个 .7z 平铺在一个目录）
node .tmp/mirror-server.mjs .tmp/bins 8799

# ③ 指向镜像
export ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL="http://127.0.0.1:8799"
```

> ✅ **务必核对 SHA512**：源码内写死了期望值（`nsisUtil.js:35,51`），
> 本地文件与之相符才说明下载完整。

| 包 | 期望 SHA512（源码内） |
|----|---------------------|
| `nsis-3.0.4.1.7z` | `VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoW…` |
| `nsis-resources-3.4.1.7z` | `Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0…` |

实测两条均**完全一致**，随后 builder 从 `http://127.0.0.1:8799` 取包耗时 12ms / 9ms。

**缓存位置**：electron-builder 的缓存根目录可用 `ELECTRON_BUILDER_CACHE` 改写
（`binDownload.js:41-46`）。受限沙箱下 `%LOCALAPPDATA%` 不可写，必须指到工作区：

```bash
export ELECTRON_BUILDER_CACHE="$root/.tmp/ebcache"
```

> ⚠️ 注意 `getBin` 的缓存键是 `` `${ELECTRON_BUILDER_CACHE}${cacheKey}` ``
> （`binDownload.js:199`）——**换了缓存目录等于换了一套缓存**，旧缓存会被忽略。

### 10.5 ⚠️ 最危险的一步：`files` 配置被绕过会产出"看似成功"的废包

这是本次打包**最值得记录**的坑，因为它**不报错**。

**症状**：`electron-builder` 退出码 **0**、日志显示 `building target=nsis ... ✅`、
安装包也生成了——但**只有 116 MB，且里面没有游戏本体**。

**成因**：`apps/electron/build.ts` 的 `files` 映射把**仓库根的 `dist/`**（游戏本体）打进去：

```ts
// apps/electron/build.ts:13-18
files: [
    { from: "dist", to: "" },                        // 主进程/预加载
    { from: "../../dist", to: "" },                  // ★ 游戏本体
    { from: "../../dist/node_modules", to: "node_modules" },
    "package.json",
],
```

而**改用命令行传参**时（`--config.xxx=yyy`）若**没有**同时提供 `files`，
electron-builder 会**回退到默认模式** `**/*`，只把 `apps/electron/` 自身打进去。

**自查方法**（打包后**必做**）：

```powershell
# 正确：应看到 audio/ card/ character/ extension/ game/ image/ mode/ + index.html
Get-ChildItem output\win-unpacked\resources\app | Select-Object Name

# 错误（默认模式）只会看到：app/ dist/ node_modules/ + build.ts vite.config.ts package.json
```

**体积可作为旁证**：

| 情况 | 体积 | `resources/app` 内容 |
|------|------|---------------------|
| ✅ 正确 | **~1.62 GB** | 含全部素材与扩展 |
| ❌ `files` 未生效 | ~116 MB | 仅外壳 + `node_modules` |

**处置**：**优先用项目自带脚本**（`pnpm -F @noname/electron build:win`），
它已内置正确的 `files`。若要自定义（如关闭签名），用**等价配置文件**而非零散命令行参数：

```json
{
  "asar": false,
  "appId": "com.libnoname.noname",
  "productName": "noname",
  "directories": { "output": "../../output" },
  "files": [
    { "from": "dist", "to": "" },
    { "from": "../../dist", "to": "" },
    { "from": "../../dist/node_modules", "to": "node_modules" },
    "package.json"
  ],
  "extraMetadata": { "main": "app/main.js" },
  "win": { "icon": "noname.ico", "signAndEditExecutable": false, "verifyUpdateCodeSignature": false },
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
}
```

```bash
npx electron-builder --win nsis --x64 --config eb-config.json
```

### 10.6 完整可复现流程（受限环境）

```powershell
$root = "<项目根>"
cd "$root\apps\electron"

# ① 临时目录 → 工作区
New-Item -ItemType Directory -Force "$root\.tmp" | Out-Null
$env:TEMP = "$root\.tmp"; $env:TMP = "$root\.tmp"

# ② 缓存 → 工作区（沙箱下 %LOCALAPPDATA% 不可写）
$env:ELECTRON_BUILDER_CACHE = "$root\.tmp\ebcache"
$env:ELECTRON_CACHE         = "$root\.tmp\ebcache\electron"

# ③ 工具链走本地镜像（避免 GitHub 超时）
$env:ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL = "http://127.0.0.1:8799"

# ④ 构建（关闭签名以绕过符号链接限制；用配置文件保住 files 映射）
npx electron-builder --win nsis --x64 --config eb-config.json

# ⑤ 校验产物（务必！见 §10.5）
Get-ChildItem "$root\output\noname Setup *.exe"
Get-ChildItem "$root\output\win-unpacked\resources\app"   # 应含 game/ image/ extension/
```

> 💡 **有权限时**可以省掉 ③ 之外的全部步骤：直接 `pnpm -F @noname/electron build:win`
> 即可（管理员运行时符号链接可建、图标可写，网络正常时工具链自动下载）。

### 10.7 产物校验清单

打完包**不要只看退出码**，逐条核对：

| # | 检查 | 期望 |
|---|------|------|
| 1 | 退出码 | `0` |
| 2 | 安装包存在 | `output/noname Setup <版本>.exe` |
| 3 | **体积合理** | **~1.6 GB**（若仅 ~100 MB → 命中 §10.5） |
| 4 | **`resources/app` 含本体** | `game/`、`image/`、`extension/`、`index.html`、`noname.js` |
| 5 | **目标扩展在内** | 如 `extension/新宇杀/extension.js` 存在 |
| 6 | PE 头 | 前两字节为 `MZ` |
| 7 | NSIS 标记 | 二进制内含 `0xDEADBEEF`（本机实测位于 offset 9148） |
| 8 | 版本信息 | `VersionInfo.FileVersion` = 期望版本 |
| 9 | 记录 SHA256 | 存档/发布用 |

> 🔬 **第 7 条的用法**：NSIS 安装器的签名是 4 字节小端 `EF BE AD DE`，
> 等价于 `0xDEADBEEF`。用它与 `MZ` 头一起判定"这确实是个 NSIS 安装器"，
> 比只看文件大小可靠。

### 10.8 本节小结

- **能开权限就开**：4 类阻塞中 3 类在管理员/完全访问下自动消失，
  只有"网络下载"需要镜像。
- **`spawn EPERM` 是管道问题，不是 `TEMP` 问题**——改 `TEMP` 救不了它，别白试。
- **`winCodeSign` 失败只缺一个符号链接权限**；Windows 工具链其实已解压好。
  关签名可绕过，代价是**丢图标**。
- **工具链下载失败放权限也没用**，用
  `ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL` + 本地镜像。
- ⚠️ **退出码 0 不代表包是对的**：`files` 被绕过会产出 ~100 MB 的空壳包。
  **必须检查 `resources/app` 是否含游戏本体**。
