/**
 * Kimi 网页版 (kimi.com) 接入: 免 API Key, 复用浏览器登录态.
 *
 * 认证链路 (参照 kimi 网页版自身行为):
 *   localStorage.refresh_token → GET /api/auth/token/refresh (Bearer) → access_token
 * 请求优先从后台 Service Worker 直连 (Bearer + Cookie); 失败时回退到
 * kimi.com 页面内执行 (chrome.scripting, ISOLATED world: 同源 Cookie + 页面环境).
 */

import { storageGet, storageSet } from "../core/storage";


const KIMI_BASE = "https://www.kimi.com";
const REFRESH_TOKEN_KEY = "bia:kimi-refresh-token";
const ACCESS_TOKEN_KEY = "bia:kimi-access-token";

let accessToken: string | null = null;
const pendingKimiChatIds = new Set<string>();

export interface KimiAuthState {
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
}

export function getKimiAuthState(): KimiAuthState {
    return {
        hasAccessToken: Boolean(accessToken ?? storageGet<string>(ACCESS_TOKEN_KEY, "")),
        hasRefreshToken: Boolean(storageGet<string>(REFRESH_TOKEN_KEY, "")),
    };
}

// ---------------- 标签页管理 ----------------

/** 常驻标签页: 仅页面内流式回退时复用 (最多一个). */
let kimiTabId: number | null = null;
let kimiTabPending: Promise<number> | null = null;

async function openKimiTab(): Promise<number> {
    const tab = await chrome.tabs.create({
        url: `${KIMI_BASE}/`,
        active: false,
    });
    const id = tab.id ?? null;
    if (id === null) throw new Error("无法打开 kimi.com 标签页");

    // 等待页面加载完成 (最多 15s, SPA 场景超时后继续尝试)
    await new Promise<void>((resolve) => {
        let listener: ((tabId: number, info: { status?: string }) => void) | null =
            null;
        const finish = () => {
            clearTimeout(timeout);
            if (listener) chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        listener = (tabId, info) => {
            if (tabId === id && info.status === "complete") finish();
        };
        const timeout = setTimeout(finish, 15_000);
        chrome.tabs.onUpdated.addListener(listener);
    });
    return id;
}

async function isTabAlive(id: number): Promise<boolean> {
    try {
        await chrome.tabs.get(id);
        return true;
    } catch {
        return false;
    }
}

/**
 * 获取常驻 kimi 标签页 (页面内流式回退专用).
 * 并发去重: 同时只创建一个; 用户关掉则重建.
 */
async function ensureKimiTab(): Promise<number> {
    if (kimiTabId !== null && (await isTabAlive(kimiTabId))) return kimiTabId;
    kimiTabId = null;
    if (kimiTabPending) return kimiTabPending;
    kimiTabPending = openKimiTab()
        .then((id) => {
            kimiTabId = id;
            return id;
        })
        .finally(() => {
            kimiTabPending = null;
        });
    return kimiTabPending;
}

/**
 * 一次性临时页: 打开 kimi.com 读取 localStorage 后立即关闭.
 * 授权阶段用, 避免留下可见标签页.
 */
async function readLocalStorageOnce<T>(
    script: () => T | Promise<T>,
): Promise<T> {
    const tab = await chrome.tabs.create({
        url: `${KIMI_BASE}/`,
        active: false,
    });
    const id = tab.id;
    if (id === undefined) throw new Error("无法打开 kimi.com 标签页");
    try {
        await new Promise<void>((resolve) => {
            let listener: ((tabId: number, info: { status?: string }) => void) | null =
                null;
            const finish = () => {
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            };
            listener = (tabId, info) => {
                if (tabId === id && info.status === "complete") finish();
            };
            const timeout = setTimeout(finish, 15_000);
            chrome.tabs.onUpdated.addListener(listener);
        });
        const results = await chrome.scripting.executeScript({
            target: { tabId: id },
            world: "ISOLATED",
            func: script as (...args: never[]) => T,
        });
        return results?.[0]?.result as T;
    } finally {
        // 授权页读完即关, 不留垃圾标签页
        try {
            await chrome.tabs.remove(id);
        } catch {
            /* 已被用户关闭 */
        }
    }
}

// ---------------- Token ----------------

export async function loadRefreshTokenFromPage(): Promise<string | null> {
    try {
        const token = await readLocalStorageOnce(() =>
            localStorage.getItem("refresh_token"),
        );
        if (token) storageSet(REFRESH_TOKEN_KEY, token);
        return token ?? null;
    } catch {
        return null;
    }
}

/** 页面内执行登录态刷新 (同源 Cookie): 授权引导用. */
async function refreshAccessTokenInPage(
    refreshToken: string,
): Promise<{ access_token?: string; refresh_token?: string }> {
    return readLocalStorageOnce(async () => {
        const res = await fetch(`${KIMI_BASE}/api/auth/token/refresh`, {
            method: "GET",
            headers: { Authorization: `Bearer ${refreshToken}` },
        });
        return res.json();
    });
}

async function refreshAccessToken(): Promise<string> {
    let refreshToken = storageGet<string>(REFRESH_TOKEN_KEY, "");
    if (!refreshToken) refreshToken = (await loadRefreshTokenFromPage()) ?? "";
    if (!refreshToken) {
        throw new Error(
            "未获取到 kimi.com 登录凭据: 请先在浏览器登录 kimi.com, 再到「设置」点击「重新获取授权」",
        );
    }

    const applyTokens = (data: {
        access_token?: string;
        refresh_token?: string;
    }) => {
        if (!data?.access_token || !data?.refresh_token) return false;
        accessToken = data.access_token;
        storageSet(ACCESS_TOKEN_KEY, data.access_token);
        storageSet(REFRESH_TOKEN_KEY, data.refresh_token);
        return true;
    };

    // 1) 后台直连
    try {
        const resp = await fetch(`${KIMI_BASE}/api/auth/token/refresh`, {
            method: "GET",
            headers: { Authorization: `Bearer ${refreshToken}` },
            credentials: "include",
        });
        if (resp.ok && applyTokens(await resp.json())) {
            return accessToken!;
        }
    } catch {
        /* 回退到页面内执行 */
    }

    // 2) 页面内执行 (同源, 自动带 Cookie/Referer); 用完关闭临时页
    const pageData = await refreshAccessTokenInPage(refreshToken);
    if (!applyTokens(pageData)) {
        throw new Error(
            "kimi 登录凭据已失效: 请打开 kimi.com 重新登录后, 到「设置」点击「重新获取授权」",
        );
    }
    return accessToken!;
}

async function ensureAccessToken(): Promise<string> {
    const cached = accessToken ?? storageGet<string>(ACCESS_TOKEN_KEY, "");
    if (cached) {
        accessToken = cached;
        return cached;
    }
    return refreshAccessToken();
}

/** 供 SW kimi-auth 消息使用: 确保拿到可用 access_token (必要时打开 kimi 页面引导). */
export async function ensureKimiAccessToken(): Promise<string> {
    return ensureAccessToken();
}

// ---------------- 请求 ----------------

async function kimiFetch(
    path: string,
    init: {
        method?: string;
        body?: unknown;
        signal?: AbortSignal;
    },
    token: string,
): Promise<Response> {
    return fetch(`${KIMI_BASE}${path}`, {
        method: init.method ?? "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "include",
        signal: init.signal,
    });
}

/** JSON 请求, 401 时刷新 token 重试一次. */
async function kimiJson<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
    let token = await ensureAccessToken();
    let resp = await kimiFetch(path, init, token);
    if (resp.status === 401) {
        token = await refreshAccessToken();
        resp = await kimiFetch(path, init, token);
    }
    if (!resp.ok) {
        throw new Error(`Kimi HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    return (await resp.json()) as T;
}

export async function createKimiChat(signal?: AbortSignal): Promise<string> {
    const data = await kimiJson<{ id?: string }>("/api/chat", {
        method: "POST",
        body: { is_example: false, name: "Bilibili AI 助手" },
        signal,
    });
    const id = String(data?.id ?? "");
    if (!id) throw new Error("创建 kimi 会话失败");
    return id;
}

// ---------------- 会话清理 (apiv2 批量删除) ----------------

/**
 * 获取 kimi 盾头: 必须在 kimi.com 页面上下文读取 window._fmOpt.getinfo().
 * 复用一次性临时页 (读完即关, 不留垃圾标签页).
 */
async function fetchKimiShield(): Promise<string> {
    return readLocalStorageOnce(() => {
        const fm = (window as unknown as {
            _fmOpt?: { getinfo?: () => string };
        })._fmOpt;
        if (!fm || typeof fm.getinfo !== "function") {
            throw new Error("kimi 页面盾头未就绪 (_fmOpt 缺失)");
        }
        return fm.getinfo();
    });
}

/**
 * 删除指定 kimi 会话 (apiv2 协议, 含盾头).
 * 用于生成结束后清理, 避免会话列表被污染.
 */
export async function deleteKimiChats(
    chatIds: string[],
    signal?: AbortSignal,
): Promise<number> {
    if (chatIds.length === 0) return 0;
    const token = await ensureAccessToken();
    const shield = await fetchKimiShield();
    const batchDelete = async (
        ids: string[],
        accessTokenInner: string,
        shieldData: string,
    ): Promise<void> => {
        const resp = await fetch(
            `${KIMI_BASE}/apiv2/kimi.chat.v1.ChatService/BatchDeleteChats`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessTokenInner}`,
                    "Content-Type": "application/json",
                    "connect-protocol-version": "1",
                    "x-msh-platform": "web",
                    "x-msh-version": "2.3.0",
                    "x-language": "zh-CN",
                    "x-msh-shield-data": shieldData,
                },
                body: JSON.stringify({ chat_ids: ids }),
                credentials: "include",
                signal,
            },
        );
        if (resp.status === 401) {
            // token 过期: 刷新盾头后重试一次
            const fresh = await refreshAccessToken();
            const freshShield = await fetchKimiShield();
            await batchDelete(ids, fresh, freshShield);
            return;
        }
        if (!resp.ok) {
            throw new Error(
                `Kimi 删除会话失败 (HTTP ${resp.status}): ${(await resp.text()).slice(0, 200)}`,
            );
        }
    };

    // 按每批 50 个切分 (与官方批量接口一致)
    for (let i = 0; i < chatIds.length; i += 50) {
        const batch = chatIds.slice(i, i + 50);
        await batchDelete(batch, token, shield);
        if (signal?.aborted) break;
    }
    return chatIds.length;
}

// ---------------- SSE 解析 (纯函数, 可单测) ----------------

export interface KimiStreamState {
    /** 累积的回复文本 */
    acc: string;
    done: boolean;
    error: string | null;
    errorType: string | null;
    urlRefs: unknown[];
}

/** kimi SSE 事件解析器: push(累积原始文本), 状态机解析 cmpl/content/error/all_done. */
export function createKimiStreamParser() {
    let buf = "";
    let cursor = 0;
    const state: KimiStreamState = {
        acc: "",
        done: false,
        error: null,
        errorType: null,
        urlRefs: [],
    };
    return {
        state,
        push(cumulativeText: string) {
            buf = cumulativeText;
            const lastNewline = buf.lastIndexOf("\n");
            if (lastNewline < cursor) return;
            const chunk = buf.slice(cursor, lastNewline + 1);
            cursor = lastNewline + 1;
            for (const line of chunk.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload) continue;
                try {
                    const j = JSON.parse(payload);
                    if (j.event === "cmpl") {
                        state.acc += String(j.text ?? "");
                    } else if (j.event === "content" && j.msg?.url_refs) {
                        state.urlRefs.push(j.msg.url_refs);
                    } else if (j.event === "error") {
                        state.error = String(j.error?.message ?? "Kimi error");
                        state.errorType = String(j.error?.error_type ?? "");
                    } else if (j.event === "all_done") {
                        state.done = true;
                    }
                } catch {
                    /* 半行数据, 等下一片 */
                }
            }
        },
    };
}

/** OpenAI 风格消息 → kimi 消息 (system 并入首条 user 消息, kimi 无 system 角色). */
export function toKimiMessages(
    messages: { role: string; content: string }[],
): { role: string; content: string }[] {
    let system = "";
    const out: { role: string; content: string }[] = [];
    for (const message of messages) {
        if (message.role === "system") {
            system += (system ? "\n\n" : "") + message.content;
            continue;
        }
        const content =
            message.role === "user" && system
                ? `${system}\n\n---\n\n${message.content}`
                : message.content;
        if (system && message.role === "user") system = "";
        out.push({ role: message.role, content });
    }
    if (system) out.unshift({ role: "user", content: system });
    return out;
}

// ---------------- 流式对话 ----------------

/** 页面内流式执行 (直连失败时的回退): 分片经 runtime.sendMessage 回传. */
async function streamChatInPage(
    chatId: string,
    body: unknown,
    onChunk: (acc: string) => void,
): Promise<string> {
    const channel = `kimi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tabId = await ensureKimiTab();

    return new Promise<string>((resolve, reject) => {
        let acc = "";
        let settled = false;
        let guard: ReturnType<typeof setTimeout> | null = null;
        const settle = (
            fn: () => void,
        ) => {
            if (settled) return;
            settled = true;
            if (guard !== null) clearTimeout(guard);
            chrome.runtime.onMessage.removeListener(listener);
            fn();
        };
        const listener = (msg: {
            kind?: string;
            channel?: string;
            type?: string;
            text?: string;
            message?: string;
        }) => {
            if (msg?.kind !== "kimi-relay" || msg.channel !== channel) return;
            if (msg.type === "chunk") {
                acc = String(msg.text ?? "");
                onChunk(acc);
            } else if (msg.type === "done") {
                settle(() => resolve(acc));
            } else if (msg.type === "error") {
                settle(() =>
                    reject(
                        new Error(String(msg.message ?? "Kimi 页面请求失败")),
                    ),
                );
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        // 注入脚本若不回消息, 120s 后拒绝, 避免 SW promise 永久挂起
        guard = setTimeout(() => {
            settle(() => reject(new Error("Kimi 页面回退流式超时 (120s)")));
        }, 120_000);
        void (async () => {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    world: "ISOLATED",
                    func: async (
                        base: string,
                        chatIdInner: string,
                        bodyInner: unknown,
                        channelInner: string,
                    ) => {
                        try {
                            const res = await fetch(
                                `${base}/api/chat/${chatIdInner}/completion/stream`,
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify(bodyInner),
                                },
                            );
                            if (!res.ok || !res.body) {
                                void chrome.runtime.sendMessage({
                                    kind: "kimi-relay",
                                    channel: channelInner,
                                    type: "error",
                                    message: `Kimi HTTP ${res.status}`,
                                });
                                return;
                            }
                            const reader = res.body.getReader();
                            const decoder = new TextDecoder();
                            let buf = "";
                            let accInner = "";
                            for (;;) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                buf += decoder.decode(value, { stream: true });
                                const lines = buf.split("\n");
                                buf = lines.pop() ?? "";
                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed.startsWith("data:")) continue;
                                    const payload = trimmed.slice(5).trim();
                                    if (!payload) continue;
                                    let j: {
                                        event?: string;
                                        text?: string;
                                        error?: { message?: string };
                                    };
                                    try {
                                        j = JSON.parse(payload);
                                    } catch {
                                        continue;
                                    }
                                    if (j.event === "cmpl") {
                                        accInner += String(j.text ?? "");
                                        void chrome.runtime.sendMessage({
                                            kind: "kimi-relay",
                                            channel: channelInner,
                                            type: "chunk",
                                            text: accInner,
                                        });
                                    } else if (j.event === "error") {
                                        void chrome.runtime.sendMessage({
                                            kind: "kimi-relay",
                                            channel: channelInner,
                                            type: "error",
                                            message:
                                                j.error?.message ?? "Kimi error",
                                        });
                                        return;
                                    } else if (j.event === "all_done") {
                                        void chrome.runtime.sendMessage({
                                            kind: "kimi-relay",
                                            channel: channelInner,
                                            type: "done",
                                        });
                                        return;
                                    }
                                }
                            }
                            void chrome.runtime.sendMessage({
                                kind: "kimi-relay",
                                channel: channelInner,
                                type: "done",
                            });
                        } catch (e) {
                            void chrome.runtime.sendMessage({
                                kind: "kimi-relay",
                                channel: channelInner,
                                type: "error",
                                message: String(e),
                            });
                        }
                    },
                    args: [KIMI_BASE, chatId, body, channel],
                });
            } catch (error) {
                chrome.runtime.onMessage.removeListener(listener);
                reject(
                    error instanceof Error
                        ? error
                        : new Error(String(error)),
                );
            }
        })();
    });
}

/**
 * 流式对话: 返回累积的完整回复文本.
 *
 * - 每次尝试用独立的 parser, 避免上一次失败的半截状态污染本次
 * - 直连读流设 20s 无数据超时: kimi 网页接口常拒绝后台直连且**不回响应体**,
 *   旧实现会让所有 AI 请求挂死 → 计时器/心跳堆积 → SW 反复重启 → 表现为
 *   不断打开新 kimi 标签页
 * - 只有网络/鉴权类错误才回退页面内执行; 模型返回的业务错误直接抛出, 不重试
 * - 页面内回退失败时按 1s/3s 指数回退重试, 尽量避免再开新标签页
 */
/** 记录本次创建的 kimi 会话 id, 供生成完成后清理. */
export function trackKimiChatId(chatId: string): void {
    if (chatId) pendingKimiChatIds.add(chatId);
}

/** 取走并清空待删除的会话 id 列表. */
export function drainKimiChatIds(): string[] {
    const ids = [...pendingKimiChatIds];
    pendingKimiChatIds.clear();
    return ids;
}

export async function streamKimiChat(
    messages: { role: string; content: string }[],
    onChunk: (acc: string) => void,
    signal?: AbortSignal,
): Promise<string> {
    const token = await ensureAccessToken();
    const chatId = await createKimiChat(signal);
    trackKimiChatId(chatId);
    const body = {
        messages: toKimiMessages(messages),
        refs: [] as string[],
        use_search: false,
    };

    /** 单次直连尝试: 独立 parser + 读空超时 */
    const run = async (accessTokenInner: string): Promise<string> => {
        const parser = createKimiStreamParser();
        const resp = await fetch(
            `${KIMI_BASE}/api/chat/${chatId}/completion/stream`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessTokenInner}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                credentials: "include",
                signal,
            },
        );
        if (!resp.ok) {
            throw new HttpLikeError(`Kimi HTTP ${resp.status}`, resp.status);
        }
        if (!resp.body) {
            throw new HttpLikeError("Kimi 响应无内容", 502);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let cumulative = "";
        let cursor = 0;
        let lastActivity = Date.now();

        const pump = async () => {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                lastActivity = Date.now();
                cumulative += decoder.decode(value, { stream: true });
                parser.push(cumulative);
                if (parser.state.error) {
                    throw new KimiError(
                        parser.state.error,
                        parser.state.errorType,
                    );
                }
                // 仅在产生新文本行时推送 (等价于游标推进)
                if (cumulative.length > cursor) {
                    cursor = cumulative.length;
                    onChunk(parser.state.acc);
                }
            }
            cumulative += decoder.decode();
            parser.push(`${cumulative}\n`);
        };

        const watchdog = setInterval(() => {
            if (Date.now() - lastActivity > 20_000) {
                void reader.cancel("idle timeout").catch(() => {});
            }
        }, 5_000);

        try {
            await pump();
        } finally {
            clearInterval(watchdog);
        }

        if (parser.state.error) {
            throw new KimiError(parser.state.error, parser.state.errorType);
        }
        return parser.state.acc;
    };

    try {
        return await run(token);
    } catch (error) {
        if (signal?.aborted) throw new Error("请求已中止");
        // 模型业务错误 / HTTP 4xx 其他码: 直接暴露, 不做无谓重试
        if (error instanceof KimiError) throw error;
        const isAuth = error instanceof HttpLikeError && error.status === 401;
        if (isAuth) {
            try {
                return await run(await refreshAccessToken());
            } catch (retryError) {
                if (retryError instanceof KimiError) throw retryError;
                /* 落到页面回退 */
            }
        }
        if (signal?.aborted) throw new Error("请求已中止");
        return streamChatInPageWithRetry(chatId, body, onChunk, signal);
    }
}

/** 页面内回退: 失败时按 1s/3s 退避重试, 每次都复用同一常驻标签页. */
async function streamChatInPageWithRetry(
    chatId: string,
    body: unknown,
    onChunk: (acc: string) => void,
    signal?: AbortSignal,
): Promise<string> {
    const delays = [0, 1_000, 3_000];
    let lastError: unknown = new Error("Kimi 页面回退失败");
    for (const delay of delays) {
        if (signal?.aborted) throw new Error("请求已中止");
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        try {
            return await streamChatInPage(chatId, body, onChunk);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError));
}

class HttpLikeError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message);
        this.name = "HttpLikeError";
    }
}

class KimiError extends Error {
    constructor(
        message: string,
        public errorType: string | null,
    ) {
        super(message);
        this.name = "KimiError";
    }
}
