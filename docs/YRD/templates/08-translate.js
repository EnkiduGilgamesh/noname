// 翻译表 —— 武将名 / 技能名 / 技能描述
// 参考：apps/core/extension/英雄杀/character/translate.js

const translate = {
	// ═══ 武将名 ═══
	mypack_guanyu: "关羽",
	mypack_wuzetian: "武则天",
	mypack_zhangfei: "张飞",

	// ═══ 技能名 ═══
	mypack_wusheng: "武圣",
	mypack_nvquan: "女权",
	mypack_paoxiao: "咆哮",

	// ═══ 技能描述（技能ID + _info）═══
	// 描述中可用特殊标记：
	//   $      → 在技能提示框中替换为动态内容（配合 dynamicTranslate）
	//   #g     → 绿色文字
	//   #y     → 黄色文字
	//   #r     → 红色文字
	//   <br>   → 换行
	mypack_wusheng_info: "你可以将一张红色牌当【杀】使用或打出。",
	mypack_nvquan_info: "出牌阶段限一次，你可以令一名男性角色交给你一张牌。",
	mypack_paoxiao_info: "锁定技，你使用【杀】无次数限制。",

	// ═══ 武将称号（可选，出现在武将名下方）═══
};

export default translate;

// 武将称号单独导出时会并入 characterTitle，此处演示内联写法
export const characterTitle = {
	mypack_guanyu: "#g美髯公",
	mypack_wuzetian: "#g则天皇帝",
};
