import { beforeEach, describe, expect, test } from "bun:test";
import {
    aiCacheKey,
    cleanupLegacyStorage,
    getFeatureSettings,
    isCacheExpired,
    resolveTaskPlan,
} from "../src/config/settings";
import { storageHydrate } from "../src/core/storage";
import type { FeatureSettings } from "../src/types";

// ---- chrome.storage.local 内存 mock (settings 模块的水合缓存依赖它) ----
const backing = new Map<string, unknown>();

beforeEach(() => {
    backing.clear();
    (globalThis as { chrome?: unknown }).chrome = {
        storage: {
            local: {
                get: async (keys: string | string[] | null) => {
                    if (keys === null) return Object.fromEntries(backing);
                    const list = Array.isArray(keys) ? keys : [keys];
                    const out: Record<string, unknown> = {};
                    for (const key of list) {
                        if (backing.has(key)) out[key] = backing.get(key);
                    }
                    return out;
                },
                set: async (items: Record<string, unknown>) => {
                    for (const [k, v] of Object.entries(items)) backing.set(k, v);
                },
                remove: async (key: string | string[]) => {
                    const list = Array.isArray(key) ? key : [key];
                    for (const k of list) backing.delete(k);
                },
            },
            onChanged: {
                addListener: () => {},
                removeListener: () => {},
            },
        },
        runtime: { id: "test" },
    };
});

describe("resolveTaskPlan", () => {
    const base: FeatureSettings = {
        autoSummary: true,
        detectAds: true,
        autoSkipAds: true,
        clickAction: "jump",
    };

    test("全开 → combined", () => {
        const plan = resolveTaskPlan(base);
        expect(plan.mode).toBe("combined");
        expect(plan.summary).toBe(true);
        expect(plan.ads).toBe(true);
    });

    test("关自动总结 → 仅广告请求", () => {
        const plan = resolveTaskPlan({ ...base, autoSummary: false });
        expect(plan.mode).toBe("ads");
        expect(plan.summary).toBe(false);
        expect(plan.ads).toBe(true);
    });

    test("关广告识别但开自动跳过 → 识别强制生效", () => {
        const plan = resolveTaskPlan({ ...base, detectAds: false });
        expect(plan.mode).toBe("combined");
        expect(plan.ads).toBe(true);
    });

    test("关自动跳过+开识别 → 识别但不自动跳过", () => {
        const plan = resolveTaskPlan({ ...base, autoSkipAds: false });
        expect(plan.mode).toBe("combined");
        expect(plan.autoSkip).toBe(false);
    });

    test("全关 → none (仅手动触发)", () => {
        const plan = resolveTaskPlan({
            ...base,
            autoSummary: false,
            detectAds: false,
            autoSkipAds: false,
        });
        expect(plan.mode).toBe("none");
        expect(plan.summary).toBe(false);
        expect(plan.ads).toBe(false);
    });
});

describe("isCacheExpired", () => {
    test("TTL=0 永不过期", () => {
        expect(isCacheExpired(undefined, 0)).toBe(false);
        expect(isCacheExpired(Date.now() - 999_999_999, 0)).toBe(false);
    });

    test("TTL 内不过期, 超时过期, 无时间戳视为过期", () => {
        expect(isCacheExpired(Date.now() - 1000, 1)).toBe(false);
        expect(isCacheExpired(Date.now() - 2 * 3_600_000, 1)).toBe(true);
        expect(isCacheExpired(undefined, 1)).toBe(true);
    });
});

describe("aiCacheKey", () => {
    test("按视频键缓存 (含分P)", () => {
        expect(aiCacheKey("BV1xxx?p=2")).toBe("bia:ai-cache:BV1xxx?p=2");
    });
});

describe("cleanupLegacyStorage", () => {
    test("删除旧格式缓存键与旧开关键, 保留新格式", async () => {
        backing.set("bia:ai-cache:BV1old:123:model", {});
        backing.set("bia:ai-cache:BV1new?p=1", {});
        backing.set("bia:ad-skip-enabled", true);
        backing.set("bia:task-toggles", {});
        // 清理遍历的是水合后的内存快照, 需先 hydrate
        await storageHydrate();
        cleanupLegacyStorage();
        expect(backing.has("bia:ai-cache:BV1old:123:model")).toBe(false);
        expect(backing.has("bia:ad-skip-enabled")).toBe(false);
        expect(backing.has("bia:task-toggles")).toBe(false);
        expect(backing.has("bia:ai-cache:BV1new?p=1")).toBe(true);
    });
});

describe("getFeatureSettings", () => {
    test("默认值全开 + jump", () => {
        const features = getFeatureSettings();
        expect(features.autoSummary).toBe(true);
        expect(features.detectAds).toBe(true);
        expect(features.autoSkipAds).toBe(true);
        expect(features.clickAction).toBe("jump");
    });
});
