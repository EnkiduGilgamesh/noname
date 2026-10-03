// ═══════════════════════════════════════════════════════════
// 模板 09 · 多目标技
// ═══════════════════════════════════════════════════════════
// 一次选择多个目标，或有「目标间依赖」的技能（如离间）。
//
// 参考：apps/core/character/standard/skill.js（lijian 离间）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：简单的两目标技能 ──
	mypack_two_target: {
		enable: "phaseUse",
		usable: 1,
		filterCard: true,
		position: "he",

		// ① 必须选 2 个目标
		selectTarget: 2,

		// ② 多目标结算（而非依次结算两次）
		multitarget: true,

		// ③ 每个目标位置配提示
		targetprompt: ["先出杀", "后出杀"],

		filterTarget(card, player, target) {
			return target !== player;
		},

		// ④ 整体可用性预判：目标不足时技能不亮起
		filter(event, player) {
			return game.countPlayer(current => current !== player) >= 2;
		},

		async content(event, trigger, player) {
			// event.targets 是数组，按选择顺序
			const [first, second] = event.targets;

			await second.useCard({
				card: get.autoViewAs({ name: "juedou", isCard: true }),
				targets: [first],
				nowuxie: true,
				noai: true,
			});
		},

		ai: {
			order: 8,
			result: {
				target(player, target) {
					// ui.selected.targets 可访问【已选目标】
					if (ui.selected.targets.length === 0) {
						return -3;
					}
					return get.effect(target, { name: "juedou" }, ui.selected.targets[0], target);
				},
			},
		},
	},

	// ── 示例 B：目标间有依赖关系（离间式） ──
	mypack_lijian: {
		enable: "phaseUse",
		usable: 1,
		filterCard: true,
		position: "he",

		// ① 先做整体条件预判，避免 filterTarget 无法满足
		filter(event, player) {
			return game.countPlayer(current => current !== player && current.hasSex("male")) > 1;
		},

		filterTarget(card, player, target) {
			if (player === target) {
				return false;
			}
			if (!target.hasSex("male")) {
				return false;
			}

			// ② 关键：第二个目标依赖第一个已选目标
			if (ui.selected.targets.length === 1) {
				return target.canUse({ name: "juedou" }, ui.selected.targets[0]);
			}
			return true;
		},

		selectTarget: 2,
		multitarget: true,
		targetprompt: ["先出杀", "后出杀"],

		async content(event, trigger, player) {
			const next = event.targets[1].useCard({
				card: get.autoViewAs({ name: "juedou", isCard: true }),
				targets: [event.targets[0]],
				nowuxie: true,
				noai: true,
			});
			await game.delay(0.5);
			return next; // 返回事件让引擎等待
		},
	},

	// ── 示例 C：目标数量可变 ──
	mypack_variable_targets: {
		trigger: { player: "phaseJieshuBegin" },
		frequent: true,

		async content(event, trigger, player) {
			const result = await player
				.chooseTarget(
					"选择任意名角色各摸一张牌",
					[1, 3], // 选 1~3 个
					(card, player, target) => target !== player
				)
				.set("ai", target => get.attitude(get.player(), target))
				.forResult();

			if (result.bool) {
				for (const target of result.targets) {
					await target.draw();
				}
			}
		},
	},

	// ── 示例 D：使用 chooseTarget 的完整参数形式 ──
	mypack_choose_target_full: {
		enable: "phaseUse",
		usable: 1,
		async content(event, trigger, player) {
			const result = await player
				.chooseTarget({
					prompt: "选择一名角色",
					filterTarget(card, player, target) {
						return target.countDiscardableCards(player, "ej") > 0;
					},
					selectTarget: 1,
					ai(target) {
						const player = get.player();
						return get.effect(target, { name: "guohe_copy", position: "ej" }, player, player);
					},
				})
				.forResult();

			if (result.bool) {
				const [target] = result.targets;
				await player.discardPlayerCard("ej", true, target);
			}
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【目标的传递链路】
//
//   cost/chooseTarget 的 .forResult()
//          ↓
//   event.result.targets
//          ↓ 引擎自动展开
//   content 中的 event.targets   （数组，按选择顺序）
//   content 中的 event.target    （单目标快捷方式）
//
// ⚠️ 多目标时 event.target 是 undefined，必须用 event.targets
//
// 【关键字段】
//   selectTarget: 2          必须选 2 个
//   selectTarget: [1, 3]     选 1~3 个
//   selectTarget: -1         不限数量
//   multitarget: true        多目标一次结算（而非依次结算）
//   targetprompt: [...]      每个目标位置的提示文字
//
// 【ui.selected.targets】
//   选择过程中可访问【已选目标】，用于实现目标间依赖（离间的经典用法）
//   注意：这只能在 filterTarget / ai.result.target 中使用
//
// 【常见坑】
// ✗ 多目标时用 event.target → undefined，崩溃
// ✗ selectTarget 与 filterTarget 不匹配 → 技能无法发动
//   解决：在 filter 层预判场上是否有足够合法目标（见示例 B）
// ✗ 忘记 multitarget: true → 两目标变成「依次结算两次」
// ✗ 在 filterTarget 里改状态 → 会被反复调用
// ═══════════════════════════════════════════════════════════
