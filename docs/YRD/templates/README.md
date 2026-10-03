# 武将扩展开发模板库

> 一套**可直接复制使用**的《无名杀》武将扩展模板。所有代码均基于真实源码约定，非臆造。
>
> 适用版本：`apps/core` version 1.11.4.1（ES Module + async 引擎）
>
> ⚠️ **行号提示**：本库引用的源码行号以 1.11.4.1 为准。在 1.11.7 上实测
> **183 处引用中 0 处行号越界**，仅极少数位置有轻微位移
> （如 `import.ts` 的 `type`/`default` 校验已从 `:72-77` 移到 `:65-70`）。
> 跳转对不上时按符号名搜索即可。

---

## 一、目录结构

一个完整扩展的标准结构：

```
apps/core/extension/我的扩展/
├── extension.js              ★ 扩展入口（必需）
├── info.json                 ★ 元信息（必需，关闭扩展时也要能读）
├── LICENSE                   许可证（建议）
├── main/
│   ├── precontent.js         ★ 扩展加载前：import 武将包
│   └── content.js            扩展加载后：rank、config 后处理
├── character/                ★ 武将包
│   ├── index.js              ★ 武将包入口
│   ├── character.js          武将定义
│   ├── skill.js              技能定义
│   ├── translate.js          翻译（武将名 + 技能名 + 技能描述）
│   ├── intro.js              武将介绍（可选）
│   ├── sort.js               分组排序（可选）
│   ├── characterFilter.js    筛选器（可选）
│   ├── dynamicTranslate.js   动态描述（可选）
│   ├── voices.js             配音表（可选）
│   └── pinyin.js             拼音（可选，用于搜索）
├── card/                     卡牌包（可选，结构同上）
├── image/
│   ├── character/            武将立绘 <id>.jpg
│   └── card/                 卡牌图 <id>.png
└── audio/
    ├── skill/                技能配音 <skillId>.mp3
    └── card/                 卡牌配音 <cardId>_male.mp3 / _female.mp3
```

**最小可用集合**（只想加几个武将时）：

```
apps/core/extension/我的扩展/
├── extension.js
├── info.json
├── main/precontent.js
└── character/
    ├── index.js
    ├── character.js
    ├── skill.js
    └── translate.js
```

---

## 二、文件清单与模板

| 文件 | 模板 | 必填 |
|------|------|------|
| `info.json` | [02-info.json](02-info.json) | ✅ |
| `extension.js` | [03-extension.js](03-extension.js) | ✅ |
| `main/precontent.js` | [04-precontent.js](04-precontent.js) | ✅ |
| `main/content.js` | [05-content.js](05-content.js) | 可选 |
| `character/index.js` | [06-character-index.js](06-character-index.js) | ✅ |
| `character/character.js` | [07-character.js](07-character.js) | ✅ |
| `character/translate.js` | [08-translate.js](08-translate.js) | ✅ |
| `character/sort.js` | [09-sort.js](09-sort.js) | 可选 |
| `character/intro.js` | 见 §五 | 可选 |
| `character/characterFilter.js` | 见 §五 | 可选 |
| 技能模板 10 类 | [templates/](templates/) | — |

---

## 三、关键约定（必读）

### 3.1 两个必须的 export

`extension.js` **必须**同时导出 `type` 和 `default`：

```js
export let type = "extension";      // ← 引擎据此校验类型
export default extensionPackage;    // ← 扩展主体
```

来源：`apps/core/noname/init/import.ts:65-70`

```ts
if (!modeContent.type) return;
if (modeContent.type !== type) {
    throw new Error(`Loaded Content doesn't match "${type}" (received "${modeContent.type}").`);
}
await game.import(type, modeContent.default);
```

⚠️ 同理，武将包 `character/index.js` 用 `game.import("character", fn)`，**不需要** `type` 导出（那是扩展独有的）。

### 3.2 precontent 负责引入武将包

```js
// main/precontent.js
export function precontent(config, pack) {
    import("../character/index.js");   // ← 在此 import，注册 game.import
    lib.translate.我的扩展_character_config = "我的扩展";   // 分组显示名
}
```

⚠️ 顺序很重要：`precontent` 在扩展主体加载**前**执行，是武将包注册的唯一时机。

来源：`apps/core/extension/英雄杀/main/precontent.js:2-6`

### 3.3 武将包 name 是分组 ID

```js
game.import("character", function () {
    return {
        name: "mypack",        // ← 分组 ID，用于 lib.characterPack["mypack"]
        character: { ... },
        skill: { ... },
        translate: { ... },
    };
});
```

⚠️ 武将 ID 建议加前缀（如 `mypack_guanyu`）避免与本体冲突。

---

### 3.3 武将包 name 会被覆盖（**重要陷阱**）

```js
game.import("character", function () {
    return {
        name: "mypack",        // ← 在扩展内，这个值【会被强制覆盖】
        character: { ... },
    };
});
```

依据：`apps/core/noname/init/loading.ts:269`

```ts
const content = { ...extension[4].character };
content.name = extension[0];        // ← 强制改为扩展文件夹名
content.translate ??= {};
content.translate[content.name] ??= extension[0];
```

**含义**：
- 扩展内的武将包 `name` **永远等于扩展文件夹名**，写什么都无效
- 所以 `英雄杀` 扩展里写 `name: "yxs"`，实际生效值是 `"英雄杀"`
- **`characterSort` 的内层键应与扩展目录名一致**（UI 用 `lib.characterSort[mode][packName]` 取值，`characterPackMenu.js:276`）
- 翻译表里 `<扩展名>_character_config` 也由引擎自动补，`precontent` 里手动设是多余的（但无害）

> 独立武将包（放在 `apps/core/character/` 下，非扩展内）不受此影响，`name` 正常生效。

---

## 四、命名规范

| 对象 | 约定 | 示例 |
|------|------|------|
| 扩展目录 | 中文或英文均可 | `我的扩展` |
| 武将包 name | 英文小写 | `mypack` |
| 武将 ID | `包名_拼音` | `mypack_guanyu` |
| 技能 ID | 拼音，有歧义时加前缀 | `mypack_wusheng` |
| 立绘 | `image/character/<武将ID>.jpg` | `mypack_guanyu.jpg` |
| 技能配音 | `audio/skill/<技能ID>.mp3` | `mypack_wusheng.mp3` |

⚠️ 立绘路径由引擎按 `extension/<扩展名>/<武将ID>.jpg` 推导（`apps/core/noname/init/loading.ts:304`），**不需要手动配置**。若用 `ext:` 前缀引用，会被重写为 `extension/`（`polyfill.ts:210`）。

---

## 五、武将（Character）字段速查

权威定义：`apps/core/noname/library/element/character.js:2-182`

### 常用字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sex` | `"male"\|"female"\|"double"\|""` | 性别 |
| `group` | `string` | 势力。合法值：`wei`/`shu`/`wu`/`qun`/`jin`/`shen`（`library/index.js:13551`） |
| `hp` | `number \| string` | 体力。字符串格式 `"hp/maxHp"` 或 `"hp/maxHp/hujia"` |
| `maxHp` | `number` | 体力上限。⚠️ **对象格式下非 number 时回落到 `hp`**（`character.js:202-204`） |
| `hujia` | `number` | 护甲 |
| `skills` | `string[]` | 技能 ID 列表 |
| `names` | `string` | 「姓\|名」格式，用于竖排显示。`"null\|null"` 表示不显示 |
| `img` | `string` | 立绘路径 |
| `dieAudios` | `string[]` | 阵亡语音 |
| `isBoss` / `isHiddenBoss` | `boolean` | BOSS / 隐藏 BOSS |
| `doubleGroup` | `string[]` | 多势力（国战） |
| `groupInGuozhan` | `string` | 国战模式下的势力 |
| `hasHiddenSkill` | `boolean` | 拥有隐匿技能 |
| `isZhugong` | `boolean` | 常备主公 |
| `clans` | `string[]` | 宗族 |

完整字段（30+ 个）见 `character.js:2-182`。

### ⚠️ 不存在的字段（别写）

| 常见误写 | 实际情况 |
|---------|---------|
| `hiddenSkills` | ❌ **不是武将字段**，是 Player 实例属性（`player.js:109`）。武将侧用 `hasHiddenSkill: true` |
| `growthHp` | ❌ 全仓库零命中，无效字段 |
| `tags` | ❌ 不是武将字段。标签通过数组格式的 `trashBin` 字符串解析（`character.js:249-308`） |

### 数组格式 vs 对象格式

```js
// 对象格式（推荐）
mypack_guanyu: { sex: "male", group: "shu", hp: 4, skills: [...] }

// 数组格式（旧，仍在用）：[sex, group, hp, skills, trashBin?]
mypack_guanyu: ["male", "shu", 4, ["mypack_wusheng"]]
```

定义见 `apps/core/typings/type.d.ts:99`，数组第 5 位由 `setPropertiesFromTrash()` 解析（`character.js:237-313`）。

---

## 六、立绘路径（两种布局并存）

**引擎的自动推导**（`loading.ts:304`，仅对象格式生效）：

```
extension/<扩展名>/<武将ID>.jpg        ← 直接放在扩展根目录
```

**官方扩展的实际布局**（`英雄杀/character.js:290`，循环赋值）：

```
extension/英雄杀/image/character/<武将ID>.jpg
```

> ⚠️ **两者不一致**。自动推导只在「**没有写 `img`**」时才生效，且指向扩展根目录。
>
> **建议**：显式写 `img`，或统一循环赋值，不要依赖隐式约定。

```js
// 推荐：循环赋值（与官方扩展一致）
for (const id in character) {
    character[id].img = `extension/我的扩展/image/character/${id}.jpg`;
}
```

| 前缀 | 解析 | 用途 |
|------|------|------|
| `ext:<扩展名>/<文件>` | 替换为 `extension/`（`polyfill.ts:210`） | 磁盘上的扩展 |
| `db:extension-<扩展名>:<文件>` | 从 IndexedDB 取（`polyfill.ts:211-213`） | 导入型扩展 |
| `img:<路径>` | 直接用该路径 | 任意 |
| `mode:<模式>` | 模式专属立绘 | 模式 |
| `character:<武将ID>` | 换用另一武将立绘 | 皮肤 |

---

## 八、可选文件格式速览

以下格式均取自真实源码。

### intro.js — 武将介绍

```js
const characterIntro = {
    mypack_guanyu: "关羽（？—220年），字云长，河东解良人。",
};
export default characterIntro;
```
参考：`apps/core/extension/英雄杀/character/intro.js`

### sort.js — 分组排序

```js
export const characterSort = {
    mypack: ["mypack_guanyu", "mypack_zhangfei"],
};
export const characterSortTranslate = {
    mypack: "我的扩展",
};
export default characterSort;
```
参考：`apps/core/character/standard/sort.js`（多分组版本）

### characterFilter.js — 模式筛选

```js
const characterFilter = {
    // 返回 false 表示在该模式下【屏蔽】此武将
    mypack_guanyu(mode) {
        return mode != "guozhan";
    },
};
export default characterFilter;
```
参考：`apps/core/character/jsrg/characterFilter.js`
消费点：`library/index.js:11160`、`ui/create/index.js:1242`

### dynamicTranslate.js — 动态技能描述

```js
const dynamicTranslate = {
    mypack_wusheng(player) {
        const doubled = player.storage.mypack_wusheng;
        // 返回【完整的】描述字符串，可含 HTML
        return doubled
            ? "你可以将一张<span class='firetext'>任意</span>牌当【杀】使用。"
            : "你可以将一张红色牌当【杀】使用或打出。";
    },
};
export default dynamicTranslate;
```
参考：`apps/core/character/jsrg/dynamicTranslate.js`

> ⚠️ 只有当调用方**传入了 player** 时才会用动态描述（`get/index.js:3979`）。

### voices.js — 配音文本

```js
export default {
    "#mypack_wusheng1": "关某在此，谁敢一战！",
    "#mypack_wusheng2": "看我这青龙偃月刀！",
    "#mypack_guanyu:die": "大哥……三弟……",
};
```
参考：`apps/core/character/standard/voices.js`
键格式：`#<技能ID><序号>` 或 `#<武将ID>:die`

### pinyin.js — 拼音覆盖（多数包不需要）

```js
const pinyins = {
    大宛: ["dà yuān"],       // 多音字
    凯撒: ["Caesar"],        // 外文名
};
export default pinyins;
```
参考：`apps/core/character/collab/pinyin.js`、`apps/core/character/tw/pinyin.js`

> 25 个本体包中 22 个是空对象 `{}` —— 仅在自动拼音出错时才需要。

### characterTitle — 武将称号

```js
// 可写在 index.js 内联，或单独文件
characterTitle: {
    mypack_guanyu: "#g美髯公",     // #g 绿色（#r红 #b蓝 #p紫）
    mypack_zhangfei: "万夫不当",
},
```

> ⚠️ 颜色前缀 `#g/#r/#b/#p` **只对称号生效**（`get/index.js:1056` + `902`）。
> 技能描述里要用 `<span class='firetext'>` 等 CSS 类。

---

## 九、翻译表约定

```js
const translate = {
    mypack_guanyu: "关羽",                          // 武将名
    mypack_wusheng: "武圣",                         // 技能名（⚠️ 不要带【】）
    mypack_wusheng_info: "你可以将一张红色牌当【杀】使用或打出。",  // 技能描述
};
```

### 键的命名规范

| 键 | 含义 |
|----|------|
| `<武将ID>` | 武将名 |
| `<技能ID>` | 技能名 |
| `<技能ID>_info` | 技能描述 |
| `<技能ID>_ab` | 技能简称 |
| `<技能ID>_append` | 附加说明 |
| `<扩展名>_character_config` | 选将界面分组显示名（自动生成） |
| `#<技能ID><n>` | 配音文本 |

### 描述中的标记

| 标记 | 位置 | 含义 |
|------|------|------|
| `<br>` | 描述 | 换行 |
| `<li>` | 描述 | 列表项 |
| `#g`/`#r`/`#b`/`#p` | **仅称号** | 绿/红/蓝/紫 |
| `$` | **仅 `intro.content`** | 替换为 `get.translation(storage值)` |
| `#` | **仅 `intro.content`** | 替换为计数 |
| `&` | **仅 `intro.content`** | 替换为中文数字计数 |
| `${get.poptip("技能ID")}` | 描述 | 嵌入技能悬浮提示 |

> ⚠️ **描述文本里的 `$` 是普通字符，不会被替换**。只有 `intro.content` 里才替换（`Skill.d.ts:774`）。
>
> ⚠️ 技能名**不要写 `【】`**，引擎显示时自动加（`get/index.js:4928`）。

---

## 十、开发流程

```
① 复制本模板目录到 apps/core/extension/我的扩展/
② 修改 info.json（name 必须与目录名一致）
③ 在 character/character.js 定义武将
④ 在 character/skill.js 按 [templates/](templates/) 选择技能模板编写
⑤ 在 character/translate.js 补上「武将名 / 技能名 / 技能描述」
⑥ 放入立绘 image/character/<id>.jpg
⑦ 启动游戏 → 选项 → 扩展 → 启用「我的扩展」
⑧ 选将验证
```

### 启动开发服务器

```bash
pnpm dev          # 或分别启动 Vite(8080) 与 @noname/fs(8089)
```

访问 `http://127.0.0.1:8080/`

---

## 七、技能模板索引

见 [templates/README.md](templates/README.md)。

| 模板 | 用途 |
|------|------|
| 01 被动触发技 | 最常见的技能形态 |
| 02 锁定技 | 强制发动 |
| 03 有代价的触发技 | cost 选牌/选目标 |
| 04 视为技 viewAs | 将 X 当 Y 使用 |
| 05 主动技 | 出牌阶段主动发动 |
| 06 限定技 / 觉醒技 | 一局一次 |
| 07 状态切换技 | 转换技 |
| 08 直接效果技 | 摸牌/伤害/回复 |
| 09 多目标技 | 选择多个目标 |
| 10 附属技能 | group / subSkill |
| 11 临时技能 | addTempSkill |

---

## 八、必读避坑

1. **`filter` 是独立字段**，签名 `filter(event, player, triggername, indexedData)`，**纯判定、禁止副作用**（会被反复调用）。
2. **`cost` 中必须 `event.result = await ....forResult()`**，忘记赋值 → 技能永不发动且无报错。
3. **新代码用 `cost`，不要用 `direct: true`**（已过时，仅老包残留）。
4. **新代码用 `async content`，不要用 `"step 0"` 字符串**（旧式语法，仅 8 个未重构包残留 876 处）。
5. **`content(event, trigger, player)` 的 `trigger` 是触发事件**，`await` 后仍有效（形参）；不要再依赖全局 `trigger`。
6. **`subSkill` 的子技能实际 ID 是 `父ID_短名`**，且几乎总要配 `charlotte: true`。
7. **限定技必须 `player.awakenSkill(event.name)`**，否则可无限发动。
8. **临时技能的 ID 必须已在 `lib.skill` 中定义**，否则 `addTempSkill` 静默失败。
9. **取结果必须 `.forResult()`**，只 `await` 拿到的是 `undefined`（见 [YRD/10](../10-results-and-promises.md)）。
10. **AI 回调里 `player` 不可直接引用**，用 `get.player()` 或 `get.event().player`。

---

## 九、相关文档

- [YRD 事件系统文档](../README.md) — 底层机制
- [13-extending.md](../13-extending.md) — 扩展开发基础
- [08-trigger-system.md](../08-trigger-system.md) — 触发机制详解
- [appendix-c-pitfalls.md](../appendix-c-pitfalls.md) — 易错点
