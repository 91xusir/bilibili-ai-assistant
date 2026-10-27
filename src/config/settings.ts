import { storageGet, storageSet } from "../core/storage";
import type { AiSettings, TaskToggles } from "../types";

const AI_SETTINGS_KEY = "bia:ai-settings";
const AD_SKIP_KEY = "bia:ad-skip-enabled";
const TASK_TOGGLES_KEY = "bia:task-toggles";

const DEFAULT_AI_SETTINGS: AiSettings = {
    provider: "kimi",
    baseUrl: "",
    apiKey: "",
    model: "",
    reasoningEffort: "",
    cacheEnabled: true,
    cacheTtlHours: 0,
    combinedTasks: true,
};

export function getAiSettings(): AiSettings {
    const saved = storageGet<Partial<AiSettings>>(AI_SETTINGS_KEY, {});
    return { ...DEFAULT_AI_SETTINGS, ...saved };
}

export function saveAiSettings(patch: Partial<AiSettings>): void {
    const next: AiSettings = { ...getAiSettings(), ...patch };
    storageSet(AI_SETTINGS_KEY, next);
}

export function isAiConfigured(): boolean {
    const settings = getAiSettings();
    // Kimi 网页版走浏览器登录态, 无需预先配置 (运行时引导授权)
    if (settings.provider === "kimi") return true;
    return Boolean(settings.baseUrl && settings.model);
}

export function getAdSkipEnabled(): boolean {
    return storageGet(AD_SKIP_KEY, true);
}

export function setAdSkipEnabled(enabled: boolean): void {
    storageSet(AD_SKIP_KEY, enabled);
}

export function getTaskToggles(): TaskToggles {
    const saved = storageGet<Partial<TaskToggles>>(TASK_TOGGLES_KEY, {});
    return { summary: saved.summary !== false, mindmap: saved.mindmap !== false };
}

export function saveTaskToggles(toggles: TaskToggles): void {
    storageSet(TASK_TOGGLES_KEY, toggles);
}

/**
 * 缓存是否已过保留期. ttlHours <= 0 表示永久;
 * 无时间戳的旧缓存条目在设置了 TTL 时视为过期.
 */
export function isCacheExpired(
    savedAt: number | undefined,
    ttlHours: number,
): boolean {
    if (!ttlHours || ttlHours <= 0) return false;
    if (!savedAt) return true;
    return Date.now() - savedAt > ttlHours * 3_600_000;
}

/** 是否使用单次汇总模式 (总结+导图+广告 一次请求). */
export function isCombinedTasksEnabled(): boolean {
    return getAiSettings().combinedTasks !== false;
}

/** AI 结果缓存按 bvid + cid + 模型名区分, 换模型后可重新生成. */
export function aiCacheKey(bvid: string, cid: number, model: string): string {
    return `bia:ai-cache:${bvid}:${cid}:${model}`;
}
