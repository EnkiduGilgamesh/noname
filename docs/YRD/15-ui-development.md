# 15 · UI 开发指南（对话框与自定义界面）

> 本篇回答：**怎么在《无名杀》里做出自定义界面？为什么我的界面不显示 / 错位 / 文字挤成一列？**
>
> 前 14 篇讲游戏机制与技能开发，本篇讲**界面层**。全部结论来自「新宇杀」扩展选组合界面的实战，
> 每条都标注了精确源码位置，可直接对照。

---

## 0. 先读这一节，能省掉后面 80% 的坑

游戏内 UI 与普通网页开发**有三处根本差异**，绝大多数诡异现象都源于此：

| 差异 | 后果 |
|------|------|
| **① 视口被整体缩放** | `vh`/`vw` 解析不可靠，曾导致容器高度塌成 0。**一律用 px** |
| **② 主题样式带 `!important`** | 内联样式会输。关键属性必须用同样带 `!important` 的规则钉死 |
| **③ `.content` 有 `font-size: 0px`** | 嵌套元素继承 0 字号，盒模型塌陷 —— 但 `innerText` 仍正常，极具迷惑性 |

三条对应的详细机制见 §2、§3、§4。**如果只想记一件事**：

> 🔬 **调试心法**：`getBoundingClientRect().height === 0` 且多个元素 `top` 相同
> → 立刻**同时**怀疑 `position:absolute` 与 `font-size:0`，用 `getComputedStyle` 一次把两者都打出来。

---

## 1. 创建对话框：选对 API

### 1.1 三种候选承载方式

| 方式 | 适用 | 说明 |
|------|------|------|
| ✅ `ui.create.textbuttons(list, dialog)` | **多行文本、整行可点选** | 首选。生成 `.popup.text.textbutton` 整行块，自然换行、高度自适应 |
| ✅ `dialog.add([[link, text], 'tdnodes'])` | 短标签、图标网格 | ⚠️ 见下 |
| 🚫 自己伪造 dialog 宿主对象 | —— | **已证伪**，见 §1.3 |

### 1.2 `textbuttons` 的行为（源码级）

```js
// apps/core/noname/ui/create/index.js:3625-3646
textbuttons(list, dialog, noclick) {
    for (var item of list) {
        var str, link;
        if (Array.isArray(item)) { str = item[1]; link = item[0]; }
        else { str = item; link = item; }
        if (!str.startsWith("<div")) {
            str = '<div class="popup text textbutton">' + str + "</div>";
        }
        var next = dialog.add(str);
        if (!noclick) {
            next.firstChild.addEventListener(
                lib.config.touchscreen ? "touchend" : "click", ui.click.button);
        }
        next.firstChild.link = link;
        Object.setPrototypeOf(next, lib.element.Button.prototype);
        dialog.buttons.add(next.firstChild);
    }
}
```

四个必须记住的事实：

1. **`list` 元素是 `[link, htmlString]`**；`link` 建议用**数组下标（数字）**，
   不要用字符串 ID（ID 可能含中文/空格/括号，做 `filterButton` 匹配时容易出错）。
2. **`htmlString` 必须以 `<div` 开头**，否则它会自己再包一层 `div`。
3. **点击监听绑在行节点本身**（`next.firstChild`），不是父容器。
4. 🆕 **第三个参数 `noclick` 可以完全不绑点击** —— 若你要「点击只预览、由外部按钮提交」，
   直接传 `true` 即可，**不必**事后用 `cloneNode` 剥离（见 §5.2）。

> ⚠️ `dialog.buttons` 是**数组，不是 DOM 节点**。对它取 `.style` 会抛
> `TypeError: Cannot set properties of undefined (setting 'display')`。
> 要拿它的 DOM 容器用 `dialog.content.querySelector(".buttons")`。

### 1.3 反面教材：伪造宿主对象

想自己控制列表容器、又想让 `textbuttons` 生成按钮，很容易想到「伪造一个宿主对象骗过去」：

```js
// 🚫 实测事故：列表完全不显示，且无任何报错
const fake = { add(str) { /* 返回 {firstChild} */ }, buttons: { add() {} } };
ui.create.textbuttons(items, fake);
```

**原因**：`textbuttons` 对 `dialog.add(str)` 的返回值做
`Object.setPrototypeOf(next, lib.element.Button.prototype)` 并读 `next.firstChild`
（`ui/create/index.js:3643`），伪造对象稍有不合就**静默失效**。

**✅ 正确做法**——用真实 dialog 再搬节点：

```js
const tmp = ui.create.dialog("hidden", "forcebutton");
ui.create.textbuttons(items, tmp);
const myWrap = document.createElement("div");
for (const node of tmp.buttons.slice()) {   // appendChild 会自动从原父节点摘除
    myWrap.appendChild(node);
    dialog.buttons.add(node);               // ⚠️ 必须登记到主 dialog
}
tmp.close();
```

> 🔬 顺带一提：把 `textbuttons` 的 `noclick` 设为 `true` 再自己绑预览点击，
> 比「生成后 `cloneNode` 剥离监听」更直接。两条路都能走通，任选其一。

### 1.4 全屏大对话框

要让玩家看清长文本（如完整技能描述），叠加引擎既有的大尺寸样式类：

```js
dialog.classList.add("fixed", "scroll1", "scroll2",
                     "fullwidth", "fullheight", "noupdate");
dialog.style.overflow = "hidden";
dialog.content.style.height = "100%";
```

创建时用第二参数 `"forcebutton"`，按钮才更适配整块布局。

---

## 2. 高度与滚动：为什么界面「不显示」

> **最高频的伪装问题**。症状是「列表看不见」，但 `children.length` 完全正常。

### 2.1 排查顺序（照做即可定位）

```
① document.getElementById('xxx').children.length
   → 返回 5 说明 DOM 已生成，问题在 CSS，**不要再改 JS 结构**

② 逐层向上打印 getBoundingClientRect + getComputedStyle
   关注 height / overflow / display / opacity / visibility
   → 找到那个「高度为 0 且 overflow 会裁剪」的层

③ 定位到裁剪层后，再决定是改高度还是改 overflow
```

### 2.2 实测事故

列表容器尺寸 `1003x0`、`overflow: hidden auto`，5 个子项各高 33px 全部被裁掉，
而父级 `.content` 有 289px 空间。

**诱因**：容器写了 `max-height: 52vh + overflow-y: auto`。
在游戏被缩放的视口里 `52vh` 解析异常，容器高度塌成 0。

**修法**：容器改 `height:auto!important; max-height:none!important; overflow:visible!important`，
让内容自然撑高，滚动交给外层 `.content-container`。

### 2.3 需要限高时

内容确实会超出对话框时，用 **JS 内联 px** 限高：

```js
const clampHeight = (node, maxPx, minPx) => {
    node.style.height = "auto";
    node.style.maxHeight = `${maxPx}px`;
    node.style.minHeight = `${minPx || 0}px`;
    node.style.overflowY = "auto";
    node.style.overflowX = "hidden";
};
```

三条铁律：

- 🚫 **不要用 `vh`** —— 视口缩放后解析不可靠
- 🚫 **CSS 里不要再写 `min-height`** —— `min-height` 优先级**高于** `max-height`，
  会把 JS 的内联限高顶掉（症状：限高失效、内容溢出）。
  **高度与滚动只由一个来源控制**，推荐全交给 JS，CSS 只留背景/边框/内边距
- ⚠️ **`px` 数值直接决定「能看到几项」** —— 见 §2.4

### 2.4 px 限高会被误读成「数据变少了」

**实测误判**：用户报「只能显示 3 个技能组了」，怀疑筛选逻辑坏了。
真相是 `maxHeight: 180px` ÷ 每项 `≈55~60px` = 3 项，其余被 `overflow:auto` 藏进滚动条。
**数据完全正常，是可视区太小。**

> ✅ 调限高时按「**单项实测高度 × 期望可见项数**」反算，并把算式写进注释。
>
> 参考分配（对话框内容区约 450px，随屏幕高度变化）：
> 标题 60 + 列表 250 + 分隔 20 + 详情 190 + 按钮 40。
>
> 🔬 排查口诀：列表「少了」先报 `children.length` 与容器 `clientHeight`，
> 两者都正常就是滚动/限高问题，**不要动数据层**。

---

## 3. 布局：为什么文字「挤成一列一个字」

### 3.1 `font-size: 0px` 陷阱（引擎内置）

```css
/* apps/core/layout/default/layout.css:1901-1906 */
.content {
    font-size: 0px;        /* ← 为了消除 inline-block 之间的空白 */
    overflow-x: hidden;
}
.content > * {
    font-size: 16px;       /* ← 只对**直接子元素**恢复！ */
}
```

你注入的 HTML 若是多层的（如 `.detail > .name` / `.desc`），**内层继承到 0px**，
盒模型塌成 0 高，全部元素叠在同一位置。

> ⚠️ 最阴险的地方：**`innerText` 完全正常**，看 DOM 结构毫无异常，只有高度是 0。

**✅ 修法**：动态注入的 HTML，**每一层元素都显式写 `font-size`**。

### 3.2 `position: absolute` 陷阱（主题/引擎）

与 §3.1 **症状几乎完全相同**（`top` 相同、`height` 为 0），只看截图无法区分。
实测探测发现每层元素 computed `position` 都是 `absolute`（脱离文档流）。

**✅ 一次覆盖两种根因的修法**——每层显式写全，再补一条通配复位：

```js
// 注入的 HTML 每层都带内联样式
const BLOCK = "display:block;position:static;float:none;" +
    "top:auto;left:auto;right:auto;bottom:auto;transform:none;" +
    "width:100%;min-width:0;box-sizing:border-box;font-size:13px;" +
    "white-space:normal;word-break:break-word;" +
    "writing-mode:horizontal-tb;text-align:left;";
```

```css
/* 再补一条通配复位，防主题覆盖 */
#my-detail * {
    position: static !important; float: none !important;
    display: block !important; width: 100% !important;
    height: auto !important; min-width: 0 !important;
    box-sizing: border-box !important;
    white-space: normal !important; word-break: break-word !important;
    writing-mode: horizontal-tb !important; text-align: left !important;
}
/* 豁免需要保持行内的元素（如体力徽标） */
#my-detail span.my-inline { display: inline-block !important; width: auto !important; }
```

> 🔬 **为什么通配复位是必要的**：与其逐条排查是哪条主题规则在作祟，不如一次性复位。
> 通配符有性能代价，但对话框内元素数量有限，可接受。

### 3.3 不要用 flex

**实测症状**：卡片头部用 `display:flex` 后，长文本被压成**一列一个字**。
原因：flex 子项默认 `min-width:auto`，在 dialog 的按钮容器里拿不到足够宽度，
于是按最小内容宽度（单个汉字）排布。

**✅ 改用**：块级容器 + `display:inline-block` 子项 + `margin-right` 控制间距。

### 3.4 内联样式会输给主题 `!important`

即使每层都写了内联 `display:block; width:100%; white-space:normal`，
文字仍可能被排成一列一个字 —— 因为主题样式表里有带 `!important` 的规则
（如 `layout.css:3866-3877` 的 `.tdnode{width:auto!important}`）。

**✅ 可靠做法**：在注入的 `<style>` 里用**同样带 `!important`** 的规则钉死：

```css
display:block!important; width:100%!important; min-width:0!important;
box-sizing:border-box!important; white-space:normal!important;
word-break:break-word!important; overflow-wrap:break-word!important;
writing-mode:horizontal-tb!important; text-align:left!important;
```

**排查顺序**：① 先确认没有残留 `flex` → ② 再确认没被继承 `writing-mode:vertical-rl`
（本体有竖排卡牌名的规则，`layout.css:391/1374`）→ ③ 最后才是 `!important` 覆盖问题。

### 3.5 加了 `!important` 之后，内联 `display:none` 会失效

**实测事故**：为修 §3.4 加了 `display:block!important`，结果折叠态用的
内联 `style="display:none"` 被压掉，所有卡片详情全部展开。

**✅ 显隐切换一律改用类名**，让两条规则优先级对等：

```css
.my-card:not(.open) { display: none !important; }
.my-card.open       { display: block !important; }
```

```js
el.classList.toggle("open", willOpen);
// ⚠️ 不要再读 style.display —— 它已不代表实际可见性
```

> **通用教训**：一旦给某属性加了 `!important`，就必须把所有控制该属性的路径
> 都改成同等优先级（类名），否则会互相打架。

### 3.6 列表项分两段排版（对齐技巧）

**需求**：第一行左「称号」右「体力」且垂直对齐，第二行技能名。

```html
<div class="item">
  <div class="line1">                      <!-- 行容器：font-size:0px -->
    <span class="title">称号</span>         <!-- inline-block; min-width:150px; vertical-align:baseline -->
    <span class="hp">体力</span>            <!-- inline-block; vertical-align:baseline -->
  </div>
  <div class="sub">技能A、技能B</div>        <!-- block，强制独占一行 -->
</div>
```

四个要点：

1. 行容器必须显式 `font-size:0px`，再给子元素写回字号
   —— 否则 `inline-block` 之间的换行空白会撑出多余间隙
2. 两个子元素都写 `vertical-align:baseline`（**不是** `top`/`middle`），基线对齐才是"看起来齐"
3. 做列对齐用左边元素的 `min-width`（**而非** `float` 或 flex），右边元素自然被推到同一列
4. 内容行必须 `display:block` —— 否则它接着行容器继续排在同一行
   （**这正是「技能名跑到行中间」的根因**）

---

## 4. 样式注入与节点搬移

### 4.1 `lib.init.sheet` 只能插单条规则

```js
// 🚫 实测事故：抛 SyntaxError: Failed to parse the rule，整段样式全部失效
lib.init.sheet(".a{...}", ".b{...}");
```

原因：该函数实现为 `style.sheet.insertRule(arguments[i], 0)`
（`noname/library/init/index.js:162-171`），而 CSSOM 的 `insertRule`
**只接受一条规则**，不支持整段样式表文本。

**✅ 正确做法**：

```js
let style = document.getElementById("my-style");
if (!style) {
    style = document.createElement("style");
    style.id = "my-style";            // 幂等：避免重复注入
    document.head.appendChild(style);
}
style.textContent = css;              // 整段 CSS 直接赋值
```

### 4.2 搬移节点后必须复位定位

**实测症状**：把 `textbuttons` 的按钮节点 `appendChild` 搬进自己的容器后，
5 个列表项**全部叠在同一位置**（都在顶部、互相覆盖、无法点击）。

原因：这些节点原属 dialog 的 `.buttons` 容器，带有关联的定位/尺寸样式。
搬到普通块容器后不复位就会失去文档流位置。

**✅ 双管齐下**：

```js
Object.assign(node.style, {          // ① 内联复位（优先级最高，最稳）
    display: "block", position: "static", float: "none",
    top: "auto", left: "auto", right: "auto", bottom: "auto",
    transform: "none", width: "100%", height: "auto",
    boxSizing: "border-box", whiteSpace: "normal",
});
```

```css
/* ② CSS 里也加同样的 !important，防主题覆盖 */
```

> **通用经验**：在游戏内**跨容器搬移已有节点**（尤其来自 dialog/buttons 体系的）
> 之后，务必复位 `display/position/float/inset/transform/尺寸`，
> **不要假设它们还在自然文档流里**。

---

## 5. 交互：点击行为与提交

### 5.1 同元素上的两个监听器无法用 `stopPropagation` 隔离

`textbuttons` 把 `ui.click.button` **直接绑在行节点本身**
（`ui/create/index.js:3640`）。若想给同一行再加行为（如「点击展开」），

🚫 **不能**用 `addEventListener` + `stopPropagation` 拦截 ——
两个监听器挂在**同一个元素**上，`stopPropagation` 只阻止冒泡/捕获传播，
**无法阻止同元素上的另一个监听器**。结果是「点一下两个行为都触发」。

✅ **正确做法**：把附加行为挂到行内部**独立的子按钮**上（如 `.my-toggle`），
并在其回调里 `stopPropagation` —— 这样点它不会冒泡到行节点，也就不会触发选中。

### 5.2 取消「点击即选中」

若想改为「点击只预览，由外部『确定』按钮统一提交」，两条路：

| 方案 | 做法 | 评价 |
|------|------|------|
| ✅ **首选** | `ui.create.textbuttons(items, dialog, true)` —— 传 `noclick` | 最直接，源码原生支持 |
| 备选 | `cloneNode(true)` 剥离既有监听 | 克隆会丢弃**所有**既有监听器，最干净 |

```js
const clean = node.cloneNode(true);
clean.link = node.link;
listWrap.replaceChild(clean, node);
dialog.buttons.add(clean);            // ⚠️ 必须重新登记
```

> 🚫 **不要试图 `removeEventListener`**：引擎用的是共享的函数引用（`ui.click.button`）
> 且可能在多处挂载，逐个移除容易漏且无法验证。

**配套要点**：

- `ui.click.button` 用 `this` 作按钮节点，调用要写 **`ui.click.button.call(node)`**，且**不接收事件参数**
- `ui.click.button` 内部会检查 `selectable` / `isMine` 等条件，
  克隆节点不一定带这些类，稳妥做法是先 `node.classList.add("selectable")`
- **兜底路径**：把节点塞进 `ui.selected.buttons` 后调用 `ui.click.ok()`
  （它读 `ui.selected.buttons` 组装结果，`ui/click/index.js:3090`）
- 🚫 **不要给 `ui.click.ok` 传节点** —— 传了它会去关闭该节点的 `parentNode`

### 5.3 选择结果用数组下标作 `link`

```js
ui.create.dialog(标题, [list.map((item, i) => [i, 显示文本]), "tdnodes"]);
// filterButton: button => typeof button.link === "number" && !!list[button.link]
```

比字符串 ID 更稳。另：`dialog.buttons` 在 `ui.create.dialog` 返回后**同步**可用，
可直接遍历给每个按钮挂 `_customintro` 做右键详情。

---

## 6. 架构建议：列表与详情分离

在 dialog 里做「可展开的卡片列表」**非常难做对**，会连续踩坑：

① 同节点监听器无法隔离（§5.1）
② 展开撑高后与其他卡片重叠
③ 加 `display:block!important` 修换行又会压掉 `display:none` 导致折叠失效（§3.5）

> ✅ **结论**：把「**选择**」与「**阅读**」拆成两个区域（左右或上下分栏）：
> - **紧凑列表**（每项只显示标题 + 关键数值）负责选
> - **固定文本区**负责读（点列表项时刷新其 `innerHTML`）
>
> 列表项高度恒定，不互相重叠，**也不需要任何展开/折叠状态**。
>
> 🔬 实测中「新宇杀」的选组合界面即采用此结构：
> 左侧列表 + 右侧详情 + 底部「确定选择」，客户端先预览再提交。

---

## 7. 完整检查清单

### 编写时

- [ ] 多行可点选列表用 `ui.create.textbuttons`，**不用** `tdnodes` 塞长文本
- [ ] `htmlString` 以 `<div` 开头
- [ ] `link` 用数组下标（数字）
- [ ] 需要「点击只预览」时传第三参数 `noclick = true`
- [ ] **不用** `flex` 排版
- [ ] 高度/滚动**只用一种**来源控制（推荐 JS 内联 px），**不用** `vh`
- [ ] 动态注入的 HTML **每层**都写 `font-size` 与 `position:static`
- [ ] 关键布局属性在注入的 `<style>` 里带 `!important` 兜底
- [ ] 显隐切换用**类名**，不用内联 `display`
- [ ] 搬移 dialog 节点后复位 `display/position/float/inset/transform/尺寸`
- [ ] `dialog.buttons` 当**数组**用，取 DOM 容器用 `querySelector(".buttons")`

### 调试时

- [ ] 元素「不显示」→ 先看 `children.length`（正常则问题在 CSS）
- [ ] 高度为 0 且多个 `top` 相同 → **同时**查 `position:absolute` 与 `font-size:0`
- [ ] 文字挤成一列 → 查 `flex` → 查 `writing-mode` → 查 `!important`
- [ ] 列表「变少了」→ 查限高与滚动，**别动数据层**
- [ ] 用 `getComputedStyle` + `getBoundingClientRect` 逐层打印，**不要凭截图猜**

> ⚠️ 最后一条最重要：本篇几乎每个结论，都是靠**逐层打印计算样式**定位的，
> 靠肉眼看截图先后误判了多次（`font-size:0` 与 `position:absolute` 症状完全一致）。

---

## 8. 源码坐标速查

| 机制 | 位置 |
|------|------|
| `textbuttons`（含 `noclick` 参数） | `noname/ui/create/index.js:3625-3646` |
| 点击即选中 `ui.click.button` | `noname/ui/click/index.js:2617` |
| 提交 `ui.click.ok`（读 `ui.selected.buttons`） | `noname/ui/click/index.js:3090` |
| `.content { font-size: 0px }` | `layout/default/layout.css:1901-1906` |
| `.tdnode`（短标签专用，勿塞长文本） | `layout/default/layout.css:3866-3877` |
| `lib.init.sheet`（仅单条规则） | `noname/library/init/index.js:162-171` |
| `buttonPresets.tdnodes` | `noname/ui/create/index.js:3271-3281` |
| `dialog.buttons` 同步可用 | `noname/ui/create/index.js:3962` |

---

## 9. 与其他文档的关系

| 文档 | 关系 |
|------|------|
| [13-extending.md](13-extending.md) | 技能/扩展开发；本篇是其界面层补充 |
| [14-dev-toolchain.md](14-dev-toolchain.md) | 开发工具链；UI 结论同样沉淀在知识库中 |
| [appendix-c-pitfalls.md](appendix-c-pitfalls.md) | 通用易错点；界面类坑集中在本文 |
| `.dsh/skills/noname-general-extension/scripts/knowledge-base.json` | 本文全部结论的原始出处（带源码指纹校验） |

> 本文对应的知识库条目（可用 `skill-search.mjs search` 检索原文）：
> `kb-b6fee872`、`kb-7c15f937`、`kb-e5f3bceb`、`kb-b3c1f149`、`kb-d00ee23b`、
> `kb-5d1329d1`、`kb-96d5b2f2`、`kb-9570b547`、`kb-af509556`、`kb-baea5bbb`、
> `kb-a0b1e0a2`、`kb-91f08bc5`、`kb-a4994f68`、`kb-00068493`、`kb-74c3bcb6`、
> `kb-33fcc6b7`、`kb-06b99a7e`、`kb-2bb4bdcd`
>
> 📌 两条最贴合本文主题的结论（列表项两段式排版、px 限高与可见项数）
> 已迁入「新宇杀」扩展的 `docs/05-ui-design.md`，见本文 §2 与 §4.4。
