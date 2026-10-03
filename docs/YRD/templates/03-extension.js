// 扩展入口 —— 必须同时导出 type 与 default
// 约定来源：apps/core/noname/init/import.ts:72-77
import { lib, game, ui, get, ai, _status } from "noname";
import { precontent } from "./main/precontent.js";
import { content } from "./main/content.js";

// 读取 info.json（用模板字符串拼接扩展目录名，避免中文转义问题）
const extensionInfo = await lib.init.promises.json(`${lib.assetURL}extension/我的扩展/info.json`);

const extensionPackage = {
	name: "我的扩展",
	config: {},
	help: {},
	package: {},
	precontent,
	content,
	files: {
		character: [],
		card: [],
		skill: [],
		audio: [],
	},
};

// 把 info.json 的内容并入 package（约定写法，见 apps/core/extension/英雄杀/extension.js）
Object.keys(extensionInfo)
	.filter(key => key !== "name")
	.forEach(key => {
		extensionPackage.package[key] = extensionInfo[key];
	});

export let type = "extension";
export default extensionPackage;
