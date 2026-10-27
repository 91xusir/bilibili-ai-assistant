import { abortAllAiRequests } from "./api/ai";
import { getSubtitleDoc, getVideoId, videoKey } from "./api/bilibili";
import { detectAds } from "./ai/adDetect";
import { findAdHit } from "./ai/adHit";
import { generateCombined } from "./ai/combined";
import { buildTranscript } from "./ai/prompt";
import { generateSummary } from "./ai/summary";
import {
    aiCacheKey,
    cleanupLegacyStorage,
    getAiSettings,
    getFeatureSettings,
    isAiConfigured,
    isCacheExpired,
    resolveTaskPlan,
    saveFeatureSettings,
} from "./config/settings";
import {
    cacheDeleteDoc,
    cacheGetDoc,
    cachePutDoc,
} from "./core/cache-port";
import { waitForElement } from "./core/dom";
import {
    storageDelete,
    storageGet,
    storageHydrate,
    storageSet,
    watchStorageChanges,
} from "./core/storage";
import { onRouteChange } from "./core/route";
import { VideoBinder } from "./core/video";
import { formatTime } from "./subtitle";
import type {
    AdSegment,
    AiCacheEntry,
    SubtitleDoc,
    SummaryResult,
} from "./types";
import { Panel } from "./ui/panel";
import { exportSummaryFile } from "./ui/exporters";
import { injectStyles } from "./ui/style";
import { showToast } from "./ui/toast";

const PREFIX = "[bia]";

function log(...args: unknown[]): void {
    console.info(PREFIX, ...args);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const binder = new VideoBinder((time) => {
    panel.setCurrentTime(time);
    maybeHandleAd(time);
});

const panel = new Panel({
    onSeek: (time) => binder.seek(time),
    onCopyText: (text) => void copyText(text),
    onRefresh: () => void refreshAi(),
    onDetectAds: () => void detectAdsNow(),
    onExport: exportSummary,
    onAdSkipToggle: (enabled) => {
        saveFeatureSettings({ autoSkipAds: enabled });
        if (!enabled) panel.hideAdConfirm();
        showToast(
            enabled
                ? "已开启自动跳过广告"
                : "已关闭自动跳过广告, 播放到广告时将提示确认",
        );
    },
    onAdBannerSkip: (target) => {
        lastAdSkipTarget = target;
        binder.seek(target);
    },
});

let runToken = 0;
let currentPageKey = "";
let currentDoc: SubtitleDoc | null = null;
let lastAdSkipTarget = -1;

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        showToast("已复制到剪贴板");
    } catch {
        showToast("复制失败", "error");
    }
}

function exportSummary(): void {
    const summary = panel.getSummary();
    if (!summary || !currentDoc) {
        showToast("总结尚未生成, 请先生成", "warn");
        return;
    }
    exportSummaryFile(currentDoc, summary);
    showToast("已导出视频总结 Markdown");
}

/**
 * 播放到广告片段:
 * - 自动跳过开启 → 直接 seek 到片段尾 + toast
 * - 关闭 → 面板横幅提示 (10s 自动关闭); 离开广告段自动收起
 */
function maybeHandleAd(time: number): void {
    const ads = panel.getAds();
    if (ads.length === 0) return;
    const hit = findAdHit(ads, time);
    if (!hit) {
        panel.hideAdConfirm();
        return;
    }
    if (getFeatureSettings().autoSkipAds) {
        if (Math.abs(time - lastAdSkipTarget) < 0.5) return;
        lastAdSkipTarget = hit.to + 0.2;
        panel.hideAdConfirm();
        binder.seek(lastAdSkipTarget);
        showToast(
            `已自动跳过广告 ${formatTime(hit.from)} - ${formatTime(hit.to)}`,
            "warn",
        );
    } else {
        panel.showAdConfirm(hit, (target) => binder.seek(target));
    }
}

/** 面板插入到右侧栏顶部 (弹幕列表上方), 与原时间轴脚本位置一致. */
async function ensurePanelMounted(): Promise<void> {
    if (panel.isMounted) return;
    const rightContainer = await waitForElement(".right-container");
    const inner = await waitForElement(".right-container-inner.scroll-sticky", {
        parent: rightContainer,
    });
    let before = inner.querySelector(".video-pod-above-modules");
    if (!before) {
        try {
            before = await waitForElement(".video-pod-above-modules", {
                parent: inner,
                timeout: 10_000,
            });
        } catch {
            before = null;
        }
    }
    panel.mount(inner, before);
}

// ---------------- 缓存 (总结/广告 → chrome.storage.local, 键 = videoKey) ----------------

function readCache(key: string): AiCacheEntry | null {
    const settings = getAiSettings();
    if (!settings.cacheEnabled) return null;
    let entry = storageGet<AiCacheEntry | null>(key, null);
    if (entry && isCacheExpired(entry.savedAt, settings.cacheTtlHours)) {
        storageDelete(key);
        entry = null;
    }
    return entry;
}

/** 写缓存: 只覆盖本次生成的部分, 未跑的任务保留旧值 (ads: null = 从未识别过). */
function writeCache(
    key: string,
    patch: { summary?: SummaryResult; adsRan?: boolean; ads?: AdSegment[] },
): void {
    if (!getAiSettings().cacheEnabled) return;
    const prev = storageGet<AiCacheEntry | null>(key, null);
    const next: AiCacheEntry = {
        summary: patch.summary ?? prev?.summary ?? null,
        ads: patch.adsRan ? (patch.ads ?? []) : (prev?.ads ?? null),
        savedAt: Date.now(),
    };
    storageSet(key, next);
}

// ---------------- AI 任务调度 ----------------

/** auto = 自动 (按 plan + 缓存补缺); refresh = ⟳ 重生成; ads-only = 时间轴手动识别广告. */
type RunMode = "auto" | "refresh" | "ads-only";

async function runAiTasks(
    token: number,
    doc: SubtitleDoc,
    pageKey: string,
    mode: RunMode,
): Promise<void> {
    const plan = resolveTaskPlan(getFeatureSettings());
    const cacheKey = aiCacheKey(pageKey);

    let needSummary: boolean;
    let needAds: boolean;
    if (mode === "refresh") {
        needSummary = true;
        needAds = plan.ads;
    } else if (mode === "ads-only") {
        needSummary = false;
        needAds = true;
    } else {
        const cached = readCache(cacheKey);
        if (cached) {
            panel.applyResult({
                summary: plan.summary ? cached.summary : null,
                ads: plan.ads ? cached.ads : null,
            });
        }
        needSummary = plan.summary && !cached?.summary;
        needAds = plan.ads && cached?.ads === null;
    }

    if (!needSummary && !needAds) {
        panel.setAiConfigured(isAiConfigured());
        return;
    }
    if (!isAiConfigured()) {
        panel.setAiConfigured(false);
        return;
    }
    panel.setAiConfigured(true);
    panel.startGenerating({ summary: needSummary, ads: needAds });

    const meta = {
        title: doc.title,
        upName: doc.upName,
        duration: doc.duration,
    };
    let summary: SummaryResult | null = null;
    let ads: AdSegment[] | null = null;

    // 合并请求: 总结 + 广告一次完成, 广告提示词最前 → 流式最先返回广告
    if (needSummary && needAds) {
        try {
            const combined = await generateCombined(
                meta,
                buildTranscript(doc.items),
                doc.items,
                { summary: true, ads: true },
                (partial) => {
                    if (token !== runToken) return;
                    if (partial.sections || partial.overview) {
                        panel.setSummaryPartial({
                            overview: partial.overview ?? "",
                            sections: partial.sections ?? [],
                        });
                    }
                    if (partial.ads) panel.setAdsPartial(partial.ads);
                },
            );
            if (token !== runToken) return;
            summary = {
                overview: combined.overview,
                sections: combined.sections,
            };
            ads = combined.ads;
            panel.setSummary(summary);
            panel.setAds(ads);
        } catch (error) {
            if (token !== runToken) return;
            log("合并请求失败, 降级为分任务:", errorMessage(error));
            summary = null;
            ads = null;
        }
    }

    // 分任务路径 (单任务模式或合并失败降级): 广告在前, 优先出结果
    if (ads === null && needAds && token === runToken) {
        try {
            ads = await detectAds(doc.items, meta);
            if (token !== runToken) return;
            panel.setAds(ads);
        } catch (error) {
            if (token !== runToken) return;
            panel.setTaskError("ads", errorMessage(error));
        }
    }
    if (summary === null && needSummary && token === runToken) {
        try {
            summary = await generateSummary(doc.items, meta, (partial) => {
                if (token !== runToken) return;
                panel.setSummaryPartial(partial);
            });
            if (token !== runToken) return;
            panel.setSummary(summary);
        } catch (error) {
            if (token !== runToken) return;
            panel.setTaskError("summary", errorMessage(error));
        }
    }

    if (token !== runToken) return;
    writeCache(cacheKey, {
        summary: summary ?? undefined,
        adsRan: ads !== null,
        ads: ads ?? undefined,
    });
}

/** ⟳ 重新生成: 总结必跑 (手动覆盖 autoSummary), 广告按 plan 附带. */
async function refreshAi(): Promise<void> {
    const doc = currentDoc;
    if (!doc || !doc.track) {
        showToast("字幕尚未加载, 无法生成", "warn");
        return;
    }
    if (!isAiConfigured()) {
        showToast("请先在选项页配置 AI 接口", "warn");
        void chrome.runtime.openOptionsPage();
        return;
    }
    abortAllAiRequests();
    const token = ++runToken;
    await runAiTasks(token, doc, currentPageKey, "refresh");
}

/** 时间轴页「识别广告」: 仅跑广告识别. */
async function detectAdsNow(): Promise<void> {
    const doc = currentDoc;
    if (!doc || !doc.track) {
        showToast("字幕尚未加载, 无法识别", "warn");
        return;
    }
    if (!isAiConfigured()) {
        showToast("请先在选项页配置 AI 接口", "warn");
        void chrome.runtime.openOptionsPage();
        return;
    }
    abortAllAiRequests();
    const token = ++runToken;
    await runAiTasks(token, doc, currentPageKey, "ads-only");
}

async function handlePage(): Promise<void> {
    const videoId = getVideoId();
    if (!videoId) return;
    const key = videoKey(videoId);
    if (key === currentPageKey) {
        // 同一视频: 若面板被 B 站 SPA 重建时移除了 DOM, 只需重新挂载
        if (!panel.isMounted) {
            try {
                await ensurePanelMounted();
            } catch {
                /* ignore */
            }
        }
        return;
    }
    currentPageKey = key;

    const token = ++runToken;
    abortAllAiRequests();
    panel.reset();
    binder.start();

    try {
        await ensurePanelMounted();
    } catch (error) {
        log("面板挂载失败:", error);
        return;
    }
    if (token !== runToken) return;

    const plan = resolveTaskPlan(getFeatureSettings());
    panel.setTasksInitial({ summary: plan.summary, ads: plan.ads });
    panel.setSubtitleLoading();

    // 字幕缓存 (SW 侧扩展源 IndexedDB, 与总结缓存同键同 TTL)
    const settings = getAiSettings();
    if (settings.cacheEnabled) {
        const hit = await cacheGetDoc(key);
        if (hit && isCacheExpired(hit.savedAt, settings.cacheTtlHours)) {
            void cacheDeleteDoc(key);
        } else if (hit) {
            if (token !== runToken) return;
            currentDoc = hit.doc;
            panel.setDoc(hit.doc);
            void runAiTasks(token, hit.doc, key, "auto");
            return;
        }
    }

    let doc: SubtitleDoc;
    try {
        doc = await getSubtitleDoc(videoId);
    } catch (error) {
        if (token !== runToken) return;
        panel.setSubtitleError(errorMessage(error));
        return;
    }
    if (token !== runToken) return;

    currentDoc = doc;
    if (!doc.track || doc.items.length === 0) {
        panel.setNoSubtitle(
            "该视频没有可用的 CC 字幕\n无法进行 AI 分析与时间轴展示",
        );
        return;
    }
    if (settings.cacheEnabled) void cachePutDoc(key, doc);
    panel.setDoc(doc);
    await runAiTasks(token, doc, key, "auto");
}

export async function main(): Promise<void> {
    // 水合 chrome.storage, 保证设置同步可读
    await storageHydrate();
    cleanupLegacyStorage();
    injectStyles();

    // 弹窗/选项页修改设置后, 内容脚本实时同步 (内存缓存 + 面板状态)
    watchStorageChanges();
    chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "local") panel.syncSettings();
    });

    binder.start();
    // 页面进入 bfcache / 卸载时主动断开后台端口, 避免 "message channel is closed" 报错
    window.addEventListener("pagehide", () => abortAllAiRequests());
    void handlePage();
    onRouteChange(() => void handlePage());
    log("已启动");
}
