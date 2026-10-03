// ═══════════════════════════════════════════════════════════
// 模板 06 · 限定技与觉醒技
// ═══════════════════════════════════════════════════════════
// 限定技：一局游戏仅能发动一次。
// 觉醒技：满足条件时自动发动，发动后永久改变武将（也是一局一次）。
//
// 参考：apps/core/character/standard/skill.js（zhongyi 忠义 / zhanshen 战神）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：限定技（主动发动） ──
	mypack_zhongyi: {
		enable: "phaseUse",

		// ① 限定技标记
		limited: true,

		// ② 发动特效
		skillAnimation: true,
		animationColor: "orange", // orange/gray/red/...

		filterCard: true,
		position: "he",
		filter(event, player) {
			return player.hasCards("he");
		},

		async content(event, trigger, player) {
			// ③ ⚠️ 必须标记已发动，否则可以无限使用！
			player.awakenSkill(event.name);

			player.addTempSkill("mypack_zhongyi2", "roundStart");
			await player.addToExpansion({
				cards: event.cards,
				source: player,
				animate: "give",
				gaintag: ["mypack_zhongyi2"],
			});
		},
	},

	// ── 示例 B：限定技（触发式） ──
	mypack_limited_trigger: {
		trigger: { player: "dying" },
		limited: true,
		skillAnimation: true,
		animationColor: "gray",
		filter(event, player) {
			return player.hp <= 0;
		},
		async content(event, trigger, player) {
			player.awakenSkill(event.name);
			await player.recover(2);
		},
	},

	// ── 示例 C：觉醒技 ──
	mypack_zhanshen: {
		trigger: { player: "phaseZhunbeiBegin" },

		// ② 觉醒技隐含：forced: true + limited: true
		forced: true,
		juexingji: true,

		skillAnimation: true,
		animationColor: "gray",

		filter(event, player) {
			return player.isDamaged() && game.dead.filter(target => target.isFriendOf(player)).length > 0;
		},

		async content(event, trigger, player) {
			// ③ 同样必须标记（虽然 juexingji 已隐含 limited，但显式调用更安全）
			player.awakenSkill(event.name);

			// 觉醒效果：弃装备、减体力上限、获得新技能
			const cards = player.getEquips(1);
			if (cards.length) {
				await player.discard({ cards });
			}
			await player.loseMaxHp();
			await player.addSkills(["mashu", "shenji"]);
		},

		// ④ 衍生技能（仅用于图鉴/武将介绍展示）
		derivation: ["mashu", "shenji"],
	},

	// ── 示例 D：限定技 + 可见标记 ──
	mypack_marked_limited: {
		trigger: { player: "phaseUseBegin" },
		limited: true,
		skillAnimation: true,
		animationColor: "orange",

		// 技能图标上显示标记
		intro: {
			content: "limited",
		},

		forced: true,
		async content(event, trigger, player) {
			player.awakenSkill(event.name);
			await player.draw(3);
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【结构要点】
//
// limited: true
//   一局游戏限一次。发动后技能变为「已觉醒」状态（图标变化）。
//
// juexingji: true（觉醒技）
//   隐含 limited: true + forced: true
//   发动后播放觉醒动画
//
// skillAnimation: true + animationColor
//   发动时的全屏特效。可选值："orange" / "gray" / "red" / "green" 等
//
// derivation: [...]
//   衍生技能列表，【仅用于展示】，不产生实际关联
//   要真正获得技能仍需 addSkills
//
// ⚠️⚠️ 最重要：必须在 content 中调用 player.awakenSkill(event.name)
//      否则限定技可以无限发动！这是最常见的 bug。
//      用 event.name 而非硬编码字符串（技能可能被改名）
//
// 【常见坑】
// ✗ 忘记 awakenSkill → 无限发动（限定技第一号 bug）
// ✗ 硬编码字符串而非 event.name → 改名后失效
// ✗ 觉醒技手写 limited: true → 重复（无害但不必要）
// ✗ 混淆 derivation 与 group：
//     derivation 只是展示，group 才真正关联子技能
// ═══════════════════════════════════════════════════════════
