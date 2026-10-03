// 分组排序 + 分组名翻译
// 参考：apps/core/extension/3D精选/character/sort.js
//       apps/core/character/standard/sort.js

// 武将包内各武将的显示顺序（未列出的排在后面）
export const characterSort = {
	// ⚠️ 外层键会在入口被包成 characterSort: { <扩展名>: characterSort }
	//    依据：apps/core/noname/init/loading.ts:269 会把武将包 name 覆盖为扩展文件夹名，
	//    且 UI 用 lib.characterSort[mode][packName] 取值（characterPackMenu.js:276）。
	//    所以这里的键名应与扩展目录名保持一致。
	mypack: ["mypack_guanyu", "mypack_zhangfei", "mypack_wuzetian", "mypack_boss"],
};

// 分组在 UI 上的显示名（键必须与 characterSort 的键一致）
export const characterSortTranslate = {
	mypack: "我的扩展",
};

export default characterSort;
