// 武将包入口 —— 汇总所有子模块并注册
// 参考：apps/core/extension/英雄杀/character/index.js
import { game } from "noname";
import character from "./character.js";
import skill from "./skill.js";
import translate from "./translate.js";
import characterIntro from "./intro.js";
import characterSort, { characterSortTranslate } from "./sort.js";
import characterFilter from "./characterFilter.js";
import dynamicTranslate from "./dynamicTranslate.js";

game.import("character", function () {
	return {
		// ⚠️ 在【扩展内】这个 name 会被强制覆盖为扩展文件夹名
		//    依据：apps/core/noname/init/loading.ts:269 → content.name = extension[0]
		//    所以写 "mypack" 或 "我的扩展" 都一样，最终生效值是扩展目录名。
		//    但 characterSort 的【外层键】必须与最终生效值（扩展名）一致！
		name: "mypack",

		character, // 武将定义
		skill, // 技能定义
		translate: {
			...translate,
			...characterSortTranslate, // 分组名翻译
		},
		characterIntro, // 武将介绍（可选）
		characterSort, // 分组排序（可选）
		characterFilter, // 筛选器（可选）
		dynamicTranslate, // 动态技能描述（可选）

		// 其他可选字段（详见 docs/YRD/templates/README.md）：
		// connect: true,            // 该包可否联机
		// characterTitle: {...},    // 武将称号
		// card: {...},              // 该包独有卡牌
		// perfectPair: {...},       // 珠联璧合（国战）
		// pinyins: {...},           // 拼音覆盖（多音字/外文名）
	};
});
