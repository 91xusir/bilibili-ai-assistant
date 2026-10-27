# Bilibili AI 视频助手

![AI Code](https://img.shields.io/badge/AI%20Code-100%25-orange) ![Human Code](https://img.shields.io/badge/Human%20Code-0%25-blue)

For AI-agent secondary development, see [DEVELOPMENT.md](./DEVELOPMENT.md).

B 站视频页的 AI 助手扩展（Chrome MV3）。用视频字幕生成章节总结和可点击的时间轴，顺带识别广告片段。默认用 kimi.com 网页版的登录态，不需要 API Key，也可以换成任意 OpenAI 兼容接口。

## 安装

需要 [Bun](https://bun.sh)：

```bash
bun install
bun run build
```

Chrome 打开 `chrome://extensions`，开启开发者模式，「加载已解压的扩展程序」选 `dist` 目录。

## 用法

打开视频页后右侧栏顶部会出现面板，两个标签页：

- **视频总结**：AI 按章节生成总结，点击跳到对应位置（设置里可以改成点击复制）。
- **时间轴**：全部字幕，当前行高亮跟随播放，广告片段标红。

右下角两个按钮：⟳ 重新生成，⤓ 导出总结为 Markdown。

广告的处理：识别到广告后，默认播放到广告时自动跳过；关掉「自动跳过」就会在面板里问你要不要跳，3 秒不理它自己消失。总结和广告识别合并成一个请求发出，两个都能单独关掉，关掉后用 ⟳ 手动生成。

工具栏图标点开是开关面板（自动总结 / 识别广告 / 自动跳过 / 点击行为 / 缓存），「完整设置」里有 AI 接口配置和缓存管理。

## AI 接口

默认走 kimi.com 网页版：浏览器登录过 kimi 就能用，每次任务建一个临时会话，用完自动删，不污染聊天列表。也可以在设置里换成 OpenAI 兼容接口（Base URL / Key / 模型名，支持拉取模型列表和思考等级）。

字幕和 AI 结果按视频缓存，保留时长可调，也能在设置里按视频清理。

## 开发

```bash
bun run typecheck
bun test
```

架构和二次开发说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## License

[MIT](./LICENSE)
