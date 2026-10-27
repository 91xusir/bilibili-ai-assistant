import { getAiSettings } from "../config/settings";
import { kimiAbortAll, kimiChatStream } from "../core/kimi-port";
import {
    platformRequest,
    type PlatformRequestHandle,
} from "../core/net";

const LOG_PREFIX = "[bia]";

export class AiNotConfiguredError extends Error {
    constructor() {
        super("未配置 AI 接口, 请点击面板右上角 ⚙ 图标进行设置");
        this.name = "AiNotConfiguredError";
    }
}

export class HttpError extends Error {
    constructor(
        public status: number,
        body: string,
    ) {
        super(
            `AI 接口错误 (HTTP ${status}): ${body.replace(/\s+/g, " ").slice(0, 300)}`,
        );
        this.name = "HttpError";
    }
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

const activeHandles = new Set<PlatformRequestHandle>();

/** 中止所有进行中的 AI 请求 (切页/重新生成时调用). */
export function abortAllAiRequests(): void {
    for (const handle of activeHandles) {
        try {
            handle.abort();
        } catch {
            /* ignore */
        }
    }
    activeHandles.clear();
    kimiAbortAll();
}

function isKimiProvider(): boolean {
    return getAiSettings().provider === "kimi";
}

function buildHeaders(): Record<string, string> {
    const settings = getAiSettings();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    return headers;
}

/** 用户可能把完整的 /chat/completions 地址贴进 Base URL, 这里做容错. */
function requestUrl(): string {
    const settings = getAiSettings();
    const normalized = settings.baseUrl
        .replace(/\/+$/, "")
        .replace(/\/chat\/completions$/i, "");
    return `${normalized}/chat/completions`;
}

/**
 * 思考模式参数:
 * - 设置了思考等级 → 标准 reasoning_effort (low/medium/high)
 * - 未设置 → 主动关闭思考模式, 按服务商发送对应的禁用参数
 */
function applyThinkingParams(body: Record<string, unknown>): void {
    const settings = getAiSettings();
    if (settings.reasoningEffort) {
        body.reasoning_effort = settings.reasoningEffort;
        return;
    }
    const base = settings.baseUrl.toLowerCase();
    const model = settings.model.toLowerCase();
    if (base.includes("bigmodel") || model.startsWith("mimo")) {
        body.thinking = { type: "disabled" }; // 智谱 GLM
    } else if (base.includes("dashscope") || model.startsWith("qwen")) {
        body.enable_thinking = false; // 通义 Qwen
    } else if (base.includes("openrouter")) {
        body.reasoning = { exclude: true }; // OpenRouter
    } else {
        body.reasoning_effort = "minimal"; // OpenAI gpt-5 系列等
    }
}

interface BodyOptions {
    temperature?: number;
    jsonMode?: boolean;
    maxTokens?: number;
    stream?: boolean;
}

function buildRequestBody(
    messages: ChatMessage[],
    options: BodyOptions = {},
): Record<string, unknown> {
    const settings = getAiSettings();
    const body: Record<string, unknown> = {
        model: settings.model,
        messages,
        temperature: options.temperature ?? 0.4,
    };
    if (options.jsonMode !== false) {
        body.response_format = { type: "json_object" };
    }
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.stream) body.stream = true;
    applyThinkingParams(body);
    return body;
}

/** 拉取 OpenAI 标准模型列表 (GET /models). */
export async function fetchModelList(): Promise<string[]> {
    const settings = getAiSettings();
    if (!settings.baseUrl) throw new AiNotConfiguredError();
    const url = `${requestUrl().replace(/\/chat\/completions$/, "")}/models`;
    console.info(`${LOG_PREFIX} 获取模型列表 → ${url}`);
    const { promise, handle } = platformRequest({
        method: "GET",
        url,
        headers: buildHeaders(),
        timeout: 30_000,
    });
    activeHandles.add(handle);
    try {
        const response = await promise;
        console.info(`${LOG_PREFIX} 模型列表 ← HTTP ${response.status}`);
        if (response.status < 200 || response.status >= 300) {
            throw new HttpError(response.status, response.responseText);
        }
        let data: unknown;
        try {
            data = JSON.parse(response.responseText);
        } catch {
            throw new Error("模型列表返回格式异常");
        }
        const raw: any[] = Array.isArray((data as any)?.data)
            ? (data as any).data
            : Array.isArray(data)
              ? (data as any[])
              : [];
        const ids = [
            ...new Set(
                raw
                    .map((item: any) => String(item?.id ?? item ?? "").trim())
                    .filter((id) => id.length > 0),
            ),
        ].sort((a, b) => a.localeCompare(b));
        if (ids.length === 0) throw new Error("上游返回的模型列表为空");
        return ids;
    } catch (error) {
        if (error instanceof Error) {
            console.error(`${LOG_PREFIX} 获取模型列表失败:`, error.message);
        }
        throw error;
    } finally {
        activeHandles.delete(handle);
    }
}

interface RequestOnceOptions {
    temperature?: number;
    jsonMode?: boolean;
    maxTokens?: number;
    timeoutMs?: number;
}

async function requestOnce(
    messages: ChatMessage[],
    options: RequestOnceOptions = {},
): Promise<string> {
    const settings = getAiSettings();
    if (!settings.baseUrl || !settings.model) throw new AiNotConfiguredError();

    const url = requestUrl();
    console.info(`${LOG_PREFIX} AI 请求 → ${url} (model: ${settings.model})`);
    const { promise, handle } = platformRequest({
        method: "POST",
        url,
        headers: buildHeaders(),
        data: JSON.stringify(buildRequestBody(messages, options)),
        timeout: options.timeoutMs ?? 180_000,
    });
    activeHandles.add(handle);
    try {
        const response = await promise;
        console.info(`${LOG_PREFIX} AI 响应 ← HTTP ${response.status}`);
        if (response.status < 200 || response.status >= 300) {
            throw new HttpError(response.status, response.responseText);
        }
        let data: unknown;
        try {
            data = JSON.parse(response.responseText);
        } catch {
            throw new Error(
                `AI 接口返回格式异常: ${response.responseText.slice(0, 200)}`,
            );
        }
        const content = (data as any)?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
            throw new Error("AI 返回内容为空");
        }
        return content;
    } catch (error) {
        if (error instanceof Error && error.name !== "HttpError") {
            console.error(`${LOG_PREFIX} AI 请求失败:`, error.message);
        }
        throw error;
    } finally {
        activeHandles.delete(handle);
    }
}

interface RequestStreamOptions extends RequestOnceOptions {
    /** 每次收到新内容时回调 (累积的纯文本) */
    onDelta?: (plain: string) => void;
}

/** 从 SSE 累积文本中提取 delta.content (增量解析, 只处理新完成的行). */
function createSseParser() {
    let cursor = 0;
    let plain = "";
    return (buffer: string): string => {
        const lastNewline = buffer.lastIndexOf("\n");
        if (lastNewline < cursor) return plain;
        const chunk = buffer.slice(cursor, lastNewline + 1);
        cursor = lastNewline + 1;
        for (const rawLine of chunk.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
                const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
                if (typeof delta === "string") plain += delta;
            } catch {
                /* 半行数据, 等下一片 */
            }
        }
        return plain;
    };
}

/**
 * 流式请求 (stream: true), 通过 onprogress 增量接收 SSE 内容.
 * 返回提取出的纯文本与原始响应体; 服务商不支持流式时 plain 为空字符串.
 */
async function requestStream(
    messages: ChatMessage[],
    options: RequestStreamOptions = {},
): Promise<{ plain: string; raw: string }> {
    const settings = getAiSettings();
    if (!settings.baseUrl || !settings.model) throw new AiNotConfiguredError();

    const url = requestUrl();
    console.info(`${LOG_PREFIX} AI 流式请求 → ${url} (model: ${settings.model})`);
    const parseSse = createSseParser();
    let buffer = "";
    let seenDelta = false;
    // 兼容两种管理器: onprogress 给累积文本 (主流) 或增量文本 (兜底拼接)
    const ingest = (text: string): string => {
        buffer = text.length >= buffer.length ? text : buffer + text;
        return parseSse(buffer);
    };
    const { promise, handle } = platformRequest({
        method: "POST",
        url,
        headers: buildHeaders(),
        data: JSON.stringify(buildRequestBody(messages, { ...options, stream: true })),
        timeout: options.timeoutMs ?? 300_000,
        onprogress: (resp) => {
            const plain = ingest(resp.responseText);
            if (!seenDelta && plain.length > 0) {
                seenDelta = true;
                console.info(`${LOG_PREFIX} 流式数据接收中 ✓`);
            }
            options.onDelta?.(plain);
        },
    });
    activeHandles.add(handle);
    try {
        const response = await promise;
        console.info(`${LOG_PREFIX} AI 流式响应 ← HTTP ${response.status}`);
        if (response.status < 200 || response.status >= 300) {
            throw new HttpError(response.status, response.responseText);
        }
        const plain = ingest(`${response.responseText}\n`);
        return { plain, raw: response.responseText };
    } catch (error) {
        if (error instanceof Error) {
            console.error(`${LOG_PREFIX} AI 流式请求失败:`, error.message);
        }
        throw error;
    } finally {
        activeHandles.delete(handle);
    }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (
                error instanceof HttpError &&
                [400, 401, 403, 404].includes(error.status)
            ) {
                throw error;
            }
            if (error instanceof AiNotConfiguredError) throw error;
            if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 800));
            }
        }
    }
    throw lastError;
}

/** 从 AI 回复文本中提取 JSON (兼容 markdown 代码块与前后缀文字). */
export function extractJson(text: string): unknown {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        /* 继续尝试其他方式 */
    }
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            /* ignore */
        }
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
        try {
            return JSON.parse(trimmed.slice(first, last + 1));
        } catch {
            /* ignore */
        }
    }
    throw new Error("无法从 AI 回复中解析出 JSON");
}

/** 非流式 JSON 请求. */
export async function chatJson(
    messages: ChatMessage[],
    options: { temperature?: number } = {},
): Promise<unknown> {
    if (isKimiProvider()) {
        return extractJson(await kimiChatStream(messages));
    }
    let text: string;
    try {
        text = await withRetry(() => requestOnce(messages, options));
    } catch (error) {
        if (error instanceof HttpError && error.status === 400) {
            // 部分服务不支持 response_format, 去掉后重试
            text = await withRetry(() =>
                requestOnce(messages, { ...options, jsonMode: false }),
            );
        } else {
            throw error;
        }
    }
    return extractJson(text);
}

/**
 * 流式 JSON 请求: 内容边生成边通过 onPartialText 回调 (累积纯文本),
 * 完成后解析为 JSON. 服务商不支持流式时自动退回整体解析.
 */
export async function chatJsonStream(
    messages: ChatMessage[],
    options: {
        temperature?: number;
        onPartialText?: (plain: string) => void;
    } = {},
): Promise<unknown> {
    if (isKimiProvider()) {
        return extractJson(
            await kimiChatStream(messages, options.onPartialText),
        );
    }
    // 对外回调名 onPartialText → 内部流式回调 onDelta
    const streamOptions = {
        temperature: options.temperature,
        onDelta: options.onPartialText,
    };
    let result: { plain: string; raw: string };
    try {
        result = await withRetry(() => requestStream(messages, streamOptions));
    } catch (error) {
        if (error instanceof HttpError && error.status === 400) {
            // 部分服务不支持 response_format, 去掉后重试
            result = await withRetry(() =>
                requestStream(messages, { ...streamOptions, jsonMode: false }),
            );
        } else {
            throw error;
        }
    }
    if (result.plain.trim()) {
        try {
            return extractJson(result.plain);
        } catch {
            /* 回退到原始响应体 */
        }
    }
    return extractJson(result.raw);
}

/** 设置弹窗"测试连接": 发一个极小请求验证配置, 返回模型回复文本. */
export async function testAiConnection(): Promise<string> {
    if (isKimiProvider()) {
        const plain = await kimiChatStream([
            { role: "user", content: "请只回复两个字母: OK" },
        ]);
        return plain.trim().slice(0, 50) || "OK";
    }
    const text = await requestOnce(
        [{ role: "user", content: "请只回复两个字母: OK" }],
        { temperature: 0, jsonMode: false, maxTokens: 16, timeoutMs: 30_000 },
    );
    return text.trim().slice(0, 50);
}
