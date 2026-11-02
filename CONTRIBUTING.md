# 参与贡献

谢谢你愿意帮忙。这个插件依赖 X 网页没有公开文档的接口和页面结构，X 一改版就可能失灵，所以最有价值的是**真实使用中的问题报告**。

## 提 Issue

请写清楚：

- 插件版本（`chrome://extensions` 里能看到）和 Chrome 版本
- 你在做什么：关注、取关、浏览「正在关注」页面……
- 期待的结果和实际结果
- 如果方便，打开 X 页面的开发者工具（F12）→ Console，把红色的报错截图贴上来

**不要贴**：你的 Cookie、Token、私信内容或其他账号的隐私信息。

## 提 Pull Request

1. 改动保持小而聚焦，一个 PR 解决一件事。
2. 提交前跑测试：`node tests/run.js`，看到「全部通过」。
3. 改了计算逻辑（`extension/stats.js`）请补测试；改了界面请附截图，浅色、深色各一张。
4. 不要加任何把数据发到外部服务器的代码，也不要加替用户自动关注、取关的功能。这两条是这个项目的底线。
5. 如果改动让插件**读取新的数据**或改变数据用途：同步更新 `extension/welcome.html`、`PRIVACY.md`，并把 `extension/stats.js` 里的 `CONSENT_VERSION` 加 1，让用户重新同意。

## 代码约定

- 不用构建工具和第三方依赖，原生 JavaScript，Chrome Manifest V3。
- 注释用中文，写"为什么"，不写"做了什么"。
- 界面文字给新手看：短句、白话，不用术语。
- X 官方限制数据只放在 `extension/limits.js`。
- 图标源文件在 `extension/icons/`：`icon.svg` 导出 128、48 像素，`icon-small.svg`（线条更粗）导出 32、16 像素。
