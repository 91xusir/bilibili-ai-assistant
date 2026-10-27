# Bilibili AI 视频助手 (MV3 扩展)

Chrome/Edge 扩展,在 B 站视频页右侧栏插入暗色面板,用 AI 分析字幕:视频总结、思维导图、时间轴、广告识别。默认接入 **Kimi 网页版**(免 Key,复用 kimi.com 登录态),也可切任意 **OpenAI 兼容接口**。AI 请求经后台 Service Worker 流式转发,内容边生成边渲染。

**二次开发请看 [DEVELOPMENT.md](DEVELOPMENT.md)**(架构、模块地图、数据流、扩展指南、避坑清单)。

## 功能

| 标签页 | 功能 |
| --- | --- |
| 视频总结 | AI 分章节总结,时间徽章点击跳转,可导出 Markdown |
| 思维导图 | AI 缩进树导图,可折叠展开,带时间戳的节点点击跳转,可导出 Markdown |
| 时间轴 | 全字幕时间轴,实时高亮 + 自动聚焦滚动,点击跳转,广告片段标红 |
| 设置 | AI 服务商、缓存、AI 任务开关 |

其他:自动跳过广告(⊕/⊘ 可开关)、时间轴聚焦开关(◎)、右下角 ⟳ 重新生成、结果缓存(可设保留时长,0 = 永久,到期自动删除)、AI 任务独立开关。

## 安装

```bash
bun run build
```

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `dist/` 文件夹 → 打开任意 B 站视频页。

## AI 配置

面板顶部「设置」标签页:

- **Kimi 网页版(默认)**:先在浏览器登录 [kimi.com](https://www.kimi.com/),设置页点「重新获取授权」。免 API Key,token 过期自动刷新
- **OpenAI 兼容接口**:填接口地址 + Key + 模型名(可点「获取列表」拉取上游 `/models`);思考等级走标准 `reasoning_effort`,不设置则按服务商发送禁用参数关闭思考

## 命令

```bash
bun run dev         # watch 构建
bun run build       # 构建到 dist/
bun run typecheck   # 类型检查
bun run test        # vitest 单测
```

## License

GPL-3(参照 [Yiero 的《Bilibili 视频时间轴》](https://greasyfork.org/zh-CN/scripts/522993) 重构,原脚本为 GPL-3)
