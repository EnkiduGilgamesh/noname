// ═══════════════════════════════════════════════════════════
// 模板 02 · 锁定技
// ═══════════════════════════════════════════════════════════
// 满足条件即强制发动，不询问玩家。
//
// 结构：trigger + forced + content
// 参考：apps/core/character/standard/skill.js（paoxiao 咆哮 / qicai 奇才）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：锁定技 + 有效果 ──
	mypack_stdqingjiao: {
		trigger: { player: "phaseJieshuBegin" },

		// filter 仍然生效：条件不满足则不发动
		filter(event, player) {
			return player.hasHistory("sourceDamage", evt => evt.player !== player && evt.player?.group === "qun");
		},

		// ① 强制发动，不询问玩家
		forced: true,

		async content(event, trigger, player) {
			await player.draw();
		},
	},

	// ── 示例 B：纯被动修正（用 mod，不用 trigger） ──
	// 改距离、改可用次数、改手牌上限等「静默修正」应使用 mod
	mypack_paoxiao: {
		trigger: { player: "useCard1" },
		forced: true,
		firstDo: true, // 在同时机技能中【最先】结算

		filter(event, player) {
			return !event.audioed && event.card.name === "sha" && player.countUsed("sha", true) > 1 && event.getParent()?.type === "phase";
		},

		async content(event, trigger, player) {
			trigger.audioed = true; // 只播一次音效
		},

		// mod：直接修改游戏规则，无事件开销
		mod: {
			// 【杀】使用次数无限制
			cardUsable(card, player, num) {
				if (card.name === "sha") {
					return Infinity;
				}
				// 返回 undefined = 不干预，交给下一个修正
			},
		},
	},

	// ── 示例 C：纯 mod 技能（无 trigger / 无 content） ──
	mypack_qicai: {
		mod: {
			// 锦囊与延时锦囊无视距离
			targetInRange(card, player, target, now) {
				if (["trick", "delay"].includes(get.type(card))) {
					return true; // 返回 true = 距离视为满足
				}
			},
		},
	},

	// ── 示例 D：锁定技 + 强制玩家选择 ──
	mypack_forced_choice: {
		trigger: { player: "phaseDrawBegin" },
		forced: true,
		async content(event, trigger, player) {
			// forced: true 传给 choose 事件，表示玩家【必须】做出选择
			await player.chooseDrawRecover({ forced: true });
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【要点】
// 1. forced: true → 自动发动，不弹确认框
// 2. forced 与 filter 是【正交】的：filter 决定「能不能」，forced 决定「要不要问」
// 3. firstDo: true → 在同时机技能队列中最先结算
// 4. 纯规则修正（距离/次数/上限）用 mod，不要用 trigger
//
// 【mod 返回值约定】
//   targetInRange  → true 表示距离满足；undefined 表示不干预
//   cardUsable     → 返回数字表示次数上限；Infinity 表示无限
//   其他 mod 函数同理：返回具体值 = 覆盖，返回 undefined = 交给下一个
//
// 【常见坑】
// ✗ 锁定技再写 cost 或 usable → 语义冲突
// ✗ 用 trigger 实现纯数值修正 → 事件开销大且时机可能不对
// ✗ forced 技能里 choose* 忘记传 forced: true → 变成「强制发动但可拒绝选择」
// ═══════════════════════════════════════════════════════════
