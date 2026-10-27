import {
    storageDelete,
    storageGet,
    storageKeys,
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
 * - 自动跳过开启 → 广告识别强制视为开启 (跳过依赖识别结果)
 * - 总结与广告同时生效 → combined 单请求; 只开其一 → 单任务; 全关 → none (仅手动)
 */
export function resolveTaskPlan(features: FeatureSettings): TaskPlan {
    const summary = features.autoSummary;
    const ads = features.detectAds || features.autoSkipAds;
    const mode = summary && ads
        ? "combined"
        : summary
          ? "summary"
          : ads
            ? "ads"
            : "none";
    return { summary, ads, autoSkip: features.autoSkipAds, mode };
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

/**
 * 清理历史版本的存储键:
 * - 旧功能开关键 (bia:ad-skip-enabled / bia:task-toggles)
 * - 旧缓存键格式 bia:ai-cache:{bvid}:{cid}:{model} (含 2 个以上冒号)
 */
export function cleanupLegacyStorage(): void {
    storageDelete("bia:ad-skip-enabled");
    storageDelete("bia:task-toggles");
    for (const key of storageKeys()) {
        if (!key.startsWith("bia:ai-cache:")) continue;
        // 新格式 = "bia:ai-cache:{videoKey}" (3 段); 旧格式含 :cid:model 共 5 段
        if (key.split(":").length > 3) storageDelete(key);
    }
}
