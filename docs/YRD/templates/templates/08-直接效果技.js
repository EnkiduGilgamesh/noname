// ═══════════════════════════════════════════════════════════
// 模板 08 · 直接效果技（摸牌 / 伤害 / 回复 / 弃牌）
// ═══════════════════════════════════════════════════════════
// 技能 content 中执行具体效果。所有效果 API 都返回可 await 的事件。
//
// 参考：apps/core/character/standard/skill.js（lianying 连营 / stdkuangfu 匡扶）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：摸牌 ──
	mypack_lianying: {
		trigger: {
			player: "loseAfter",
			global: ["equipAfter", "addJudgeAfter", "gainAfter", "loseAsyncAfter", "addToExpansionAfter"],
		},
		frequent: true,
		filter(event, player) {
			if (player.hasCards("h")) {
				return false;
			}
			const evt = event.getl(player);
			return evt && evt.player === player && evt.hs && evt.hs.length > 0;
		},
		async content(event, trigger, player) {
			await player.draw();
		},
	},

	// ── 示例 B：条件分支效果（匡扶） ──
	mypack_stdkuangfu: {
		trigger: { player: "damageEnd" },
		async content(event, trigger, player) {
			// 先挂临时技能，再执行效果（顺序重要）
			player.addTempSkill("mypack_stdkuangfu_used", "phaseChange");

			if (trigger.player.hp < player.hp) {
				await player.draw(2);
			} else {
				await player.loseHp();
			}
		},
		subSkill: {
			used: {
				charlotte: true,
			},
		},
	},

	// ── 示例 C：全部效果 API 速览 ──
	mypack_all_effects: {
		trigger: { player: "phaseUseBegin" },
		forced: true,
		async content(event, trigger, player) {
			// ① 摸牌（nodelay 跳过动画，用于摸牌阶段内）
			await player.draw(2);
			await player.draw({ nodelay: true });

			// ② 回复体力（满血时为空操作，不报错）
			if (player.isDamaged()) {
				await player.recover(1);
			}

			// ③ 失去体力（不触发伤害事件，无来源）
			await player.loseHp(1);

			// ④ 造成伤害（触发 damage 事件，有来源，可被响应）
			await player.damage(1);
			await player.damage({
				nature: "fire", // 属性：fire / thunder / ice / poison
				source: player,
				card: trigger.card,
			});

			// ⑤ 弃牌
			const cards = player.getCards("h").slice(0, 1);
			if (cards.length) {
				await player.discard({ cards, discarder: player });
			}

			// ⑥ 获得牌
			const target = game.players.find(p => p !== player);
			if (target) {
				const gainCards = target.getCards("h").slice(0, 1);
				if (gainCards.length) {
					await player.gain({ cards: gainCards, animate: "gain2" });
				}
			}

			// ⑦ 改体力上限
			await player.loseMaxHp();
			// await player.gainMaxHp();

			// ⑧ 翻面
			// await player.turnOver();
		},
	},

	// ── 示例 D：强制对手选择 ──
	mypack_yaowu: {
		trigger: { player: "damageEnd" },
		filter(event, player) {
			return event.source && event.source.isAlive();
		},
		async content(event, trigger, player) {
			// forced: true 表示对方【必须】做出选择
			await trigger.source.chooseDrawRecover({ forced: true });
		},
	},

	// ── 示例 E：给对方牌 / 从对方拿牌 ──
	mypack_card_transfer: {
		trigger: { player: "phaseJieshuBegin" },
		frequent: true,
		async content(event, trigger, player) {
			const result = await player
				.chooseTarget("选择一名角色", (card, player, target) => target !== player && target.countCards("h") > 0)
				.set("ai", target => -get.attitude(get.player(), target))
				.forResult();

			if (result.bool) {
				const target = result.targets[0];
				// 获得对方一张手牌
				await player.gainPlayerCard(target, "h", true);
				// 或：弃置对方一张牌
				// await player.discardPlayerCard(target, "he", true);
			}
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【效果 API 速查】
//
// player.draw(n)                          摸 n 张
// player.draw({ nodelay: true })          摸牌但跳过动画
// player.recover(n)                       回复 n 点体力
// player.loseHp(n)                        失去 n 点体力
// player.damage(n)                        造成 n 点伤害
// player.damage({ nature, source, card }) 带属性的伤害
// player.discard({ cards, discarder })    弃牌
// player.gain({ cards, animate })         获得牌
// player.gainPlayerCard(target, pos, bool) 获得对方牌
// player.discardPlayerCard(target, pos, bool) 弃置对方牌
// player.gainMaxHp() / loseMaxHp()        改体力上限
// player.turnOver()                       翻面
// player.addToExpansion({...})            移出游戏
//
// 【damage vs loseHp —— 重大区别】
//   damage  → 产生 damage 事件，有来源，可被防具/技能响应（卖血技用这个）
//   loseHp  → 仅扣体力，无来源，不触发伤害事件（苦肉类用这个）
//
// 【常见坑】
// ✗ 不 await 效果事件 → 后续逻辑在效果结算前执行，产生竞态
// ✗ recover() 满血时静默无效 → 应先判断 player.isDamaged()
// ✗ 摸牌阶段内 draw() 不传 nodelay → 动画叠加卡顿
// ✗ 用 loseHp 实现「造成伤害」的技能 → 无法被闪避/响应，偏离设计意图
// ═══════════════════════════════════════════════════════════
