// ═══════════════════════════════════════════════════════════
// 模板 10 · 附属技能（group / subSkill）
// ═══════════════════════════════════════════════════════════
// 一个武将技能由多个子技能协作完成。
//
// 参考：apps/core/character/standard/skill.js（longdan 龙胆 / jijiang 激将）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 写法 A：subSkill 内联定义（推荐） ──
	// 子技能实际 ID = 父ID_短名，如 mypack_longdan + sha → mypack_longdan_sha
	mypack_longdan: {
		subSkill: {
			// ── 子技能 1：闪当杀 ──
			sha: {
				// ⚠️ charlotte: true 表示不显示在武将牌上（内部技能必加）
				charlotte: true,

				enable: ["chooseToUse", "chooseToRespond"],
				filterCard: { name: "shan" },
				viewAs: { name: "sha" },
				position: "hs",
				prompt: "将一张闪当杀使用或打出",
				viewAsFilter(player) {
					if (!player.hasCards("hs", "shan")) {
						return false;
					}
				},
				check() {
					return 1;
				},
				ai: {
					respondSha: true,
					skillTagFilter(player) {
						if (!player.hasCards("hs", "shan")) {
							return false;
						}
					},
				},
			},

			// ── 子技能 2：杀当闪 ──
			shan: {
				charlotte: true,
				enable: ["chooseToRespond", "chooseToUse"],
				filterCard: { name: "sha" },
				viewAs: { name: "shan" },
				position: "hs",
				prompt: "将一张杀当闪使用或打出",
				viewAsFilter(player) {
					if (!player.hasCards("hs", "sha")) {
						return false;
					}
				},
				check() {
					return 1;
				},
				ai: {
					respondShan: true,
					skillTagFilter(player) {
						if (!player.hasCards("hs", "sha")) {
							return false;
						}
					},
				},
			},

			// ── 子技能 3：额外效果（静默触发） ──
			draw: {
				charlotte: true,
				trigger: { player: ["useCard", "respond"] },
				forced: true,
				popup: false, // 不弹技能名飘字
				filter(event, player) {
					return event.skill === "mypack_longdan_sha" || event.skill === "mypack_longdan_shan";
				},
				async content(event, trigger, player) {
					await player.draw();
				},
			},
		},
	},

	// ── 写法 B：group 引用外部定义的技能 ──
	mypack_jijiang: {
		// ① 关联子技能（子技能定义在下方顶层）
		group: ["mypack_jijiang_effect"],
		zhuSkill: true, // 主公技

		enable: ["chooseToUse", "chooseToRespond"],
		viewAs: { name: "sha" },
		filterCard() {
			return false; // 不能用自己的牌
		},
		selectCard: -1,
	},

	mypack_jijiang_effect: {
		charlotte: true,
		trigger: { player: ["useCardBegin", "respondBegin"] },
		logTarget: "targets",

		// ② 回指父技能（战报/图鉴中归到父技能名下）
		sourceSkill: "mypack_jijiang",

		filter(event, player) {
			return event.skill === "mypack_jijiang";
		},
		forced: true,
		async content(event, trigger, player) {
			await player.draw();
		},
	},

	// ── 写法 C：主技能只是容器（无 trigger / 无 enable） ──
	mypack_container: {
		// 主技能不做事，只负责把子技能挂上去
		group: ["mypack_part_a", "mypack_part_b"],
	},

	mypack_part_a: {
		charlotte: true,
		trigger: { player: "phaseZhunbeiBegin" },
		forced: true,
		async content(event, trigger, player) {
			await player.draw();
		},
	},

	mypack_part_b: {
		charlotte: true,
		trigger: { player: "phaseJieshuBegin" },
		forced: true,
		async content(event, trigger, player) {
			await player.recover();
		},
	},

	// ── 写法 D：清理型子技能（自动移除自身） ──
	mypack_cleanup: {
		group: ["mypack_cleanup_watch"],
		enable: "phaseUse",
		usable: 1,
		async content(event, trigger, player) {
			player.addTempSkill("mypack_buff");
		},
	},

	mypack_cleanup_watch: {
		charlotte: true,
		trigger: { global: ["useCardAfter", "useSkillAfter", "phaseAfter"] },
		silent: true,
		sourceSkill: "mypack_cleanup",
		filter(event) {
			return event.skill !== "mypack_cleanup";
		},
		async content(event, trigger, player) {
			player.removeSkill("mypack_cleanup_watch");
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【两种写法对比】
//
// subSkill: { 短名: {...} }
//   ✓ 子技能内联定义，结构清晰
//   ✓ 自动生成 ID：父ID_短名
//   ✓ 推荐用于「这个技能专属的子技能」
//
// group: ["子技能ID", ...]
//   ✓ 子技能定义在其他地方（可跨文件/跨技能复用）
//   ✓ 需要自己保证 ID 存在
//   ✓ 推荐用于「多个技能共享的子技能」
//
// 【关键字段】
//   charlotte: true      不显示在武将牌上（内部技能【必加】）
//   silent: true         发动时不喊台词
//   popup: false         不弹技能名飘字
//   sourceSkill: "父ID"  战报/图鉴中归到父技能名下
//   zhuSkill: true       主公技标记
//   derivation: [...]    衍生技能（【仅展示】，不产生实际关联）
//
// 【常见坑】
// ✗ 子技能 ID 记错：subSkill 生成的是【父ID_短名】全名
//   在别处引用（addTempSkill 等）必须用全名
// ✗ 忘记 charlotte: true → 子技能显示在武将牌上，玩家看到莫名其妙的图标
// ✗ group 引用的技能不存在 → 静默失效，【无任何报错】
// ✗ 主技能无 trigger/enable 却写了 content → 产生「空发动」
// ✗ 混淆 derivation 与 group：
//     derivation 只是图鉴展示，不会让武将真正获得技能
// ═══════════════════════════════════════════════════════════
