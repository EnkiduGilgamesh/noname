// ═══════════════════════════════════════════════════════════
// 模板 01 · 被动触发技
// ═══════════════════════════════════════════════════════════
// 最常见的技能形态：满足 filter 条件时，询问玩家是否发动。
//
// 结构：trigger + filter + content
// 参考：apps/core/character/standard/skill.js（jizhi 集智）
// ═══════════════════════════════════════════════════════════

const skill = {
	// ── 示例 A：结束阶段摸牌（最简单） ──
	mypack_biyue: {
		// ① 何时触发
		trigger: { player: "phaseJieshuBegin" },

		// ② 频繁发动：不弹确认框，由 AI 决定（纯收益技能建议加）
		frequent: true,

		// ③ 效果
		async content(event, trigger, player) {
			await player.draw();
		},
	},

	// ── 示例 B：带 filter 的条件触发 ──
	mypack_jizhi: {
		trigger: { player: "useCard" },
		frequent: true,

		// filter 是【纯判定】：返回 false 则本次不触发
		// 签名：filter(event, player, triggername, indexedData)
		// ⚠️ 禁止在此处产生副作用（弃牌、改状态等）—— 它会被反复调用
		filter(event, player, triggername, indexedData) {
			// event 是【触发源事件】，这里是 useCard 事件
			return get.type(event.card) === "trick";
		},

		async content(event, trigger, player) {
			// trigger 是触发源事件（useCard），可读取其信息
			const cardName = trigger.card.name;
			await player.draw({ nodelay: true });
			game.log(player, "因", `【${get.translation(event.name)}】`, "摸了一张牌");
		},

		ai: {
			threaten: 1.4,
			noautowuxie: true,
		},
	},

	// ── 示例 C：多个时机 ──
	mypack_multi: {
		trigger: {
			player: ["phaseZhunbeiBegin", "phaseJieshuBegin"], // 数组 = 多个时机
			global: "gameStart", // 也可混合不同作用域
		},
		forced: true,
		async content(event, trigger, player) {
			// 用 triggername 或 trigger.name 区分是哪个时机触发的
			if (trigger.name === "phaseZhunbei") {
				await player.draw();
			} else {
				await player.recover();
			}
		},
	},

	// ── 示例 D：读取触发信息的完整写法 ──
	mypack_damage_response: {
		trigger: { player: "damageEnd" },
		frequent: true,
		filter(event, player) {
			// event.num 是伤害点数，event.source 是伤害来源
			return event.num > 0 && event.source && event.source.isAlive();
		},
		async content(event, trigger, player) {
			const num = trigger.num; // 伤害点数
			const source = trigger.source; // 伤害来源
			const nature = trigger.nature; // 属性（fire/thunder/...）

			await player.draw(num);

			if (source && source.countCards("h") > 0) {
				await player.discardPlayerCard(source, "h", true);
			}
		},
	},
};

export default skill;

// ═══════════════════════════════════════════════════════════
// 【要点】
// 1. trigger 必须是【对象】，不能写成字符串
// 2. trigger 的每个作用域值可以是字符串或字符串数组
// 3. filter 返回 false 时完全不触发；无 filter 则总是触发（会询问玩家）
// 4. 纯收益技能应加 frequent: true 或 forced: true，否则每次都弹窗询问
// 5. content 中必须 await 异步效果，否则产生竞态
//
// 【常见坑】
// ✗ 在 filter 里弃牌/改状态 → 会被执行几十次
// ✗ trigger: "useCard"（字符串）→ 报错
// ✗ content 里不 await → 后续逻辑提前执行
// ✗ 忘记 frequent → 每次触发都弹窗，体验极差
// ═══════════════════════════════════════════════════════════
