import {
    storageGet,
    storageSet,
} from "../core/storage";
import type {
    AiSettings,
    FeatureSettings,
    TaskPlan,
} from "../types";

const AI_SETTINGS_KEY = "bia:ai-settings";
const FEATURE_SETTINGS_KEY = "bia:feature-settings";

const DEFAULT_AI_SETTINGS: AiSettings = {
    provider: "kimi",
    baseUrl: "",
    apiKey: "",
    model: "",
    reasoningEffort: "",
    cacheEnabled: true,
    cacheTtlHours: 0,
};

const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
    autoSummary: true,
    detectAds: true,
    autoSkipAds: true,
    clickAction: "jump",
};

export function getAiSettings(): AiSettings {
    const saved = storageGet<Partial<AiSettings>>(AI_SETTINGS_KEY, {});
    return { ...DEFAULT_AI_SETTINGS, ...saved };
}

export function saveAiSettings(patch: Partial<AiSettings>): void {
    const next: AiSettings = { ...getAiSettings(), ...patch };
    storageSet(AI_SETTINGS_KEY, next);
}

export function getFeatureSettings(): FeatureSettings {
    const saved = storageGet<Partial<FeatureSettings>>(
        FEATURE_SETTINGS_KEY,
        {},
    );
    return { ...DEFAULT_FEATURE_SETTINGS, ...saved };
}

export function saveFeatureSettings(patch: Partial<FeatureSettings>): void {
    const next: FeatureSettings = { ...getFeatureSettings(), ...patch };
    storageSet(FEATURE_SETTINGS_KEY, next);
}

export function getClickAction(): "jump" | "copy" {
    return getFeatureSettings().clickAction;
}

export function isAiConfigured(): boolean {
    const settings = getAiSettings();
    // Kimi 网页版走浏览器登录态, 无需预先配置 (运行时引导授权)
    if (settings.provider === "kimi") return true;
    return Boolean(settings.baseUrl && settings.model);
}

/**
 * 由功能开关推导任务计划 (纯函数, 供单测):
 */
export function resolveTaskPlan(features: FeatureSettings): TaskPlan {
    const summary = features.autoSummary;
    const ads = features.detectAds;
    const mode = summary && ads
        ? "combined"
        : summary
          ? "summary"
          : ads
            ? "ads"
            : "none";
    return { summary, ads, mode };
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

/** AI 结果缓存按视频键 (videoKey, 如 "BV1xxx?p=2") 区分. */
export function aiCacheKey(videoKey: string): string {
    return `bia:ai-cache:${videoKey}`;
}
