// 扩展加载【前】执行 —— 引入武将包/卡牌包，并设置分组显示名
// 参考：apps/core/extension/英雄杀/main/precontent.js
import { lib } from "noname";

// 引入武将包（触发其中的 game.import("character", ...)）
import "../character/index.js";

export function precontent(config, pack) {
	// 武将包分组在 UI 上显示的名字
	lib.translate.我的扩展_character_config = "我的扩展";
}
