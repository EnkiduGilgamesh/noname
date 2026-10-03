// ═══════════════════════════════════════════════════════════
// 模板 07 · 状态切换技（转换技）
// ═══════════════════════════════════════════════════════════
// 新版无名杀【没有】内建的「转换技」字段，统一用 storage / markAuto 自行记录状态。
//
// 参考：apps/core/character/standard/skill.js（rende1 计数器）
//       apps/core/character/refresh/skill.js（reshuangxiong 双雄）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：用 storage 记录内部计数器（不显示） ──
	mypack_counter: {
		enable: "phaseUse",
		usable: 1,
		async content(event, trigger, player) {
			// 读取状态（用 ?? 给初始值）
			const count = player.storage.mypack_counter ?? 0;

			await player.draw(count + 1);

			// 写入状态
			player.storage.mypack_counter = count + 1;
		},
	},

	// ── 示例 B：计数器在出牌阶段重置（附属技能接力） ──
	// 主技能只负责累加，另配一个 silent 子技能在回合开始重置
	mypack_rende: {
		enable: "phaseUse",
		filterCard: true,
		position: "he",

		// ① 关联重置技能
		group: "mypack_rende_reset",

		async content(event, trigger, player) {
			const count = player.storage.mypack_rende ?? 0;
			await player.draw(count + 1);
			player.storage.mypack_rende = count + 1;
		},
	},

	mypack_rende_reset: {
		trigger: { player: "phaseUseBegin" },

		// silent：不播报、不弹提示
		silent: true,

		// charlotte：不显示在武将牌上（内部技能必加）
		charlotte: true,

		// 回指父技能，战报中归到父技能名下
		sourceSkill: "mypack_rende",

		async content(event, trigger, player) {
			player.storage.mypack_rende = 0;
		},
	},

	// ── 示例 C：两种模式切换（markAuto 显示标记） ──
	mypack_dual_mode: {
		enable: "phaseUse",
		usable: 1,

		// ① intro 让标记显示在武将牌上
		intro: {
			content: "mode",
		},

		filter(event, player) {
			return true;
		},

		async content(event, trigger, player) {
			// ② 读取当前模式
			const mode = player.storage.mypack_dual_mode ?? "attack";

			if (mode === "attack") {
				// 攻击模式 → 造成伤害，切到防御
				const result = await player
					.chooseTarget("选择一名角色造成伤害", (card, player, target) => target !== player)
					.set("ai", target => get.damageEffect(target, get.player(), get.player()))
					.forResult();
				if (result.bool) {
					await result.targets[0].damage();
				}
				player.storage.mypack_dual_mode = "defense";
				player.markAuto("mypack_dual_mode", ["defense"]); // ← 更新可见标记
			} else {
				// 防御模式 → 摸牌，切到攻击
				await player.draw(2);
				player.storage.mypack_dual_mode = "attack";
				player.markAuto("mypack_dual_mode", ["attack"]);
			}
		},
	},

	// ── 示例 D：转换技的标准写法（阴阳式） ──
	mypack_yinyang: {
		enable: "phaseUse",
		usable: 1,

		// 用子技能承载两种形态
		group: ["mypack_yinyang_yang", "mypack_yinyang_yin"],

		subSkill: {
			yang: {
				charlotte: true,
				enable: "phaseUse",
				filter(event, player) {
					return (player.storage.mypack_yinyang ?? "yang") === "yang";
				},
				async content(event, trigger, player) {
					await player.draw(2);
					player.storage.mypack_yinyang = "yin";
				},
			},
			yin: {
				charlotte: true,
				enable: "phaseUse",
				filter(event, player) {
					return player.storage.mypack_yinyang === "yin";
				},
				async content(event, trigger, player) {
					await player.recover();
					player.storage.mypack_yinyang = "yang";
				},
			},
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【状态载体的三种选择】
//
// 1. player.storage.<skillId>
//    任意 JS 值 / 对象。不显示在武将牌上。适合内部计数器、隐藏状态。
//
// 2. player.markAuto(skillId, [values])
//    显示在武将牌上。需配合 intro: { content: "mark" } 或类似配置。
//    ⚠️ 内部存的是【数组】，不要直接用 player.storage.x = true 破坏结构
//
// 3. 子技能形态（group / subSkill）
//    把两种形态做成两个子技能，各自用 filter 判断当前该用哪个。
//    这是最贴近官方「转换技」的写法。
//
// 【清空状态】
//   player.storage 不会自动清理，换将/重生时需要手动处理：
//   onremove(player, skill) { delete player.storage[skill]; }
//
// 【常见坑】
// ✗ 在 filter 里写状态 → filter 反复调用，状态错乱
//   ✓ 状态写入必须在 content 中
// ✗ 用 markAuto 却没配 intro → 状态不显示，玩家看不到
// ✗ 直接 player.storage.x = true 覆盖 markAuto 的数组结构
// ✗ 忘记清理 storage，导致换将后状态残留
// ═══════════════════════════════════════════════════════════
