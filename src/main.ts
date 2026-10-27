import { abortAllAiRequests } from "./api/ai";
import { getSubtitleDoc, getVideoId, videoKey } from "./api/bilibili";
import { detectAds } from "./ai/adDetect";
import { generateCombined, type CombinedScope } from "./ai/combined";
import { generateMindmap } from "./ai/mindmap";
import {
    buildTranscript,
    chunkTranscript,
    sectionsToTranscript,
} from "./ai/prompt";
import { generateSummary } from "./ai/summary";
import {
    aiCacheKey,
    getAdSkipEnabled,
    getAiSettings,
    getTaskToggles,
    isAiConfigured,
    isCacheExpired,
    isCombinedTasksEnabled,
    setAdSkipEnabled,
} from "./config/settings";
import { waitForElement } from "./core/dom";
import { storageDelete, storageGet, storageSet, storageHydrate } from "./core/storage";
import { onRouteChange } from "./core/route";
import { VideoBinder } from "./core/video";
import { formatTime } from "./subtitle";
import type {
    AdSegment,
    MindmapResult,
    SubtitleDoc,
    SummaryResult,
} from "./types";
import { Panel } from "./ui/panel";
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
    maybeSkipAd(time);
});

const panel = new Panel({
    onSeek: (time) => binder.seek(time),
    onRefresh: () => void refreshAi(true),
    onAdSkipToggle: (enabled) => {
        setAdSkipEnabled(enabled);
        showToast(enabled ? "已开启自动跳过广告" : "已关闭自动跳过广告");
    },
});

let runToken = 0;
let currentPageKey = "";
let currentDoc: SubtitleDoc | null = null;
let lastAdSkipTarget = -1;

/** 播放进入 AI 识别出的广告片段时自动 seek 到片段结束. */
function maybeSkipAd(time: number): void {
    if (!getAdSkipEnabled() || !panel.hasAds()) return;
    if (Math.abs(time - lastAdSkipTarget) < 0.5) return;
    const hit = panel
        .getAds()
        .find(
            (ad) =>
                time >= ad.from - 0.3 &&
                time < Math.max(ad.from + 0.5, ad.to - 0.5),
        );
    if (!hit) return;
    const target = hit.to + 0.2;
    lastAdSkipTarget = target;
    binder.seek(target);
    showToast(
        `已自动跳过广告 ${formatTime(hit.from)} - ${formatTime(hit.to)}`,
        "warn",
    );
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

interface AiCache {
    summary?: SummaryResult | null;
    mindmap?: MindmapResult | null;
    ads?: AdSegment[];
    savedAt?: number;
}

async function runAiTasks(
    token: number,
    doc: SubtitleDoc,
    force: boolean,
): Promise<void> {
    const settings = getAiSettings();
    const cacheKey = aiCacheKey(doc.bvid, doc.cid, settings.model);
    const cacheEnabled = settings.cacheEnabled !== false;
    const toggles = getTaskToggles();

    if (cacheEnabled && !force) {
        let cached = storageGet<AiCache | null>(cacheKey, null);
        // 到期自动删除
        if (
            cached &&
            isCacheExpired(cached.savedAt, settings.cacheTtlHours)
        ) {
            storageDelete(cacheKey);
            cached = null;
        }
        if (
            cached &&
            (cached.summary ||
                cached.mindmap ||
                (Array.isArray(cached.ads) && cached.ads.length > 0))
        ) {
            panel.applyResult(
                {
                    summary: cached.summary ?? null,
                    mindmap: cached.mindmap ?? null,
                    ads: Array.isArray(cached.ads) ? cached.ads : [],
                },
                toggles,
            );
            panel.setAiConfigured(true);
            return;
        }
    }

    if (!isAiConfigured()) {
        panel.setAiConfigured(false);
        panel.setTasksIdle(toggles);
        return;
    }
    panel.setAiConfigured(true);
    panel.setTasksLoading(toggles);

    const meta = {
        title: doc.title,
        upName: doc.upName,
        duration: doc.duration,
    };

    let summary: SummaryResult | null = null;
    let mindmap: MindmapResult | null = null;
    let ads: AdSegment[] = [];
    const scope = { summary: toggles.summary, mindmap: toggles.mindmap, ads: true };

    // 单次汇总: 一个请求产出广告+总结+导图 (Kimi = 一个会话; OpenAI = 一次调用)
    // 广告检测提示词在最前 → 流式最先返回, 无需等总结完成即可优先判断广告
    if (isCombinedTasksEnabled()) {
        try {
            const combined = await generateCombined(
                meta,
                buildTranscript(doc.items),
                doc.items,
                scope,
                (partial) => {
                    if (token !== runToken) return;
                    if (partial.sections || partial.overview) {
                        panel.setSummaryPartial({
                            overview: partial.overview ?? "",
                            sections: partial.sections ?? [],
                        });
                    }
                    if (partial.mindmapChildren) {
                        panel.setMindmapPartial({
                            title:
                                partial.mindmapTitle ?? meta.title,
                            children:
                                partial.mindmapChildren as MindmapResult["children"],
                        });
                    }
                    if (partial.ads) panel.setAds(partial.ads);
                },
            );
            if (token !== runToken) return;
            if (scope.summary) {
                summary = {
                    overview: combined.overview,
                    sections: combined.sections,
                };
                panel.setSummary(summary);
            }
            if (scope.mindmap) {
                mindmap = {
                    title: combined.mindmapTitle ?? meta.title,
                    children:
                        combined.mindmapChildren as MindmapResult["children"],
                };
                panel.setMindmap(mindmap);
            }
            ads = combined.ads;
            panel.setAds(ads);
        } catch (error) {
            if (token !== runToken) return;
            // 汇总失败 → 降级为分任务重试 (广告已在前面独立请求, 不重复)
            log("单次汇总失败, 降级为分任务重试:", errorMessage(error));
            const degraded = await runSeparateTasks(
                token,
                doc,
                meta,
                toggles,
                { ...scope, ads: false },
            );
            if (token !== runToken) return;
            summary = degraded.summary;
            mindmap = degraded.mindmap;
        }
    } else {
        const degraded = await runSeparateTasks(
            token,
            doc,
            meta,
            toggles,
            { ...scope, ads: false },
        );
        if (token !== runToken) return;
        summary = degraded.summary;
        mindmap = degraded.mindmap;
    }

    if (token !== runToken) return;

    if (cacheEnabled) {
        if (
            (toggles.summary && summary) ||
            (toggles.mindmap && mindmap) ||
            ads.length > 0
        ) {
            storageSet(cacheKey, {
                summary: toggles.summary ? summary : null,
                mindmap: toggles.mindmap ? mindmap : null,
                ads,
                savedAt: Date.now(),
            });
        }
    }
}

/** 分任务执行 (旧路径 / 汇总失败降级): 三任务按原顺序, 出错仅影响单任务. */
async function runSeparateTasks(
    token: number,
    doc: SubtitleDoc,
    meta: { title: string; upName: string; duration: number },
    toggles: { summary: boolean; mindmap: boolean },
    scope: CombinedScope,
): Promise<{
    summary: SummaryResult | null;
    mindmap: MindmapResult | null;
    ads: AdSegment[];
}> {
    let summary: SummaryResult | null = null;
    let mindmap: MindmapResult | null = null;
    let ads: AdSegment[] = [];

    const isStale = () => token !== runToken;

    const adsTask = detectAds(doc.items, meta)
        .then((result) => {
            ads = result;
            if (!isStale()) panel.setAds(result);
        })
        .catch((error) => {
            if (!isStale()) panel.setTaskError("ads", errorMessage(error));
        });

    if (toggles.summary && !isStale()) {
        try {
            summary = await generateSummary(doc.items, meta, (partial) => {
                if (!isStale()) panel.setSummaryPartial(partial);
            });
            if (!isStale()) panel.setSummary(summary);
        } catch (error) {
            if (!isStale()) panel.setTaskError("summary", errorMessage(error));
        }
    }

    if (toggles.mindmap && !isStale()) {
        try {
            const needsChunk =
                toggles.summary && chunkTranscript(doc.items).length > 1;
            const condensed =
                needsChunk && summary
                    ? sectionsToTranscript(summary.sections)
                    : null;
            mindmap = await generateMindmap(
                doc.items,
                meta,
                condensed,
                (partial) => {
                    if (!isStale()) panel.setMindmapPartial(partial);
                },
            );
            if (!isStale()) panel.setMindmap(mindmap);
        } catch (error) {
            if (!isStale()) panel.setTaskError("mindmap", errorMessage(error));
        }
    }

    await adsTask;
    return { summary, mindmap, ads };
}

async function refreshAi(force: boolean): Promise<void> {
    const doc = currentDoc;
    if (!doc || !doc.track) {
        showToast("字幕尚未加载, 无法生成", "warn");
        return;
    }
    if (!isAiConfigured()) {
        panel.openSettings();
        showToast("请先配置 AI 接口", "warn");
        return;
    }
    abortAllAiRequests();
    const token = ++runToken;
    if (force) {
        storageDelete(aiCacheKey(doc.bvid, doc.cid, getAiSettings().model));
    }
    await runAiTasks(token, doc, force);
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

    panel.setSubtitleLoading();
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
    panel.setDoc(doc);
    await runAiTasks(token, doc, false);
}

export async function main(): Promise<void> {
    // 水合 chrome.storage, 保证设置同步可读
    await storageHydrate();
    injectStyles();

    // 工具栏图标点击 → 打开「设置」标签页
    chrome.runtime.onMessage.addListener((msg: { kind?: string }) => {
        if (msg?.kind === "bia-open-settings") panel.openSettings();
    });

    binder.start();
    void handlePage();
    onRouteChange(() => void handlePage());
    log("已启动");
}
