// 扩展加载【后】执行 —— 做 rank、默认配置等后处理（本文件可整段删除，若不需要）
// 参考：apps/core/extension/英雄杀/main/content.js
import { lib, game } from "noname";

export function content(config, pack) {
	// ── 把武将加入强度评级（影响 AI 选将与平衡） ──
	if (lib.rank) {
		const rank = {
			a: ["mypack_guanyu"], // 强将
			b: ["mypack_zhangfei"], // 中等
		};
		for (const key in rank) {
			lib.rank[key].addArray(rank[key]);
		}
	}

	// ── 示例：禁用某些武将进入某个模式 ──
	// if (Array.isArray(lib.config.forbidstone)) {
	// 	lib.config.forbidstone.addArray(["mypack_guanyu"]);
	// 	game.saveConfig("forbidstone", lib.config.forbidstone);
	// }
}
