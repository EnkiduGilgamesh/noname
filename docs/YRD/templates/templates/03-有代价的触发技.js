// ═══════════════════════════════════════════════════════════
// 模板 03 · 有代价的触发技（cost）
// ═══════════════════════════════════════════════════════════
// 发动前需要付出代价（弃牌、失去体力、选择目标等）。
//
// 结构：trigger + filter + cost + content
// 参考：apps/core/character/standard/skill.js（stdshushen 淑慎 / stdxiaoguo 骁果）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：cost 选择目标 ──
	mypack_stdshushen: {
		trigger: { player: "recoverEnd" },

		// 一次触发按回复点数发动多次
		getIndex(event) {
			return event.num || 1;
		},

		// ① cost：能否发动 + 选择目标
		// ⚠️ 必须写 event.result = await ....forResult()
		async cost(event, trigger, player) {
			event.result = await player
				.chooseTarget({
					prompt: get.prompt2(event.skill),
					filterTarget: lib.filter.notMe,
					ai(target) {
						return get.attitude(get.player(), target);
					},
				})
				.forResult();
		},

		// ② content：使用 cost 的产出
		async content(event, trigger, player) {
			const target = event.targets[0]; // ← cost 选出的目标
			await target.draw(target.countCards("h") ? 1 : 2);
		},

		ai: { threaten: 0.8, expose: 0.1 },
	},

	// ── 示例 B：cost 弃牌（代价型） ──
	mypack_stdxiaoguo: {
		trigger: { player: "phaseZhunbeiBegin" },
		logTarget: "player", // 战报目标取自 trigger.player

		async cost(event, trigger, player) {
			const target = trigger.player;
			event.result = await player
				.chooseToDiscard({
					prompt: get.prompt(event.skill),
					filterCard(card, player) {
						return get.type(card) === "basic";
					},
					chooseonly: true,
					ai(card) {
						// ⚠️ AI 回调里用 get.event() 读取 .set() 传入的值
						return get.event().eff - get.useful(card);
					},
				})
				.set("eff", get.effect(target, { name: "sha" }, player, player))
				.forResult();
		},

		async content(event, trigger, player) {
			const target = trigger.player;
			// event.cards 是 cost 中选出的牌（由 forResult 自动展开）
			await player.discard({ cards: event.cards, discarder: player });
			await target.damage();
		},
	},

	// ── 示例 C：cost 中允许玩家取消 ──
	mypack_optional: {
		trigger: { player: "phaseUseBegin" },
		async cost(event, trigger, player) {
			const result = await player
				.chooseControl(["发动", "cancel2"])
				.set("prompt", "是否发动？")
				.set("ai", () => (player.countCards("h") > 2 ? 0 : 1))
				.forResult();

			// 选择「取消」时显式声明不发动
			if (result.control === "cancel2") {
				event.result = { bool: false };
			} else {
				event.result = { bool: true };
			}
		},
		async content(event, trigger, player) {
			await player.draw(2);
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【结构要点】
// 1. cost 中【必须】写 event.result = await ....forResult()
// 2. cost 的产出（cards / targets）在 content 中通过 event.cards / event.targets 访问
// 3. 有 cost 时【不需要】direct: true（后者已过时）
// 4. 想让玩家可取消：在 cost 中把 event.result 设为 { bool: false }
// 5. getIndex 可让一次触发发动多次
// 6. logTarget 控制战报显示的目标："player" / "targets" / "source" 或函数
//
// 【filter vs cost】
//   filter(event, player, triggername, indexedData) → 纯判定，无副作用，反复调用
//   cost(event, trigger, player)                    → 执行代价，写 event.result，仅调用一次
//
// 【AI 回调注意事项】
//   choose 的 ai 回调中【不能】直接用外层 player 变量
//   ✓ get.player()  /  get.event().player
//   ✓ 用 .set(key, value) 传值，回调里 get.event().key 读取
//
// 【常见坑】
// ✗ 忘记 event.result = ... → 技能永不发动，且【无任何报错】
// ✗ 忘记 .forResult() → event.result 变成事件对象，bool 判定异常
// ✗ 在 filter 里选目标/弃牌 → 会被反复执行
// ═══════════════════════════════════════════════════════════
