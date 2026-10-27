# DEVELOPMENT.md

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
```

After changes, run `typecheck`, `test`, and `build`.

For browser validation, use Chrome DevTools MCP:
1. Reload the extension.
2. Refresh a Bilibili video page.
3. Verify the panel, popup, and options page.

Do not mock browser behavior for integration tests.

## Architecture (Manifest V3)

- `content.js`: UI only; no network requests.
- Service worker: network proxy, streaming, Kimi client, subtitle IndexedDB.
- `popup` / `options`: extension pages; access shared IndexedDB directly.
- `bia-ai` Port: AI/platform requests.
- `bia-kimi` Port: Kimi requests.
- `bia-cache` messages: subtitle cache operations.
- Network requests go through `core/net.ts` → service worker.
- Streaming uses native `fetch` + `ReadableStream` in `background/pump.ts`.

### Kimi Client

`background/kimi-client.ts`:
- Refresh `refresh_token` via `/api/auth/token/refresh`.
- Use access token for API requests.
- Create/delete chats through API v2; delete in batches of 50.
- Parse SSE events: `cmpl`, `content`, `error`, `all_done`.
- On direct-request failure, fall back to page-context execution.
- Reuse a persistent Kimi tab; store its ID in `chrome.storage.session`.

Chat cleanup:
`trackKimiChatId` → `drainKimiChatIds` → `deleteKimiChats`.

Persist pending chat IDs in `chrome.storage.session`.

## Module Map

| Path | Responsibility |
|---|---|
| `src/main.ts` | Lifecycle, task scheduling, cache, ads, clipboard, storage sync |
| `src/config/settings.ts` | Settings, task planning, cache keys, TTL, legacy-key cleanup |
| `src/types.ts` | Shared types |
| `src/api/bilibili.ts` | Video metadata, WBI/player APIs, subtitle fetching and cleaning |
| `src/api/ai.ts` | OpenAI-compatible requests, SSE, model list, connection test, reasoning parameters |
| `src/api/streamJson.ts` | Incremental JSON extraction |
| `src/ai/combined.ts` | Combined summary + ad request |
| `src/ai/summary.ts` | Summary generation; chunked map-reduce for long videos |
| `src/ai/adDetect.ts` | Chunked parallel ad detection |
| `src/ai/adHit.ts` | Ad matching via `findAdHit(ads, time)` |
| `src/ai/prompt.ts` | Prompt construction |
| `src/subtitle/index.ts` | Time formatting, binary search, time snapping |
| `src/ui/panel.ts` | Panel shell, controls, status, export menu, theme and width observers |
| `src/ui/summaryView.ts` | Summary rendering |
| `src/ui/timelineView.ts` | Timeline rendering and highlighting |
| `src/ui/exporters.ts` | Markdown export |
| `src/ui/widgets.ts` | Shared popup/options controls |
| `src/ui/style.ts` | Panel CSS and theme variables |
| `src/core/storage.ts` | Storage hydration, in-memory cache, change synchronization |
| `src/core/cache-port.ts` | Content-script ↔ service-worker subtitle cache messages |
| `src/core/net.ts` | Network Port client, keepalive, abort handles |
| `src/core/kimi-port.ts` | Kimi Port client |
| `src/core/video.ts` | Video element binding; 3-second rebind polling |
| `src/core/route.ts` | SPA navigation detection |
| `src/background/service-worker.ts` | Port routing, messages, expired-cache cleanup |
| `src/background/subtitle-db.ts` | Service-worker IndexedDB |
| `src/entries/popup.ts` | Popup entry |
| `src/entries/options.ts` | Options page entry |
| `extension/` | Manifest and HTML/CSS templates |
| `build.ts` | Bun build, asset copying, version injection |
| `tests/` | Unit tests for pure logic |

## Storage Contracts

### `chrome.storage.local`

- `bia:ai-settings`: `AiSettings` — provider, base URL, API key, model, reasoning effort, cache settings.
- `bia:feature-settings`: `FeatureSettings` — summary, ad detection, auto-skip, click action.
- `bia:ai-cache:{videoKey}`: `{ summary, ads, savedAt }`.
  - `ads: null`: never detected.
  - `ads: []`: detection completed; no ads found.
  - Partial updates must preserve unrelated cached results.
- `bia:kimi-refresh-token`
- `bia:kimi-access-token`

Content scripts use the storage hydration layer. Popup/options write directly and rely on `storage.onChanged` synchronization.

### `chrome.storage.session`

- `bia:kimi-tab-id`
- `bia:kimi-pending-chat-ids`

Persist all service-worker state required across events. In-memory variables are mirrors, not the sole source of truth.

### IndexedDB

- Database: `bia-cache`
- Store: `subtitles`
- Key: `videoKey`
- Value: `{ doc: SubtitleDoc, savedAt }`

IndexedDB must be accessed from the service worker so options-page cache management can access the same database. Never store subtitle cache in the content script's page-origin IndexedDB.

`videoKey` includes the video ID and page number, e.g. `BV1xxx?p=2` or `av123?p=2`. Subtitle and AI caches share this key.

## Task Scheduling

`resolveTaskPlan({ autoSummary, detectAds, autoSkipAds })`:

- Effective ad detection: `detectAds || autoSkipAds`.
- Mode: `combined`, `summary`, `ads`, or `none`.

### `auto`

1. Read both cache layers.
2. Apply cached results.
3. Generate missing enabled results.
4. Treat `ads === null` as missing; `ads === []` as completed.

### `refresh`

- Always regenerate summary, regardless of `autoSummary`.
- Include ads according to the task plan.
- If both are needed, use `generateCombined`.
- On combined-request failure, fall back to separate ads-first requests.

### `ads-only`

Run ad detection only.

During generation, disable relevant controls and show loading state. Restore controls on completion or failure. Delete expired cache entries lazily. Cache writes must preserve results for tasks that did not run.

## Interaction Contracts

- `clickAction`: `jump` or `copy`.
- Time badges always seek; stop event propagation.
- Text clicks follow `clickAction`.
- Copy uses `navigator.clipboard.writeText` and a toast.
- Ad confirmation banner appears only when auto-skip is disabled and ads are detected.
- Dismissed ads must not reappear during the same segment.
- Reset dismissal after leaving the segment.
- Export menu uses the Popover API with a script fallback.
- Elements referenced by `commandfor` must have IDs.
- FAB controls are stacked at the bottom-right; loading state must avoid the status bar.

## Bilibili Compatibility

1. `.right-container` uses `pointer-events: none`. Set `pointer-events: auto` on the panel root.
2. Dark mode is marked by `html.night-mode`, not `body`. Observe `document.documentElement`.
3. Mount inside `.right-container-inner.scroll-sticky`, before `.video-pod-above-modules`.
4. Bilibili SPA may rebuild the right sidebar. Ensure `handlePage` restores the panel for the same video key.
5. Video elements may be replaced. `VideoBinder` polls every 3 seconds.
6. Other extensions may intercept History API events. `handlePage` must be idempotent.
7. Track panel width using `ResizeObserver` and `--bia-panel-width`.

## Extension Constraints

- Service workers may be suspended after inactivity. Persist cross-event state in `chrome.storage.session`.
- Keep Port clients alive with 20-second pings during long tasks.
- No inline scripts or `eval` in extension pages.
- Async `chrome.runtime.onMessage` listeners must return `true` when using asynchronous `sendResponse`.
- Do not register `chrome.action.onClicked` when `default_popup` is configured.
- Open options with `chrome.runtime.openOptionsPage()`.
- Use `options_ui.open_in_tab: true`.
- API key inputs: `type="text"` with `-webkit-text-security`; avoid password-manager prompts.
- Keep `host_permissions: ["https://*/*"]` for configurable OpenAI-compatible endpoints, Kimi, and Bilibili.

## Testing

```bash
bun run typecheck
bun test
bun run build
```

- Unit tests cover pure logic only.
- Chrome API mocks are permitted for unit tests.
- Validate UI, network, and Kimi behavior in a real browser through Chrome DevTools MCP.
- Inspect service-worker logs using the `[bia][sw]` prefix.
- Content-script logs use `[bia]`.

## Known Limitations

- Combined requests do not chunk oversized transcripts; failure falls back to separate chunked tasks.
- Kimi web client requires a logged-in session and refreshes expired access tokens.
- Cache entries are per video page.
- Ad detection depends on subtitle text; videos without CC subtitles cannot be analyzed.
