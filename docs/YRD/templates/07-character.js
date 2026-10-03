// 武将定义
// 参考：apps/core/extension/英雄杀/character/character.js

/** @type { importCharacterConfig['character'] } */
const character = {
	// ── 标准武将 ──
	mypack_guanyu: {
		sex: "male", // "male" | "female" | "double"
		group: "shu", // 合法值：wei/shu/wu/qun/jin/shen（英雄杀等扩展可自建势力，但需额外注册）
		hp: 4, // 体力
		skills: ["mypack_wusheng", "mypack_yijue"],
		// img: "extension/我的扩展/image/character/mypack_guanyu.jpg",  // 建议显式写，见下方说明
	},

	// ── 带 names 的武将（用于「姓|名」竖排显示） ──
	mypack_wuzetian: {
		sex: "female",
		group: "qun",
		hp: 4,
		skills: ["mypack_nvquan"],
		names: "武|曌", // 格式「姓|名」；"null|null" 表示不显示
	},

	// ── 分离 hp / maxHp / hujia（对象格式推荐写法） ──
	mypack_zhangfei: {
		sex: "male",
		group: "shu",
		hp: 3,
		maxHp: 4, // ⚠️ 对象格式下 maxHp 非 number 时【回落为 hp】
		hujia: 1, // 护甲
		skills: ["mypack_paoxiao"],
	},

	// ── Boss 武将 ──
	mypack_boss: {
		sex: "male",
		group: "qun",
		hp: 8,
		skills: ["mypack_boss_skill"],
		isBoss: true, // 挑战模式 BOSS
		// isHiddenBoss: true,      // 隐藏 BOSS
	},
};

// ⚠️ 立绘路径：引擎的自动推导指向「扩展根目录」（loading.ts:304）：
//      extension/<扩展名>/<武将ID>.jpg
//    但官方扩展用的是「image/character 子目录」布局（英雄杀/character.js:290）：
//      extension/英雄杀/image/character/<武将ID>.jpg
//    两种布局并存。**建议显式写 img，或统一循环赋值**，不要依赖隐式约定：
//
//    for (const id in character) {
//        character[id].img = `extension/我的扩展/image/character/${id}.jpg`;
//    }

export default character;

