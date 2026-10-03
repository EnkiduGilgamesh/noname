// ═══════════════════════════════════════════════════════════
// 模板 04 · 视为技（viewAs）
// ═══════════════════════════════════════════════════════════
// 将某些牌「视为」另一种牌使用或打出。如武圣（红牌当杀）、龙胆（闪当杀）。
//
// 结构：enable + filterCard + viewAs + viewAsFilter
// 参考：apps/core/character/standard/skill.js（wusheng 武圣）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：最标准的 viewAs（武圣） ──
	mypack_wusheng: {
		// ① 何时可以发动
		enable: ["chooseToRespond", "chooseToUse"],

		// ② 哪些牌能当素材（函数形式）
		filterCard(card, player) {
			return get.color(card) === "red";
		},

		// ③ 从哪些区域选牌：h手牌 e装备 j判定 s技能区
		position: "hes",

		// ④ 转化成的虚拟牌
		viewAs: { name: "sha" },

		// ⑤ 全局可用性判定（防止手上没有合适牌时技能仍亮起）
		viewAsFilter(player) {
			if (!player.hasCards("hes", { color: "red" })) {
				return false;
			}
		},

		prompt: "将一张红色牌当杀使用或打出",

		// ⑥ AI 选牌价值：返回【越大越愿意选】
		check(card) {
			const val = get.value(card);
			if (get.event().name === "chooseToRespond") {
				return 1 / Math.max(0.1, val);
			}
			return 5 - val;
		},

		ai: {
			// 让 AI 知道自己有「打出杀」的能力
			respondSha: true,
			skillTagFilter(player) {
				if (!player.hasCards("hes", { color: "red" })) {
					return false;
				}
			},
			order() {
				return get.order({ name: "sha" }) + 0.1;
			},
			useful: -1,
			value: -1,
		},
	},

	// ── 示例 B：用对象筛选器（更简洁） ──
	mypack_longdan_sha: {
		enable: ["chooseToUse", "chooseToRespond"],

		// filterCard 可以直接写对象：{ name: "shan" } 表示「名为闪的牌」
		filterCard: { name: "shan" },

		viewAs: { name: "sha" },

		viewAsFilter(player) {
			if (!player.hasCards("hs", "shan")) {
				return false;
			}
		},

		position: "hs",
		prompt: "将一张闪当杀使用或打出",

		check() {
			return 1;
		},

		ai: {
			respondSha: true,
			effect: {
				target(card, player, target, current) {
					if (get.tag(card, "respondSha") && current < 0) {
						return 0.6;
					}
				},
			},
			skillTagFilter(player) {
				if (!player.hasCards("hs", "shan")) {
					return false;
				}
			},
			order() {
				return get.order({ name: "sha" }) + 0.1;
			},
			useful: -1,
			value: -1,
		},
	},

	// ── 示例 C：多张牌转化为复杂牌 ──
	mypack_complex_viewas: {
		enable: "phaseUse",
		position: "hes",

		// filterCard 为 true 表示任意牌
		filterCard: true,

		// 选 2 张牌
		selectCard: 2,

		// viewAs 用函数形式，可根据选的牌动态决定转化结果
		viewAs(cards, player) {
			if (cards.length === 2 && get.suit(cards[0]) === get.suit(cards[1])) {
				return { name: "juedou" };
			}
			return { name: "sha" };
		},

		viewAsFilter(player) {
			if (player.countCards("hes") < 2) {
				return false;
			}
		},

		prompt: "将两张牌当【杀】或【决斗】使用",
		check(card) {
			return 5 - get.value(card);
		},
	},

	// ── 示例 D：需要额外效果的 viewAs（带 content） ──
	mypack_viewas_with_effect: {
		enable: ["chooseToUse", "chooseToRespond"],
		filterCard: { name: "sha" },
		viewAs: { name: "shan" },
		viewAsFilter(player) {
			if (!player.hasCards("hs", "sha")) {
				return false;
			}
		},
		position: "hs",
		prompt: "将一张杀当闪使用或打出",
		check() {
			return 1;
		},

		// viewAs 技一般【不需要】content；仅当需要附带效果时才写
		async content(event, trigger, player) {
			await player.draw();
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【结构要点】
// 必填：enable + filterCard + viewAs
// 强烈建议：viewAsFilter + position + prompt + check
//
// enable 取值：
//   "phaseUse"          出牌阶段主动使用
//   "chooseToUse"       需要打牌时（含响应）
//   "chooseToRespond"   被要求打出牌时（如被【杀】指定）
//   可传数组组合
//
// viewAs 取值：
//   { name: "sha" }                     固定转化的牌
//   (cards, player) => ({ name: "..." }) 动态决定
//
// filterCard 取值：
//   函数 (card, player) => boolean
//   对象 { name: "shan" } / { color: "red" } / { type: "basic" } 等筛选器
//   true 表示任意牌
//
// 【常见坑】
// ✗ 只写 filterCard 不写 viewAsFilter → 手上没牌技能也亮起
// ✗ 不写 position → 默认全区域，可能误把装备区的牌当素材
// ✗ check() 返回的是【价值】不是代价，写反会让 AI 疯狂弃好牌
// ✗ usable 与 limited 混淆：usable 每回合重置，limited 一局一次
// ✗ 给 viewAs 技多余地写 content → 引擎已自动用牌，会重复结算
// ═══════════════════════════════════════════════════════════
