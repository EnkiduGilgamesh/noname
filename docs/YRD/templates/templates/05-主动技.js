// ═══════════════════════════════════════════════════════════
// 模板 05 · 主动技
// ═══════════════════════════════════════════════════════════
// 出牌阶段由玩家主动发动（不是被动触发）。
//
// 结构：enable + filterCard + filterTarget + content
// 参考：apps/core/character/standard/skill.js（qingnang 青囊）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：弃牌 + 选目标 + 效果（青囊） ──
	mypack_qingnang: {
		// ① 出牌阶段可发动
		enable: "phaseUse",

		// ② 任意牌可作为代价
		filterCard: true,

		// ③ 每回合限一次
		usable: 1,

		// ④ AI 选牌价值
		check(card) {
			return 9 - get.value(card);
		},

		// ⑤ 目标筛选：只能选受伤的角色
		filterTarget(card, player, target) {
			return target.hp < target.maxHp;
		},

		// ⑥ 效果
		async content(event, trigger, player) {
			// 单目标时 event.target 是快捷方式
			await event.target.recover();
		},

		ai: {
			order: 9, // 出牌阶段的发动优先级（越大越优先）
			result: {
				target(player, target) {
					if (target.hp === 1) {
						return 5;
					}
					if (player === target && player.countCards("h") > player.hp) {
						return 5;
					}
					return 2;
				},
			},
			threaten: 2,
		},
	},

	// ── 示例 B：不消耗牌，仅限一次 ──
	mypack_free_once: {
		enable: "phaseUse",
		usable: 1,
		filter(event, player) {
			// 主动技也可用 filter 做整体可用性判定
			return player.countCards("h") > 0;
		},
		async content(event, trigger, player) {
			await player.draw(2);
		},
		ai: {
			order: 7,
			result: {
				player(player) {
					return 3;
				},
			},
		},
	},

	// ── 示例 C：需要选择目标但无牌代价 ──
	mypack_target_only: {
		enable: "phaseUse",
		usable: 1,
		filterTarget(card, player, target) {
			return target !== player && target.countCards("h") > 0;
		},
		selectTarget: 1,
		async content(event, trigger, player) {
			const target = event.targets[0];
			await player.gainPlayerCard(target, "h", true);
		},
		ai: {
			order: 8,
			result: {
				target(player, target) {
					return -get.attitude(player, target) * 2;
				},
			},
		},
	},

	// ── 示例 D：选牌 + 选目标 + 复杂效果 ──
	mypack_complex_active: {
		enable: "phaseUse",
		usable: 1,
		position: "he",
		filterCard(card, player) {
			return get.type(card) !== "basic";
		},
		selectCard: [1, 2], // 选 1~2 张
		selectTarget: 1,
		filterTarget(card, player, target) {
			return target !== player;
		},
		async content(event, trigger, player) {
			const cards = event.cards; // 选中的牌（已弃置）
			const target = event.targets[0];

			await target.damage(cards.length);
			if (cards.length === 2) {
				await player.draw();
			}
		},
		ai: {
			order: 6,
			result: {
				target(player, target, cards) {
					return get.damageEffect(target, player, player);
				},
			},
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【结构要点】
// enable: "phaseUse"            出牌阶段主动发动
// enable: ["phaseUse","..."]    也可组合其他时机
//
// usable: 1                     每回合限一次（回合结束自动重置）
// usable: (skill, player) => n  动态次数
//
// selectCard: 1                 选 1 张
// selectCard: [1, 2]            选 1~2 张
// selectCard: -1                无限张
//
// position: "he"                可选的牌区域
//
// 【content 中的产出】
//   event.cards      选中的牌（数组）
//   event.targets    选中的目标（数组）
//   event.target     单目标快捷方式（多目标时为 undefined！）
//
// 【AI 配置】
//   ai.order              出牌阶段发动优先级
//   ai.result.target      AI 对目标的收益评估
//   ai.result.player      AI 对自己的收益评估
//   ai.threaten           威胁度（影响被集火）
//
// 【常见坑】
// ✗ 用 event.target 处理多目标 → 多目标时它是 undefined
// ✗ filterTarget 里改状态 → 会被反复调用
// ✗ selectTarget 与 filterTarget 不匹配 → 技能无法发动，需在 filter 层预判
// ✗ 忘记 usable → 技能可无限发动
// ═══════════════════════════════════════════════════════════
