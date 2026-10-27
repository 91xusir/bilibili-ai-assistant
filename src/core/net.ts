/**
 * 经由后台 Service Worker 的流式网络请求:
 * fetch + ReadableStream 逐块回传累积文本, 支持真正的流式输出并绕开页面 CORS.
 */

export interface PlatformResponse {
    status: number;
    responseText: string;
    finalUrl: string;
}

export interface PlatformRequestOptions {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    /** 是否携带浏览器 Cookie (B站字幕等接口需要登录态) */
    credentials?: "include" | "omit";
    onprogress?: (response: PlatformResponse) => void;
}

export interface PlatformRequestHandle {
    abort(): void;
}

export function platformRequest(options: PlatformRequestOptions): {
    promise: Promise<PlatformResponse>;
    handle: PlatformRequestHandle;
} {
    let port: chrome.runtime.Port | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const promise = new Promise<PlatformResponse>((resolve, reject) => {
        try {
            port = chrome.runtime.connect({ name: "bia-ai" });
        } catch (error) {
            reject(
                error instanceof Error
                    ? error
                    : new Error("无法连接扩展后台"),
            );
            return;
        }

        const cleanup = () => {
            if (pingTimer !== null) {
                clearInterval(pingTimer);
                pingTimer = null;
            }
            try {
                port?.disconnect();
            } catch {
                /* ignore */
            }
        };

        port.onMessage.addListener((raw) => {
            const msg = raw as {
                kind: string;
                text?: string;
                status?: number;
                responseText?: string;
                finalUrl?: string;
                message?: string;
            };
            if (msg.kind === "progress") {
                options.onprogress?.({
                    status: msg.status ?? 0,
                    responseText: String(msg.text ?? ""),
                    finalUrl: options.url,
                });
            } else if (msg.kind === "done") {
                cleanup();
                resolve({
                    status: msg.status ?? 0,
                    responseText: String(msg.responseText ?? ""),
                    finalUrl: msg.finalUrl ?? options.url,
                });
            } else if (msg.kind === "error") {
                cleanup();
                reject(new Error(String(msg.message ?? "扩展后台请求失败")));
            }
        });
        port.onDisconnect.addListener(() => {
            // 页面进 bfcache 等场景会带 lastError 断开, 不读取会报 Unchecked runtime.lastError
            void chrome.runtime.lastError;
            cleanup();
            reject(new Error("与扩展后台的连接已断开"));
        });

        // MV3 Service Worker 空闲 ~30s 会被回收, 定期 ping 保活
        pingTimer = setInterval(() => {
            try {
                port?.postMessage({ kind: "ping" });
            } catch {
                /* ignore */
            }
        }, 20_000);

        port.postMessage({
            kind: "request",
            url: options.url,
            method: options.method ?? "GET",
            headers: options.headers ?? {},
            data: options.data,
            timeoutMs: options.timeout ?? 60_000,
            credentials: options.credentials,
        });
    });

    return {
        promise,
        handle: {
            abort: () => {
                try {
                    port?.postMessage({ kind: "abort" });
                } catch {
                    /* ignore */
                }
            },
        },
    };
}
