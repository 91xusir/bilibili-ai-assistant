/**
 * MV3 后台 Service Worker:
 * - "bia-ai" 端口: 以原生 fetch + ReadableStream 转发 OpenAI 兼容请求 (流式)
 * - "bia-kimi" 端口: Kimi 网页版流式对话 (kimi-client, 免 Key)
 * - "kimi-auth" 一次性消息: 引导获取 kimi 登录凭据
 */

import { pumpResponseBody } from "./pump";
import {
    deleteKimiChats,
    drainKimiChatIds,
    ensureKimiAccessToken,
    getKimiAuthState,
    streamKimiChat,
} from "./kimi-client";

interface AiPortMessage {
    kind: "request" | "abort" | "ping";
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: string;
    timeoutMs?: number;
    /** 请求是否携带浏览器 Cookie (B站字幕等需要登录态) */
    credentials?: "include" | "omit";
}

interface KimiPortMessage {
    kind: "chat" | "abort" | "ping";
    messages?: { role: string; content: string }[];
}

/** 断开后的端口再 postMessage 会抛异常, 统一吞掉 */
function safePost(port: chrome.runtime.Port, message: unknown): void {
    try {
        port.postMessage(message);
    } catch {
        /* 端口已断开 */
    }
}

/** 仅在扩展环境中注册监听 (允许在普通运行时导入 pumpResponseBody 做测试) */
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    console.info("[bia][sw] Service Worker 已启动", chrome.runtime.id);

    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === "bia-ai") {
            registerAiProxy(port);
        } else if (port.name === "bia-kimi") {
            registerKimiChat(port);
        }
    });

    // 工具栏图标点击 → 在当前视频页打开「设置」标签页
    chrome.action.onClicked.addListener((tab) => {
        if (tab.id === undefined) return;
        void chrome.tabs
            .sendMessage(tab.id, { kind: "bia-open-settings" })
            .catch(() => {
                /* 页面尚未注入内容脚本时忽略 */
            });
    });

    // 设置页「重新获取授权」: 引导读取/刷新 kimi 登录凭据
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if ((msg as { kind?: string } | null)?.kind !== "kimi-auth") return;
        console.info("[bia][sw] kimi-auth 请求");
        void (async () => {
            try {
                await ensureKimiAccessToken();
                sendResponse?.({ ok: true, ...getKimiAuthState() });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.error("[bia][sw] kimi-auth 失败:", message);
                sendResponse?.({
                    ok: false,
                    error: message,
                });
            }
        })();
        return true; // 异步 sendResponse
    });
}

function registerAiProxy(port: chrome.runtime.Port): void {
    let controller: AbortController | null = null;
    let abortedByTimeout = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    port.onMessage.addListener((raw: AiPortMessage) => {
        if (raw.kind === "ping") return; // 保活消息到达本身即重置 SW 生命周期
        if (raw.kind === "abort") {
            controller?.abort();
            return;
        }
        if (raw.kind !== "request") return;

        const url = String(raw.url ?? "");
        if (!url) {
            safePost(port, { kind: "error", message: "缺少请求地址" });
            return;
        }

        controller = new AbortController();
        abortedByTimeout = false;
        console.info(`[bia][sw] 请求 → ${raw.method ?? "GET"} ${url}`);
        timeoutTimer = setTimeout(() => {
            abortedByTimeout = true;
            controller?.abort();
        }, raw.timeoutMs ?? 60_000);

        void (async () => {
            try {
                const response = await fetch(url, {
                    method: raw.method ?? "GET",
                    headers: raw.headers,
                    body: raw.data,
                    signal: controller!.signal,
                    credentials: raw.credentials ?? "omit",
                });
                const cumulative = response.body
                    ? await pumpResponseBody(response, (text) => {
                          safePost(port, { kind: "progress", text });
                      })
                    : "";
                console.info(
                    `[bia][sw] 请求完成 ← HTTP ${response.status} (${url.slice(0, 80)})`,
                );
                safePost(port, {
                    kind: "done",
                    status: response.status,
                    responseText: cumulative,
                    finalUrl: response.url || url,
                });
            } catch (error) {
                const message = abortedByTimeout
                    ? "网络请求超时"
                    : error instanceof Error && error.name === "AbortError"
                      ? "请求已中止"
                      : error instanceof Error
                        ? error.message
                        : String(error);
                console.error(`[bia][sw] 请求失败: ${message}`);
                safePost(port, { kind: "error", message });
            } finally {
                if (timeoutTimer !== null) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
            }
        })();
    });
}

function registerKimiChat(port: chrome.runtime.Port): void {
    let controller: AbortController | null = null;

    port.onMessage.addListener((raw: KimiPortMessage) => {
        if (raw.kind === "ping") return;
        if (raw.kind === "abort") {
            controller?.abort();
            return;
        }
        if (raw.kind !== "chat") return;

        controller = new AbortController();
        console.info(`[bia][sw] kimi 对话开始 (${raw.messages?.length ?? 0} 条消息)`);
        void (async () => {
            try {
                const plain = await streamKimiChat(
                    raw.messages ?? [],
                    (acc) => safePost(port, { kind: "progress", text: acc }),
                    controller!.signal,
                );
                console.info(`[bia][sw] kimi 对话完成 (${plain.length} 字)`);
                safePost(port, { kind: "done", plain });
                // 生成完成: 自动删除本次会话, 避免污染 kimi 聊天列表
                const chatIds = drainKimiChatIds();
                if (chatIds.length > 0) {
                    deleteKimiChats(chatIds, controller!.signal)
                        .then((deleted) =>
                            console.info(
                                `[bia][sw] 已清理 ${deleted} 个 kimi 会话`,
                            ),
                        )
                        .catch((cleanupError) =>
                            console.warn(
                                "[bia][sw] kimi 会话清理失败:",
                                cleanupError instanceof Error
                                    ? cleanupError.message
                                    : String(cleanupError),
                            ),
                        );
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.error(`[bia][sw] kimi 对话失败: ${message}`);
                safePost(port, {
                    kind: "error",
                    message,
                });
            }
        })();
    });
}
