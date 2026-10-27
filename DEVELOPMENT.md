# 二次开发指南

面向需要扩展、改造本项目功能的开发者。目标读者:熟悉 TypeScript + 浏览器扩展,了解油猴/内容脚本模型。

## 1. 快速上手

```bash
bun install        # 安装依赖(仅 dev 依赖: typescript / vitest)
bun run typecheck  # 类型检查
bun run test       # 跑单测
bun run build      # 构建到 dist/
bun run dev        # watch 模式, 改代码自动重建
```

产物:`dist/` = `content.js` + `service-worker.js` + `manifest.json`。开发时在 `chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」选 `dist/`,**改代码后点扩展卡片上的 ↻ 即可热更新**(B站视频页需刷新)。

## 2. 架构总览

```
┌─ dist/manifest.json ───────────────────────────────────────┐
│ content_scripts: https://www.bilibili.com/video/* → content.js
│ background: service_worker.js                              │
│ host_permissions: https://*/*   permissions: storage,scripting,tabs
└────────────────────────────────────────────────────────────┘

[内容脚本 content.js]                       [后台 service-worker.js]
  UI 面板 / 字幕获取 / 视频绑定 / AI 编排        流式代理 + Kimi 客户端
        │  chrome.runtime.connect(name)              │
        ├─ "bia-ai"  ──OpenAI兼容 HTTP 代理──────►  fetch + ReadableStream
        ├─ "bia-kimi" ─ Kimi 对话─────────────────►  kimi.com (免 Key)
        └─ runtime.onMessage("kimi-auth") ─────────►  token 引导/刷新
```

**两条网络通道**

| 通道 | 用途 | 流式方式 |
| --- | --- | --- |
| `bia-ai` Port | 任意 OpenAI 兼容接口 | 后台 `fetch` + `ReadableStream`,每块回传累积文本 |
| `bia-kimi` Port | kimi.com 网页版 | 后台直连 SSE(20s 无数据看门狗);401/网络类失败才回退到 kimi.com 页面内执行(ISOLATED world,同源 Cookie + `chrome.runtime`) |
| `bia-ai` 端口(含 credentials) | B站字幕链路 (view / player / 字幕 CDN) | 后台带 Cookie 请求, 内容脚本零 fetch |

**Kimi 可靠性要点**(`background/kimi-client.ts`)

- **标签页只有两种**:授权引导走 `readLocalStorageOnce`(打开 → 读完 → `tabs.remove` 关闭,不留垃圾页);页面内流式回退走 `ensureKimiTab`(最多 1 个常驻页,并发去重 + 用户关闭后重建)。任何路径都不允许重复开页
- **直连必须设读超时**:kimi 网页接口可能拒绝后台直连且**不回响应体**,旧实现会让请求永久挂起 → 内容脚本 20s 心跳与计时器堆积 → SW 反复重启 → 表现为不断打开新 kimi 标签页、无流式。现 `streamKimiChat` 每次尝试带 20s 无数据看门狗
- **parser 每次尝试独立**:失败重试若复用 parser,前一次的 `cursor/acc/done` 会污染本次,导致第二次结果「一次性出现」而非流式
- **回退策略**:模型业务错误(`KimiError`)与非 401 的 4xx 直接抛出,不做无谓重试;仅网络类错误进入页面回退,退避重试(0s/1s/3s)复用同一常驻页
- **会话自动清理**:`streamKimiChat` 记录本次创建的 chatId,生成完成后经 apiv2 `BatchDeleteChats`(带盾头 `_fmOpt.getinfo()`,从一次性临时页读取)批量删除,避免污染 kimi 聊天列表
- **UI 自适应**:面板宽度跟随 `.video-pod-above-modules`(ResizeObserver);主题跟随 `body.theme-dark`(存在即深色,否则浅色,MutationObserver 监听);头部有弹幕列表同款折叠头(收起仅留一行)

**两条数据链**

1. 字幕数据:B站 `view` API 取 cid → `player/wbi/v2` 取字幕轨 → fetch 字幕 JSON
2. AI 输出:SSE 分片 → 累积纯文本 → **增量 JSON 提取**(`streamJson.ts` 只取已闭合对象)→ 节流渲染 → 完成后整体解析 + 时间吸附(`snapTime`)

## 3. 模块地图

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| `entries/` | `content.ts` | 入口,仅 `import { main }` |
| `background/` | `service-worker.ts` | Port 路由、流式代理、`kimi-auth` 消息、工具栏图标 |
| | `pump.ts` | `ReadableStream` 逐块读取 + `TextDecoder` 流式解码 |
| | `kimi-client.ts` | Kimi:token 生命周期 / 会话创建 / SSE 解析器 / 页面回退 |
| `core/` | `storage.ts` | `chrome.storage.local` 同步缓存(水合 + 写穿) |
| | `net.ts` | `platformRequest`:后台流式 Port 客户端(含 20s 保活 ping) |
| | `kimi-port.ts` | 内容侧 Kimi 客户端 + `kimiAuthBootstrap` |
| | `dom.ts` | `waitForElement` |
| | `route.ts` | SPA 路由变化(Navigation API + history 劫持降级) |
| | `video.ts` | `<video>` 绑定 / seek / 3s 重绑轮询 |
| | `download.ts` | Blob 下载 + 文件名安全化 |
| `config/` | `settings.ts` | AI 设置 / 任务开关 / 缓存开关 / `isCacheExpired` |
| `api/` | `bilibili.ts` | 字幕数据链 + `getVideoId` |
| | `ai.ts` | `chatJson` / `chatJsonStream` / 重试 / `abortAllAiRequests` |
| | `streamJson.ts` | 流式增量 JSON 提取(括号配对 + 字符串感知) |
| `ai/` | `prompt.ts` | 提示词 + `chunkTranscript` + `sectionsToTranscript` |
| | `summary.ts` | 总结(单段流式 / 超长 map-reduce) |
| | `mindmap.ts` | 思维导图(流式节点) |
| | `adDetect.ts` | 广告片段识别 (分任务/降级路径) |
| | `combined.ts` | 单次汇总: 一个请求产出总结+导图+广告 (scope 裁剪 / 流式部分渲染 / 校验降级) |
| `ui/` | `panel.ts` | 面板容器/四标签页/设置表单(约 900 行,本项目最大文件) |
| | `summaryView.ts` `mindmapView.ts` `timelineView.ts` | 三个内容视图 + 导出按钮 |
| | `exporters.ts` | 内容 → Markdown |
| | `common.ts` `toast.ts` `style.ts` | 通用渲染原子 / 提示 / CSS |
| `subtitle/` | `index.ts` | 时间格式化 / 二分定位 / 时间吸附 |
| `main.ts` | | 生命周期编排:路由 → 面板 → 字幕 → AI 任务/缓存 |

## 4. 数据流与生命周期

### 页面进入

```
handlePage()                     ← 路由变化或首次加载
  ├─ getVideoId()                ← 从 URL 取 BV/av + 分P
  ├─ 比对 currentPageKey, 未变化 → 只重挂面板
  ├─ abortAllAiRequests()        ← 中止上一页残留请求
  ├─ ensurePanelMounted()        ← 等待 .right-container, 插入弹幕列表上方
  ├─ panel.setSubtitleLoading()
  ├─ getSubtitleDoc(videoId)     ← view → player → 字幕 JSON
  ├─ 有字幕 → panel.setDoc(doc)
  └─ runAiTasks(token, doc, force=false)
```

### AI 任务编排(`main.ts: runAiTasks`)

```
1. 读缓存: storageGet(aiCacheKey(bvid, cid, model))
   ├─ 过期(isCacheExpired) → storageDelete + 继续
   └─ 命中 → panel.applyResult(cached, toggles) → return
2. 未配置/已关闭的任务 → panel.setTasksIdle / setTasksLoading(toggles)
3. 单次汇总 (combinedTasks=true, 默认): generateCombined(scope, onPartial)
   ├─ 一次请求产出 sections/overview/children/ads
   ├─ panel.setSummaryPartial / setMindmapPartial / setAds 随流渐进
   └─ 失败 → 降级 runSeparateTasks (同下 4~6), 保证用户仍能拿到结果
4. 分任务模式 (combinedTasks=false, 或降级): 并行 detectAds() → panel.setAds
5. 分任务模式: 顺序 generateSummary → generateMindmap → 各自 setTaskError 只影响单任务
6. 汇总: 至少一项成功 → storageSet(cacheKey, {..., savedAt: Date.now()})
```

**会话数对比 (Kimi)**:单次汇总 = 每视频 1 个会话;分任务 = 3~5 个 (广告分块会额外建会话)。设置页「AI 任务」区的「单次汇总」开关可切换。

**Token 防串**:每次 `handlePage` 生成 `++runToken`;异步回调里 `if (token !== runToken) return;` 丢弃过期结果。

### 视频同步与跳转

```
<video> timeupdate → VideoBinder → panel.setCurrentTime(t)
                                   ├─ timelineHandle.update(t)  ← 二分查找高亮当前行
                                   └─ followEnabled → scrollToCurrentRow()
用户滚动时间轴 → onBodyScroll() → setFollowState(false)   ← 250ms 抑制窗口防误判
点击行/章节/导图节点 → onSeek → video.currentTime = t
播放进入广告段 → seek 到段尾 + toast
```

### 面板渲染

`panel.renderActive()` 按 `activeTab` 只重绘当前视图;**「设置」视图只构建一次**(表单状态靠 DOM 持久化);`throttledRender`(400ms)用于 AI 流式部分结果,避免逐 token 重绘。任务状态机:`idle → loading → done | error | disabled`。

## 5. 如何添加一个 AI 服务商

以「DeepSeek 官方 API」为例(它本身兼容 OpenAI 格式,只需在配置里填地址即可;以下展示若需全新协议时的完整步骤):

**步骤 1 — 类型**(`types.ts`)
```ts
export type AiProvider = "kimi" | "openai" | "deepseek";
```

**步骤 2 — 请求实现**(`api/ai.ts`)
- 若协议为 OpenAI 兼容:无需新代码,用户填 `https://api.deepseek.com/v1` 即可
- 若协议不同:参照 `kimiChatStream` 的形状实现 `providerChatStream(messages, onPartialText): Promise<{plain, raw}>`,后台新开一个 Port 或扩展 `registerKimiChat` 分支

**步骤 3 — 路由**(`api/ai.ts`)
```ts
function isKimiProvider() { return getAiSettings().provider === "kimi"; }
// 在 chatJson / chatJsonStream / testAiConnection 三个入口分支
if (getAiSettings().provider === "deepseek") { ... return extractJson(plain); }
```

**步骤 4 — 后台**(`background/service-worker.ts`)
在 `chrome.runtime.onConnect` 中增加端口分支,或复用 `bia-ai` 端口并在 SW 里区分 `provider` 字段。

**步骤 5 — 设置 UI**(`ui/panel.ts: buildSettingsView`)
在「AI 服务商」`providerRow` 里加第三个按钮,`renderProvider()` 里处理显隐。

**步骤 6 — 配置项**(若需新字段,如 `apiKey` 外的 `region`)
`types.ts` 的 `AiSettings` + `config/settings.ts` 的 `DEFAULT_AI_SETTINGS` + 设置表单 `makeField` 一行。

> 通用约束:`chatJson`/`chatJsonStream` 必须返回 **JSON**;所有 AI 输出经 `snapTime` 吸附到真实字幕时间,避免模型编造时间导致跳转失效。

## 6. 如何修改提示词

`ai/prompt.ts` 集中管理,注意两个约束:

1. **JSON 键序即输出顺序**:`sections` 必须排在 `overview` 之前——流式渲染靠 `extractArrayItemsSoFar(text, "sections")` 边生成边取,顺序错了首屏会空转
2. **system 角色**:Kimi 不支持 system role,`toKimiMessages` 会把它并入首条 user;OpenAI 侧正常使用

修改 `prompt.ts` 后建议同步更新 `tests/prompt.test.ts` 的分块断言(若涉及分块逻辑)。

## 7. 缓存模型

```ts
// 键: bia:ai-cache:{bvid}:{cid}:{model}
{ summary?, mindmap?, ads?, savedAt }
```

- 开关:`AiSettings.cacheEnabled`(false 时既不读也不写)
- TTL:`AiSettings.cacheTtlHours`(0 = 永久);**惰性删除**:读到过期条目立即 `storageDelete` 并重新生成
- 不同模型缓存互相隔离;任务开关决定哪些任务读/写缓存

改缓存逻辑的入口:`main.ts: runAiTasks` 的读缓存段 + 末尾写缓存段 + `config/settings.ts: isCacheExpired`。

## 8. UI 修改指南

- **颜色/圆角/尺寸**:`ui/style.ts` 顶部的 `.bia-panel` CSS 变量(`--bia-bg` 等),面板固定 411×380
- **新增标签页**:`types.ts` 的 `TabId` → `panel.ts` 的 `tabDefs` / `viewRoots` / `renderActive()` 三处各加一项
- **新增设置项**:在 `buildSettingsView` 对应区块加 `makeField` 或 `buildSwitchRow`(即时保存);`saveAiSettings(patch)` 是 **Partial 合并**,只需传变化字段
- **导出格式**:`ui/exporters.ts`;视图里加按钮参照 `summaryView.ts` 的 `export-row` 块

## 9. 关键约束与坑

1. **MV3 Service Worker 生命周期**:长请求靠内容脚本每 20s ping 保活;新增长任务务必走 `platformRequest`(带 ping),不要直接在 SW 里裸 `fetch`
2. **CSP**:内容脚本执行于页面上下文,不加载任何远程脚本;`injectStyle` 用 `<style>` 标签
3. **CORS**:AI 请求必须经后台 SW(有 `host_permissions`),不要在内容脚本里直连外部 API
4. **文本框密码误报**:API Key 输入用 `type="text"` + `-webkit-text-security: disc`,不能用 `type="password"`
5. **label 转发**:包含下拉选项的容器不能用 `<label>`(点击会被转发到关联控件)
6. **时间可信度**:AI 给的秒数一律经 `snapTime` 吸附到字幕行,容差 90s
7. **bilibili 布局**:`.right-container-inner` 被设了 `pointer-events: none`,面板必须显式 `pointer-events: auto`
8. **SPA 导航**:切换视频时 `++runToken` + `abortAllAiRequests()`;面板若被 React 重绘移除,`handlePage` 只重挂载不重新分析
9. **新增持久化数据**:`storageSet`/`storageGet`(`chrome.storage.local`);扩展环境内容脚本读的是内存缓存,启动时 `storageHydrate` 全量水合

## 10. 测试

`tests/` 下 vitest 单测覆盖纯函数:流式提取、SSE 解析、字幕时间、缓存 TTL、提示词分块、导出模板、流式泵解码。

```bash
bun run test
```

无法在单测里覆盖的(需要真实扩展环境):后台 Port 通信、Kimi token 引导、面板 DOM 交互。建议改完后在本机 Chrome 加载 `dist/` 手动验证:进入带 CC 字幕的视频 → 看三个标签页 → ⟳ 重新生成 → 检查 `chrome://extensions` 该扩展的「service worker」控制台 `[bia]` 日志。

## 11. 常见改造清单

| 需求 | 改哪里 |
| --- | --- |
| 改面板宽高 | `ui/style.ts` 的 `.bia-panel` |
| 改标签名称/顺序 | `types.ts: TabId` + `panel.ts: tabDefs` |
| 改总结/导图输出结构 | `ai/prompt.ts` + `ai/summary.ts` `mindmap.ts` 的 normalize 函数 + `streamJson.ts` 的 key |
| 改广告识别策略 | 单次汇总: `ai/combined.ts`; 分任务: `ai/prompt.ts: adMessages` + `ai/adDetect.ts` |
| 改单次汇总输出结构 | `ai/combined.ts` 的 scope/要求/normalize, 注意字段顺序 (children 在 ads 前) |
| 改广告跳过行为 | `main.ts: maybeSkipAd` |
| 改时间轴虚拟化(超长视频) | `ui/timelineView.ts`(当前一次性渲染全部行) |
| 改导出格式(JSON/HTML) | `ui/exporters.ts` |
| 加新页面(如"分镜") | 见 §8 新增标签页 |
| 改默认 AI 服务商 | `config/settings.ts: DEFAULT_AI_SETTINGS` |

## 12. 目录与发布

```
bilibili-ai-assistant/
├── extension/manifest.json   # MV3 manifest 模板({{VERSION}} 由构建注入)
├── src/                      # 源码(见 §3)
├── tests/                    # vitest 单测
├── build.ts                  # Bun 构建: content.js + service-worker.js + manifest.json
├── dist/                     # 构建产物 (git 忽略建议保留目录)
├── package.json
├── vitest.config.ts
└── README.md / DEVELOPMENT.md
```

发版:改 `package.json` 的 `version` → `bun run build` → 分发 `dist/`(zip 后可直接提交 Chrome 应用商店,若需要)。
