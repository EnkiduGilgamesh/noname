# 18 · 安卓打包实战

> 本篇回答：**怎么把《无名杀》打成 APK？为什么我的构建在 Java/SDK 这一步就挂了？签名怎么配？**
>
> 与第 17 篇的分工：17 篇 §4.3 用 40 行讲清了安卓端的**设计**（Capacitor 四步、`.pnpm` 修补）；
> 本篇是**施工版**——环境怎么搭、每一步在做什么、失败怎么查，
> 并补齐 17 篇未覆盖的 `versionCode`、edge-to-edge、SAF 文件模型等。
>
> 源码基线：`apps/core` 1.11.7，Capacitor 8，`minSdk 26 / targetSdk 36`。
>
> ⚠️ **本篇未经实机验证**（编写时本机无 JDK 与 Android SDK，见 §7）。
> 所有结论来自源码阅读，已逐条标注出处；与 17 篇 §4.3 的实测部分**互补而非重复**。

---

## 0. 一句话结论

> **安卓包 = 一次 `pnpm build`（Web 产物）+ 一次 Capacitor 同步 + 一次 Gradle 编译。**
>
> 而**唯一的硬门槛是 JDK 21 与 Android SDK**——脚本会在最前面就拦下不满足的环境。

```bash
pnpm -F @noname/mobile build:android          # → app-release.apk
pnpm -F @noname/mobile build:android -- --aab # → app-release.aab
```

---

## 1. 前置环境（**最容易卡住的地方**）

### 1.1 三样必需

| 依赖 | 要求 | 校验方式 |
|------|------|---------|
| **Node.js / pnpm** | 能跑 workspace 根构建 | —— |
| **JDK** | **必须 21** | `java -version` |
| **Android SDK** | `platforms;android-36` + `build-tools;36.0.0` | `sdkmanager` |

> ⚠️ **Android Studio 不需要**。Gradle Wrapper（`gradlew.bat`）自带构建能力，
> 命令行即可出包（`apps/mobile/README.md:18`）。

### 1.2 JDK 版本是硬校验

脚本在**任何构建动作之前**先检查 Java：

```ts
// apps/mobile/buildAndroid.ts:76-88
function checkJavaVersion() {
    const result = spawnSync("java", ["-version"], { encoding: "utf8" });
    const versionOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = versionOutput.match(/version "(\d+)/);
    const major = match ? Number(match[1]) : undefined;

    if (major === undefined) {
        throw new Error("Java was not found. Install JDK 21 and make sure java is available on PATH.");
    }
    if (major !== 21) {
        throw new Error(`JDK 21 is required for this Android build; detected JDK ${major}. Set JAVA_HOME to a JDK 21 installation.`);
    }
}
```

**两个已知的失败模式**：

| 现象 | 原因 |
|------|------|
| `Java was not found` | `java` 不在 PATH |
| `detected JDK 25` | 版本不是 21 —— **JDK 25 会在 Android 工程配置阶段失败**（`apps/mobile/README.md:45`） |

### 1.3 只切当前会话的 Java（推荐）

不要去改系统级 Java 配置，按平台临时设置即可：

```powershell
# Windows PowerShell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
pnpm -F @noname/mobile build:android
```

```bash
# Linux / macOS / CI
export JAVA_HOME="/path/to/jdk-21"
export PATH="$JAVA_HOME/bin:$PATH"
pnpm -F @noname/mobile build:android
```

> ✅ 这样做是**临时且进程内**的，不影响系统全局 Java。

### 1.4 SDK 版本要求

`apps/mobile/android/variables.gradle`：

```gradle
ext {
    minSdkVersion = 26          // Android 8.0
    compileSdkVersion = 36
    targetSdkVersion = 36
    ...
}
```

对应 CI 里安装的包（`.github/workflows/release.yml:218`）：

```bash
sdkmanager "platforms;android-36" "build-tools;36.0.0"
```

> ⚠️ **只装 SDK 不够，还要接受许可**：`yes | sdkmanager --licenses`
> （`release.yml:217`）。许可证未接受时 Gradle 会报错退出。

---

## 2. 构建链路：四步都做了什么

`buildAndroid.ts` 的流程（`apps/mobile/buildAndroid.ts:29-41`）：

```
checkJavaVersion()                    ← 硬校验 JDK 21
   ↓
pnpm build            （工作区根）      ← Web 产物 → dist/
   ↓
pnpm sync             （apps/mobile）  ← afterSync.ts：preload + cap sync + .pnpm 修补
   ↓
gradlew assembleRelease               ← Gradle 出 APK
```

### 2.1 第一步：Web 产物

`buildAndroid.ts:34` 在 **workspace 根**执行 `pnpm build`。

⚠️ 这与第 17 篇 §2.1 的完整构建**完全是同一件事**——包括它「`fs.rm("dist")` 在构建之后执行」
的特性。所以**第 17 篇 §10.5 的「空壳包」陷阱同样适用于安卓**：
若 `dist/` 内容不对，APK 里也就是错的。

用 `--skip-web-build` 可复用已有 `dist/`（`buildAndroid.ts:31-32`），
适合「只改了安卓侧、Web 未变」的场景。

### 2.2 第二步：`sync` 里的三件事 ⭐

`apps/mobile/afterSync.ts` 依次做三件事，**顺序不能乱**：

#### ① `buildPreload()` —— 编译 preload 脚本

把 `src/preload.ts` 用 Vite lib 模式编译成**单文件** `dist/preload.js`
（`afterSync.ts:22-52`）：

```ts
lib: {
    entry: resolve(root, "src/preload.ts"),
    formats: ["es"],
    fileName: () => "preload.js",
},
rollupOptions: {
    output: { inlineDynamicImports: true },   // ★ 保证单文件
},
```

**为什么需要它**：安卓端要挂原生桥（SAF 文件访问），而 preload 必须在
WebView 加载游戏**之前**注入（详见 §4）。

> 🔬 **顺带清理旧产物**（`afterSync.ts:12-20`）：匹配
> `/^(preload(?:-.+)?|web-.+|index\.esm-.+)\.js$/` 的文件会被删除。
> 这是为了避免历史构建的文件名残留导致加载到旧版本。

#### ② `capSync()` —— Capacitor 同步

```ts
// afterSync.ts:54-67
const command = process.platform === "win32" ? "cmd" : "cap";
const args = process.platform === "win32" ? ["/c", "cap", "sync"] : ["sync"];
```

⚠️ **Windows 下走 `cmd /c cap sync`**，不是直接调 `cap`。
如果你自己手敲 `cap sync` 报「不是内部或外部命令」，就是这个原因——
用 `pnpm sync` 或 `npx cap sync`。

`cap sync` 把 `webDir` 的 Web 资源复制进安卓工程：

```ts
// apps/mobile/capacitor.config.ts:6
webDir: "../../dist",
```

落点：`android/app/src/main/assets/public/`。

#### ③ `patchAndroidAssets()` —— `.pnpm` → `_pnpm` ⭐

```ts
// afterSync.ts:69-80
function patchAndroidAssets() {
    const pnpmDir = resolve(androidAssetsNodeModules, ".pnpm");
    const androidSafePnpmDir = resolve(androidAssetsNodeModules, "_pnpm");
    if (!existsSync(pnpmDir)) return;
    if (existsSync(androidSafePnpmDir)) {
        rmSync(androidSafePnpmDir, { recursive: true, force: true });
    }
    renameSync(pnpmDir, androidSafePnpmDir);
}
```

**这是全流程最隐蔽的一个坑**：pnpm 在 `node_modules` 下建 `.pnpm` 目录，
而 **Android 构建工具链会把「以点开头」的目录当作隐藏文件忽略或拒绝打包**，
导致 Capacitor 插件在真机上找不到依赖。

重命名为 `_pnpm` 绕过该限制。

> ⚠️ 因此：**每次 `cap sync` 之后都必须跑这个修补**。
> 如果你手工跑 `npx cap sync` 而没走 `pnpm sync`，`.pnpm` 会重新出现，真机上可能崩。
> 这三步封装成一个命令正是为了防这个失误。

### 2.3 第三步：Gradle

```ts
// apps/mobile/buildAndroid.ts:39-41
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "bash";
const gradleArgs = process.platform === "win32"
    ? [task, "--no-daemon", "--stacktrace"]
    : ["gradlew", task, "--no-daemon", "--stacktrace"];
run(gradleCommand, gradleArgs, androidRoot, `Android ${task}`);
```

| 参数 | 作用 |
|------|------|
| `--no-daemon` | 不复用常驻 Gradle 守护进程（CI 友好，避免残留进程） |
| `--stacktrace` | 失败时给完整堆栈，便于定位 |

**任务名由参数决定**（`buildAndroid.ts:10-12`）：

| 命令 | 变体 | Gradle 任务 |
|------|------|------------|
| `build:android` | `release`（默认） | `assembleRelease` |
| `build:android -- --variant=debug` | `debug` | `assembleDebug` |
| `build:android -- --aab` | `release` | `bundleRelease` |

> ⚠️ 变体名会被校验：`/^[a-z][a-z0-9]*$/`（`buildAndroid.ts:14`），
> 且首字母大写后拼进任务名（`capitalize`，`buildAndroid.ts:55-57`）。

### 2.4 产物路径

```ts
// apps/mobile/buildAndroid.ts:43-51
const output = resolve(
    androidRoot,
    "app/build/outputs",
    args.has("--aab")
        ? `bundle/${normalizedVariant}/app-${normalizedVariant}.aab`
        : `apk/${normalizedVariant}/app-${normalizedVariant}.apk`
);
if (!existsSync(output)) {
    throw new Error(`Gradle completed, but the expected artifact was not found: ${output}`);
}
```

| 产物 | 路径 |
|------|------|
| **APK**（release） | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` |
| **AAB**（release） | `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` |

> ✅ 脚本**最后会校验产物是否存在**，Gradle 假成功也会被拦下。

---

## 3. 签名

### 3.1 两条来源，环境变量优先

`android/app/build.gradle.kts:13-16`：

```kotlin
val releaseStoreFile     = signingValue("storeFile",     "ANDROID_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias      = signingValue("keyAlias",      "ANDROID_KEY_ALIAS")
val releaseKeyPassword   = signingValue("keyPassword",   "ANDROID_KEY_PASSWORD")
```

读取顺序：**环境变量 → `android/keystore.properties`**。

### 3.2 没配签名会怎样？

**不会失败**，而是**回退到 debug keystore**（`app/build.gradle.kts:60,76-79`）：

```
logger.warn("Release signing is not configured; falling back to the debug keystore.")
```

> ⚠️ 这个回退**对自测友好、对分发有毒**：
> - 用 debug 签名的包**无法上传 Google Play**
> - 也**无法覆盖安装**到已装 release 签名的设备上（签名不一致）
>
> 自己测试没问题；**要发给别人或上架，必须配 release 签名**。

### 3.3 本地配置

创建 `apps/mobile/android/keystore.properties`（**已被 git 忽略**）：

```properties
storeFile=C:/path/to/noname-release.jks
storePassword=your-store-password
keyAlias=noname
keyPassword=your-key-password
```

生成 keystore（若还没有）：

```bash
keytool -genkeypair -v -keystore noname-release.jks -alias noname \
  -keyalg RSA -keysize 2048 -validity 10000
```

### 3.4 CI 配置

用环境变量（`release.yml:235-244`），keystore 以 base64 存 Secret：

```text
ANDROID_KEYSTORE_PATH=/secure/path/noname-release.jks
ANDROID_KEYSTORE_PASSWORD=...
ANDROID_KEY_ALIAS=noname
ANDROID_KEY_PASSWORD=...
```

CI 侧流程（`release.yml:223-233`）：从 `ANDROID_KEYSTORE_BASE64` 解码出 `.jks`
→ 写入 `$RUNNER_TEMP` → 导出 `ANDROID_KEYSTORE_PATH` 供构建使用。

> 🔴 **务必保管好 keystore 与密码**。丢失后**无法再更新已发布的应用**
> （Google Play 强制要求同签名，除非走 Play App Signing 的密钥重置流程）。
> 且**不要入库**——`keystore.properties` 已在忽略列表里，`.jks` 也不要提交。

---

## 4. 两处容易忽略的设计

### 4.1 edge-to-edge 与系统栏遮蔽 ⭐

`capacitor.config.ts:9-17` 记录了一个**只在 Android 15/16 出现**的问题：

```ts
// 安卓 15/16 对 targetSdk 35+ 强制 edge-to-edge，系统栏会浮在 WebView 上层并吃掉
// 页面顶部那一带的触摸，导致左上角系统按钮（选项/整理手牌/收藏）和选项菜单的
// 标签栏（武将/扩展等）点不到。这里启动即隐藏系统栏，与旧 Cordova 端默认
// 隐藏状态栏（show_statusbar_android 默认 false）的行为保持一致。
SystemBars: {
    hidden: true,
    style: "DARK",
},
```

**含义**：本项目 `targetSdk = 36`（≥35），因此**必然**处于强制 edge-to-edge 环境。
若不隐藏系统栏，**顶部一排按钮点不动**——这是"UI 正常显示但点不到"的典型症状，
容易被误判为前端 bug。

> 🔬 排查提示：遇到「安卓上某些按钮点不到、桌面端正常」，先怀疑这一层，
> 而不是去改 `ui.click` 逻辑。

### 4.2 SAF 文件模型：只读资源 + 可写覆盖层

安卓端不能用 Node 的 `fs`，改用 **Android SAF** 做「覆盖层」（`apps/mobile/README.md:75-82`）：

```
APK assets（只读基础层）
   +
SAF 目录（可写覆盖层）
   ↓
读取/静态请求：先查 SAF，未命中回落 APK assets
写入/删除/导出：只影响 SAF
```

**三个要点**：

1. **安装时不复制整个游戏目录** —— 避免安装体积翻倍与耗时
2. **SAF 目录可以是空的** —— `noname.js` 等核心文件直接从 APK assets 读
3. **同名文件 SAF 优先** —— 删掉 SAF 里的文件就会重新露出打包资源

**启动时申请权限**：`src/preload.ts` 在启动游戏前请求 SAF 目录访问，
并以**可持久化的读写 URI 权限**保存（`apps/mobile/README.md:84-90`）。

**原生桥名为 `SafFs`**，暴露这些 API 给 `game.*`（`apps/mobile/README.md:92-107`）：

```
checkFile / checkDir
readFile / readFileAsText
writeFile
removeFile / removeDir
getFileList
createDir
```

> ⚠️ **读 API 有覆盖语义，写 API 只碰 SAF**；
> 试图修改「仅存在于 APK assets」的文件会被**拒绝**。
> 这一条对写扩展的人很重要：**运行时写文件不会改变安装包内容**。

---

## 5. 命令速查

```bash
# 完整构建（Web + 同步 + Gradle），产物 APK
pnpm -F @noname/mobile build:android

# 打 AAB（上架 Google Play 用）
pnpm -F @noname/mobile build:android -- --aab

# debug 变体
pnpm -F @noname/mobile build:android -- --variant=debug

# 复用已有 dist（只改了安卓侧时省时间）
pnpm -F @noname/mobile build:android -- --skip-web-build

# 只要同步（改完 Web 后手动跑 Android Studio 的场景）
pnpm -F @noname/mobile sync

# 帮助
pnpm -F @noname/mobile build:android -- --help
```

> ⚠️ **`--` 是必须的**：`pnpm -F ... build:android -- --aab`
> 中第一个 `--` 是 pnpm 的参数分隔符，漏掉的话 `--aab` 会被 pnpm 自己吃掉。

---

## 6. 排错表

| 症状 | 根因 | 处置 |
|------|------|------|
| `Java was not found` | `java` 不在 PATH | 装 JDK 21 并配 PATH（§1.3） |
| `JDK 21 is required ... detected JDK 25` | 当前 Java 不是 21 | 切 `JAVA_HOME` 到 21（§1.3） |
| 卡在 Android 工程配置阶段 | **JDK 25** 不被支持 | 降到 21（`README.md:45`） |
| `sdkmanager` 报许可未接受 | 未接受 SDK 许可 | `yes \| sdkmanager --licenses` |
| 找不到 `platforms;android-36` | SDK 包缺失 | `sdkmanager "platforms;android-36" "build-tools;36.0.0"` |
| `'cap' 不是内部或外部命令` | Windows 需 `cmd /c cap` | 用 `pnpm sync`，别手敲（§2.2②） |
| 真机上插件找不到依赖 | `.pnpm` 未被改名 | 用 `pnpm sync`（含修补），别手敲 `cap sync`（§2.2③） |
| 资产目录又有 `.pnpm` | 手跑了 `cap sync` | 重跑 `pnpm sync` |
| **顶部按钮点不到** | Android 15/16 强制 edge-to-edge | 已由 `SystemBars.hidden` 处理；若仍复现查此配置（§4.1） |
| 装包提示签名冲突 | 用了 debug keystore | 配 release 签名（§3） |
| 想上传 Play 被拒 | debug 签名的包不能上架 | 同上 |
| Gradle 成功但找不到产物 | 变体名/任务名不匹配 | 脚本已校验并报路径（§2.4） |

---

## 7. 本篇的验证状态（**重要**）

编写本篇时，本机环境**不具备**安卓构建条件：

```powershell
java                  → 不在 PATH
JAVA_HOME             → 空
ANDROID_HOME          → 空
ANDROID_SDK_ROOT      → 空
```

因此：

| 内容 | 验证状态 |
|------|---------|
| 脚本流程、参数、产物路径、签名回退逻辑 | 源码阅读（已标行号） |
| `variables.gradle` / `build.gradle.kts` 配置 | 源码阅读 |
| SAF 模型、`SystemBars`、`.pnpm` 修补 | 引自 `apps/mobile/README.md`（该文件记录了实测） |
| **实际能否成功出包** | ❌ **未验证** |

> ⚠️ **首次实际打包时，请以真实报错为准修正本篇**。
> 这与第 17 篇 §9 的"实测验证记录"标准不同——那篇是跑过的，本篇不是。
> 按本仓库惯例，建议实机跑通后补一节「实测验证记录」。

---

## 8. 相关文档

| 主题 | 文档 |
|------|------|
| 打包体系总览（含安卓端设计） | [17-build-and-packaging.md](17-build-and-packaging.md) §4.3 |
| **受限环境与离线打包**（沙箱/网络） | [17-build-and-packaging.md](17-build-and-packaging.md) §10 |
| 移动端工程说明（SAF、原生桥） | `apps/mobile/README.md` |
| 扩展开发（写入行为受 SAF 限制） | [13-extending.md](13-extending.md) |
| UI 排障（含"点不到"类症状） | [15-ui-development.md](15-ui-development.md) |

### 源码依据

| 机制 | 位置 |
|------|------|
| 构建四步与产物校验 | `apps/mobile/buildAndroid.ts:29-53` |
| JDK 21 硬校验 | `apps/mobile/buildAndroid.ts:76-88` |
| 变体名与任务名映射 | `apps/mobile/buildAndroid.ts:10-14, 39-41, 55-57` |
| sync 三件事 | `apps/mobile/afterSync.ts:82-84` |
| preload 编译 | `apps/mobile/afterSync.ts:22-52` |
| `.pnpm` → `_pnpm` 修补 | `apps/mobile/afterSync.ts:69-80` |
| `webDir` | `apps/mobile/capacitor.config.ts:6` |
| edge-to-edge 与系统栏 | `apps/mobile/capacitor.config.ts:9-17` |
| SDK 版本 | `apps/mobile/android/variables.gradle:1-6` |
| 签名读取与 debug 回退 | `apps/mobile/android/app/build.gradle.kts:13-16, 49-79` |
| CI 安卓流水线 | `.github/workflows/release.yml:175-255` |
