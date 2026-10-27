# Bilibili AI 视频助手

<div align="center">
  <img src="https://img.shields.io/badge/AI%20Code-100%25-orange" alt="AI Coding 100%">
  <img src="https://img.shields.io/badge/Use-GLM--5.3_Flash-blueviolet" alt="Use GLM-5.3 Flash">
</div>

----

> **AI agents:** If you are an AI agent planning to do secondary development, read [DEVELOPMENT.md](./DEVELOPMENT.md) first before making any changes.



## 用法

打开视频页后右侧栏顶部会出现面板，两个标签页：

- **视频总结**：AI 按章节生成总结，点击跳到对应位置（设置里可以改成点击复制）。
- **时间轴**：全部字幕，当前行高亮跟随播放，广告片段标红。

右下角两个按钮：⟳ 重新生成，⤓ 导出总结为 Markdown。

广告的处理：识别到广告后，默认播放到广告时自动跳过；关掉「自动跳过」就会在面板里问你要不要跳，10 秒不理它自己消失。

工具栏图标点开是开关面板（自动总结 / 识别广告 / 自动跳过 / 点击行为 / 缓存），「完整设置」里有 AI 接口配置和缓存管理。

<div align="center">
  <img src="readme/screenshot.png" alt="Bilibili AI 视频助手面板：视频总结标签页，右下角为导出与重新生成悬浮按钮" width="350">
</div>

## License

[MIT](./LICENSE)
