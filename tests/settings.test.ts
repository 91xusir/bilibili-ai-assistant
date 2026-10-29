import { beforeEach, describe, expect, test } from "bun:test";
import {
    aiCacheKey,
    getFeatureSettings,
    isCacheExpired,
    resolveTaskPlan,
} from "../src/config/settings";
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
        adMinDuration: 5,
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

    test("关广告识别 → 仅总结", () => {
        const plan = resolveTaskPlan({ ...base, detectAds: false });
        expect(plan.mode).toBe("summary");
        expect(plan.summary).toBe(true);
        expect(plan.ads).toBe(false);
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

describe("getFeatureSettings", () => {
    test("默认值全开 + jump", () => {
        const features = getFeatureSettings();
        expect(features.autoSummary).toBe(true);
        expect(features.detectAds).toBe(true);
        expect(features.autoSkipAds).toBe(true);
        expect(features.clickAction).toBe("jump");
    });
});
