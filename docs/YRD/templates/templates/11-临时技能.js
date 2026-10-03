// ═══════════════════════════════════════════════════════════
// 模板 11 · 临时技能（addTempSkill）
// ═══════════════════════════════════════════════════════════
// 技能获得的「限时生效」子技能，到期自动移除。
//
// 参考：apps/core/character/standard/skill.js（stdkuangfu / zhongyi）
//       apps/core/character/bingshi/skill.js（baiban）
//       apps/core/character/refresh/skill.js（olguzheng）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ═══ 第二参数的四种写法 ═══

	mypack_temp_demo: {
		trigger: { player: "phaseUseBegin" },
		forced: true,
		async content(event, trigger, player) {
			// ── 写法 A：字符串时机（最常用）──
			// 在本回合「阶段切换」时移除
			player.addTempSkill("mypack_buff_a", "phaseChange");

			// 在「一轮开始」时移除
			player.addTempSkill("mypack_buff_b", "roundStart");

			// ── 写法 B：对象形式 { 作用域: 时机 } ──
			// player = 技能拥有者的阶段后；global = 任何人的阶段后
			player.addTempSkill("mypack_buff_c", { player: "phaseAfter" });
			player.addTempSkill("mypack_buff_d", { player: "phaseBeforeStart" });

			// ── 写法 C：数组（任一时机触发即移除）──
			player.addTempSkill("mypack_buff_e", ["phaseZhunbeiAfter", "phaseDrawAfter", "phaseUseAfter", "phaseDiscardAfter", "phaseJieshuAfter"]);

			// 用 lib.phaseName 动态生成全部阶段
			player.addTempSkill("mypack_buff_f", ["phaseBefore", "phaseChange", ...lib.phaseName.map(i => i + "After")]);

			// ── 写法 D：省略第二参数 ──
			// 默认在本回合结束时移除
			player.addTempSkill("mypack_buff_g");
		},

		// ═══ 临时技能的定义 ═══
		// 临时技能的 ID 必须已在 lib.skill 中定义，否则 addTempSkill 静默失败
		subSkill: {
			// 最简形式：只是一个占位标记
			buff_a: { charlotte: true },
			buff_b: { charlotte: true },
			buff_c: { charlotte: true },
			buff_d: { charlotte: true },
			buff_e: { charlotte: true },
			buff_f: { charlotte: true },
			buff_g: { charlotte: true },
		},
	},

	// ═══ 实战：临时获得一个有效果的技能 ═══

	mypack_gain_temp_effect: {
		trigger: { player: "phaseZhunbeiBegin" },
		frequent: true,
		async content(event, trigger, player) {
			// 挂上临时技能：本回合内+1手牌上限
			player.addTempSkill("mypack_extra_hand");

			await player.draw(2);
		},
	},

	mypack_extra_hand: {
		charlotte: true,

		// 临时技能可以有实际的 mod 效果
		mod: {
			maxHandcard(player, num) {
				return num + 1;
			},
		},
	},

	// ═══ 实战：临时改变技能行为 ═══

	mypack_temp_viewas: {
		trigger: { player: "phaseUseBegin" },
		forced: true,
		async content(event, trigger, player) {
			// 本回合可以将任意牌当【杀】使用
			player.addTempSkill("mypack_any_to_sha", "phaseChange");
		},
	},

	mypack_any_to_sha: {
		charlotte: true,
		enable: ["chooseToUse", "chooseToRespond"],
		filterCard: true,
		viewAs: { name: "sha" },
		position: "hes",
		prompt: "将一张牌当杀使用或打出",
		check(card) {
			return 5 - get.value(card);
		},
	},

	// ═══ 实战：带标记的临时状态 ═══

	mypack_marked_temp: {
		trigger: { player: "phaseDrawBegin" },
		frequent: true,
		async content(event, trigger, player) {
			player.addTempSkill("mypack_marked_buff", { player: "phaseAfter" });

			// 同时加可见标记
			player.markAuto("mypack_marked_buff", ["已强化"]);
		},
	},

	mypack_marked_buff: {
		charlotte: true,
		intro: {
			content: "mark",
		},
		mod: {
			maxHandcard(player, num) {
				return num + 2;
			},
		},
	},

	// ═══ 批量操作 ═══

	mypack_batch: {
		trigger: { player: "phaseZhunbeiBegin" },
		forced: true,
		async content(event, trigger, player) {
			// 批量加临时技能
			player.addTempSkills(["mypack_buff_a", "mypack_buff_b"], "phaseChange");

			// 永久获得技能
			await player.addSkills(["mypack_permanent"]);

			// 移除技能
			player.removeSkill("mypack_permanent");
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【签名】
//   player.addTempSkill(skillId, expireTiming?)
//   player.addTempSkills([id1, id2], expireTiming?)
//
// 【expireTiming 的三种形式】
//   字符串   "phaseChange"                   单个时机
//   对象     { player: "phaseAfter" }         指定作用域 + 时机
//   数组     ["phaseDrawAfter", "phaseUseAfter"]  任一触发即移除
//   省略     默认本回合结束时移除
//
// 【作用域取值】
//   player  技能拥有者的时机
//   global  任何人的时机
//   source  事件的来源方
//   target  事件的目标方
//
// 【常用时机】
//   "phaseChange"      本回合任意阶段切换时（最常用于「本回合内」）
//   "phaseAfter"       本回合结束后
//   "roundStart"       一轮开始时
//   "phaseDrawAfter"   摸牌阶段后
//
// 【⚠️ 关键前提】
//   临时技能的 ID 必须已经在 lib.skill 中定义！
//   通过 subSkill 生成（父ID_短名）或顶层定义均可。
//   未定义的 ID → addTempSkill 静默失败，【无任何报错】
//
// 【常见坑】
// ✗ 忘记 charlotte: true → 临时技能显示在武将牌上，玩家看到莫名图标
// ✗ "phaseChange" 与 "phaseAfter" 混淆：
//     phaseChange = 本回合内任意阶段切换时移除
//     phaseAfter  = 本回合【结束】后移除
//   用错会让技能活得比预期久
// ✗ 对象形式的作用域写错（如把 { player: ... } 写成 { global: ... }）
//   → 技能永远不被清除，造成状态泄漏
// ✗ 在 cost 中调 addTempSkill → 应该在 content 中
// ✗ 先执行效果再 addTempSkill（顺序反了）→ 效果可能自我重复触发
//   正确：先 addTempSkill，再执行效果
// ✗ 临时技能 ID 未定义 → 静默失败
// ═══════════════════════════════════════════════════════════
