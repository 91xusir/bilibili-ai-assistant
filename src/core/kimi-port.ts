/**
 * 内容脚本侧的 Kimi 客户端: 经 Port 与后台 SW 通信, SW 负责与 kimi.com 的全部交互.
 */

interface ChatMessageLike {
    role: string;
    content: string;
}

const activePorts = new Set<chrome.runtime.Port>();

/** 中止所有进行中的 kimi 对话 (切页/重新生成时调用). */
export function kimiAbortAll(): void {
    for (const port of activePorts) {
        try {
            port.postMessage({ kind: "abort" });
            port.disconnect();
        } catch {
            /* ignore */
        }
    }
    activePorts.clear();
}

/** 流式对话: 返回累积的完整回复文本, onPartialText 收到部分文本. */
export function kimiChatStream(
    messages: ChatMessageLike[],
    onPartialText?: (plain: string) => void,
): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let port: chrome.runtime.Port;
        let pingTimer: ReturnType<typeof setInterval> | null = null;
        try {
            port = chrome.runtime.connect({ name: "bia-kimi" });
        } catch (error) {
            reject(
                error instanceof Error
                    ? error
                    : new Error("无法连接扩展后台"),
            );
            return;
        }
        activePorts.add(port);

        const cleanup = () => {
            activePorts.delete(port);
            if (pingTimer !== null) {
                clearInterval(pingTimer);
                pingTimer = null;
            }
            try {
                port.disconnect();
            } catch {
                /* ignore */
            }
        };

        port.onMessage.addListener((msg: {
            kind?: string;
            text?: string;
            plain?: string;
            message?: string;
        }) => {
            if (msg.kind === "progress") {
                onPartialText?.(String(msg.text ?? ""));
            } else if (msg.kind === "done") {
                cleanup();
                resolve(String(msg.plain ?? ""));
            } else if (msg.kind === "error") {
                cleanup();
                reject(new Error(String(msg.message ?? "Kimi 请求失败")));
            }
        });
        port.onDisconnect.addListener(() => {
            if (!activePorts.has(port)) return; // 已正常收尾
            cleanup();
            reject(new Error("与扩展后台的连接已断开"));
        });

        pingTimer = setInterval(() => {
            try {
                port.postMessage({ kind: "ping" });
            } catch {
                /* ignore */
            }
        }, 20_000);

        port.postMessage({ kind: "chat", messages });
    });
}

/** 引导获取 kimi 登录凭据 (打开 kimi.com 标签页读取/刷新 token). */
export async function kimiAuthBootstrap(): Promise<{
    ok: boolean;
    hasAccessToken?: boolean;
    hasRefreshToken?: boolean;
    error?: string;
}> {
    try {
        const reply = (await chrome.runtime.sendMessage({
            kind: "kimi-auth",
        })) as {
            ok?: boolean;
            hasAccessToken?: boolean;
            hasRefreshToken?: boolean;
            error?: string;
        };
        return {
            ok: reply?.ok === true,
            hasAccessToken: reply?.hasAccessToken,
            hasRefreshToken: reply?.hasRefreshToken,
            error: reply?.error,
        };
    } catch {
        return { ok: false, error: "无法连接扩展后台" };
    }
}
