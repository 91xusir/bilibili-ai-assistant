# DEVELOPMENT — 面向 AI 智能体的二次开发说明

> 本文档写给在本仓库工作的 AI 智能体（和人类协作者）。目标是让任何一次修改都能对齐既有架构、存储键与坑位清单，避免重新踩坑。

## 0. 命令

```bash
bun install          # 安装依赖 (零运行时依赖, 仅 @types/bun + typescript)
bun run build        # 构建产物 → dist/ (content.js / service-worker.js / popup.js / options.js / manifest.json / popup.html / options.html / pages.css)
bun run typecheck    # tsc --noEmit (严格模式, noUncheckedIndexedAccess)
bun test             # bun 单元测试, 用例在 tests/ (只测纯逻辑, 不测 chrome API)
```

修改后至少跑 `typecheck + test + build`。真实页面验证用 chrome-devtools MCP：重载扩展（reload_extension）→ 刷新 B 站视频页 → 检查面板/弹窗/选项页，**不要用代码 mock 浏览器行为**。

## 1. 架构总览（MV3, 三类上下文）

```
bilibili.com 视频页                       Service Worker (后台)               扩展页面
┌─────────────────────────┐   Port「bia-ai」  ┌──────────────────────┐   ┌──────────────────┐
│ content.js (纯前端 UI)   │ ←───────────────→ │ fetch 代理 + 流式 pump │   │ popup.html/js    │
│  panel/summary/timeline  │   Port「bia-kimi」 │ kimi 网页版客户端      │←─→│ options.html/js  │
│  设置经 storageHydrate   │   sendMessage      │ 字幕 IndexedDB 缓存   │   │ (同源直读 IDB)   │
└─────────────────────────┘   「bia-cache」    └──────────────────────┘   └──────────────────┘
```

- **内容脚本零网络请求**：B 站 API、字幕 CDN、AI 请求全部经 SW（`core/net.ts` 的 `platformRequest` 走 Port「bia-ai」）。SW 用原生 `fetch` + `ReadableStream`（`background/pump.ts`）把累积文本经 `progress` 消息回传，实现真流式。
- **Kimi 网页版**（`background/kimi-client.ts`）：localStorage `refresh_token` → `/api/auth/token/refresh` → access_token；apiv2 创建/删除会话（BatchDeleteChats, 50/批）；流式 SSE 事件 `cmpl/content/error/all_done`。直连失败回退页面内执行（临时标签页读 shield token；常驻标签页复用, tab id 存 `chrome.storage.session`）。
- **任务完成自动清理 kimi 会话**：`trackKimiChatId` 记录 → `drainKimiChatIds` 取走 → `deleteKimiChats`。会话 id 列表也持久化到 `chrome.storage.session`。

## 2. 模块地图

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 编排器：页面生命周期、任务调度 `runAiTasks(mode: auto/refresh/ads-only)`、缓存读写、广告处理（自动跳过 / 确认横幅）、剪贴板、storage.onChanged 同步 |
| `src/config/settings.ts` | 设置读写（chrome.storage.local 同步水合层）、`resolveTaskPlan`（功能开关 → 任务计划, 纯函数）、`aiCacheKey`、TTL、旧键清理 |
| `src/types.ts` | 全部类型（SubtitleDoc/SummaryResult/AdSegment/AiSettings/FeatureSettings/TaskPlan…） |
| `src/api/bilibili.ts` | view → player/wbi/v2 → 字幕 CDN 三段取数 + 字幕清洗；`getVideoId`/`videoKey`（缓存键） |
| `src/api/ai.ts` | OpenAI 兼容客户端：requestOnce / requestStream（SSE 增量解析）/ fetchModelList / testAiConnection / 思考等级参数适配（bigmodel/qwen/openrouter/其余 reasoning_effort） |
| `src/api/streamJson.ts` | 流式增量 JSON 提取（`extractArrayItemsSoFar` 平衡括号 + 字符串感知；`extractStringField`） |
| `src/ai/combined.ts` | 合并请求（总结+广告一次完成）。**ads 提示词必须最前** → 流式最先返回广告；`extractCombinedSoFar` 按 ads→sections→overview 顺序提取 |
| `src/ai/summary.ts` | 单独总结：短视频单次流式；长视频 `chunkTranscript` 分块 map-reduce |
| `src/ai/adDetect.ts` / `src/ai/adHit.ts` | 单独广告识别（分块并行）；`findAdHit(ads, time)` 命中判定（自动跳过与横幅共用, 纯函数） |
| `src/ai/prompt.ts` | 全部提示词构建 |
| `src/subtitle/index.ts` | formatTime / findCurrentIndex（二分）/ snapTime（AI 时间吸附到字幕行 ±90s） |
| `src/ui/panel.ts` | 面板壳：两标签（视频总结/时间轴）、头部 ⊙ 跟随 + ⊘ 自动跳过、状态栏、FAB 组（⟳ 重新生成 + ⤓ 导出菜单）、广告确认横幅、主题/宽度自适应 observer |
| `src/ui/summaryView.ts` / `timelineView.ts` | 两个视图渲染（每次全量重绘, 时间轴返回 update 句柄做高亮）；点击行为由 `clickAction` 决定, **时间徽章始终 seek** |
| `src/ui/exporters.ts` / `src/core/download.ts` | 总结 → Markdown 导出 |
| `src/ui/widgets.ts` | Popup/Options 共用开关行、分段选择 |
| `src/ui/style.ts` | 面板全部 CSS（`--bia-*` 变量, `data-theme="light|dark"`, 宽度 `--bia-panel-width`） |
| `src/core/storage.ts` | chrome.storage.local 同步水合缓存（storageHydrate 全量读 → 内存 Map + 写穿）、`watchStorageChanges`（onChanged → 更新内存）、storageKeys |
| `src/core/cache-port.ts` | 内容脚本 ↔ SW 字幕缓存消息（get/put/delete） |
| `src/core/net.ts` / `kimi-port.ts` | Port 客户端（20s ping 保活, abort 句柄） |
| `src/core/video.ts` | `<video>` 绑定, 3s 轮询重绑（B 站播放器会重建） |
| `src/core/route.ts` | SPA 路由（Navigation API 优先, 劫持 history 降级） |
| `src/background/service-worker.ts` | Port 路由（bia-ai/bia-kimi）、一次性消息（kimi-auth / bia-cache）、启动时惰性清理过期字幕缓存 |
| `src/background/subtitle-db.ts` | **SW 侧** IndexedDB（库 `bia-cache` / store `subtitles`）：get/put/delete/deleteAll/list(游标)/deleteExpired |
| `src/entries/popup.ts` / `options.ts` | 弹窗（仅开关）与选项页（完整设置 + 缓存管理）；复用 `config/settings.ts` + `ui/widgets.ts` |
| `extension/` | manifest.json 模板（`{{VERSION}}`）、popup.html / options.html / pages.css |
| `build.ts` | bun build（iife, minify, 4 个入口）+ 拷贝 html/css + 版本号注入 |
| `tests/` | 7 个测试文件：streamJson / prompt / combined / subtitle / settings / adHit / exporters |

## 3. 存储键清单（改键名前必读）

**chrome.storage.local**（内容脚本经同步水合层读写；popup/options 直写后靠 onChanged 同步）：

| 键 | 内容 |
| --- | --- |
| `bia:ai-settings` | AiSettings：provider(kimi/openai)/baseUrl/apiKey/model/reasoningEffort/cacheEnabled/cacheTtlHours |
| `bia:feature-settings` | FeatureSettings：autoSummary/detectAds/autoSkipAds(默认全 true)/clickAction("jump"\|"copy") |
| `bia:ai-cache:{videoKey}` | AiCacheEntry `{summary: SummaryResult\|null, ads: AdSegment[]\|null, savedAt}`。**ads: null=从未识别过；[]=识别过无广告**（写缓存只覆盖本次生成的部分） |
| `bia:kimi-refresh-token` / `bia:kimi-access-token` | kimi 登录凭据 |

**chrome.storage.session**（SW 回收后仍保留, 浏览器关闭清空）：`bia:kimi-tab-id`（常驻 kimi 标签页）、`bia:kimi-pending-chat-ids`（待删会话）。**SW 里任何跨事件的内存状态都必须落到 session**, 内存变量只作镜像。

**IndexedDB（SW 扩展源）**：库 `bia-cache` / store `subtitles`, key = `videoKey`（如 `BV1xxx?p=2`）, value = `{doc: SubtitleDoc, savedAt}`。**不要把字幕缓存放进内容脚本**——内容脚本的 IDB 属于 bilibili 页面源, 选项页读不到（缓存管理就废了）。

`videoKey = videoKey(getVideoId())` = `"BVxxx?p=N"`（av 号视频为 `avN?p=N`）。字幕缓存与 AI 结果缓存用同一个键。

## 4. 任务调度（main.ts）

```
resolveTaskPlan({autoSummary, detectAds, autoSkipAds}):
  ads 生效 = detectAds || autoSkipAds        # 自动跳过依赖识别结果, 强制开启
  mode = summary&&ads ? "combined" : summary ? "summary" : ads ? "ads" : "none"
```

- **auto**（进入视频）：读两层缓存 → 命中即应用（`applyResult`）→ 缺什么补什么：`needSummary = plan.summary && !cached.summary`；`needAds = plan.ads && cached.ads === null`。
- **refresh**（⟳）：总结必跑（手动覆盖 autoSummary），广告按 plan 附带；两者都需 → `generateCombined` 单请求（Kimi 单会话），**失败自动降级**为 ads-first 分请求（长字幕各自分块）。
- **ads-only**（时间轴「识别广告」按钮）：只跑 `detectAds`。
- 生成中：`startGenerating` 置任务 loading → 状态栏出现、⟳ FAB 禁用+旋转、时间轴按钮禁用；结束/失败恢复。过期缓存读时惰性删除；写缓存只覆盖跑过的任务。

## 5. 交互约定

- **点击行为**：`clickAction = "jump" | "copy"`。时间徽章（`.bia-time-badge` / `.bia-tl-time`）点击 **必然 seek**（stopPropagation）；文本点击按设置跳转或复制（总结=点击章节的 content, 时间轴=点击行 content）。复制走 `navigator.clipboard.writeText` + toast。
- **广告确认横幅**（`.bia-ad-banner`）：仅 autoSkipAds 关闭且广告已识别时出现。同一广告段只弹一次；3s 超时关闭后**同段不再弹出**（`dismissedAdFrom`, 否则 timeupdate 会让它每帧复活）；离开广告段（`findAdHit` 返回 null）时 `hideAdConfirm()` 重置。
- **导出菜单**：Popover API + invoker commands（`commandfor`/`command="toggle-popover"`）。**目标元素必须设 `id`**（commandfor 按 id 关联）, 菜单紧跟触发器之后; 内层容器 `focusgroup="menu nomemory"`; CSS 用隐式锚点 `position-area: block-start span-inline-end`（FAB 在右下角, 菜单向上开）。不支持时降级为脚本 `showPopover()`。
- **UI 统一**：右下角 `.bia-fab-stack`（列向 FAB 组）, 生成中 `bia-above-bar` 上浮避开状态栏。

## 6. B 站适配坑位（改 DOM/主题相关代码前必读）

1. `.right-container` 设了 `pointer-events: none` → 面板根必须显式 `pointer-events: auto`, 否则整体点击穿透。
2. **深色模式标记在 `<html class="night-mode">`**, 不在 body。主题 observer 挂 `document.documentElement`, 写 `panel.dataset.theme`。
3. 挂载点：`.right-container-inner.scroll-sticky` 内、`.video-pod-above-modules`（弹幕列表）之前；B 站 SPA 可能重建右栏 → `handlePage` 同 key 时检测 `panel.isMounted` 补挂载。
4. 播放器 `<video>` 会被重建 → `VideoBinder` 3s 轮询重绑。
5. 用户可能装 Bilibili Evolved（History API 拦截/参数清理）→ 路由事件比预期多, `handlePage` 必须幂等（同 key 早退）。
6. 面板宽度跟随 `.video-pod-above-modules`（ResizeObserver → `--bia-panel-width`）。

## 7. 扩展开发注意（chrome-extensions 指南要点）

- SW 空闲 ~30s 被回收：跨事件状态用 `chrome.storage.session`；长任务期间 Port 客户端 20s ping 保活。**不要在 SW 内存里存唯一状态**。
- 扩展页面（popup/options）禁内联 `<script>`/`eval`；脚本用 `<script src defer>`；`chrome.runtime.onMessage` 异步响应必须 `return true`。
- Popup 出现后 `chrome.action.onClicked` 不再触发（manifest 已配 `default_popup`）, 不要再注册 onClicked。
- 选项页用 `options_ui.open_in_tab: true`；弹窗用 `chrome.runtime.openOptionsPage()` 跳转。
- API Key 输入框不用 `type=password`（防浏览器保存密码弹窗）, 用 text + `-webkit-text-security`。
- `manifest.json` 的 `host_permissions: https://*/*` 是必须的（用户可配任意 OpenAI 兼容 Base URL + kimi.com + B 站）。

## 8. 测试约定

- `bun test` 只测**纯逻辑**（解析器、提示词、调度纯函数、命中判定、Markdown 构建），chrome API 用内存 mock（见 `tests/settings.test.ts`）。
- 涉及 UI/网络/kimi 的验证一律走 chrome-devtools MCP 真机测试：重载扩展 → 刷新 `https://www.bilibili.com/video/*` 页 → 评估脚本检查 DOM/行为；SW 侧看 `serviceWorkerId` 的 console（`[bia][sw]` 前缀）。
- 内容脚本日志前缀 `[bia]`，SW 日志前缀 `[bia][sw]`，都有中文语义化输出。

## 9. 已知限制

- 合并请求对超长字幕不分块（Kimi 上下文足够；失败会降级为分块的分任务路径）。
- kimi 网页版依赖登录态，token 过期由 `ensureKimiAccessToken` 自动刷新（直连失败回退页面内读取）。
- 字幕缓存按 `videoKey` 含分 P；同一视频切 P 各自缓存。
- 广告识别靠字幕文本，无字幕视频无法工作（面板会提示「没有可用的 CC 字幕」）。
