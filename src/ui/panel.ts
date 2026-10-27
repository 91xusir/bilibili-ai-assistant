import { getAiSettings, getClickAction, getFeatureSettings } from "../config/settings";
import type {
    AdSegment,
    SubtitleDoc,
    SummaryResult,
    TabId,
    TaskId,
    TaskState,
} from "../types";
import { el, type Phase } from "./common";
import { renderSummaryView } from "./summaryView";
import { showToast } from "./toast";
import { renderTimelineView, type TimelineHandle } from "./timelineView";

const ICON_AD_BLOCK =
    '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z"/></svg>';
const ICON_FOCUS =
    '<svg viewBox="0 0 24 24"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
const ICON_REFRESH =
    '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const ICON_EXPORT =
    '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';

export interface PanelCallbacks {
    onSeek: (time: number) => void;
    /** 复制文本到剪贴板 (点击行为设置为"复制"时) */
    onCopyText: (text: string) => void;
    /** ⟳ 悬浮按钮: 重新生成 (总结 + 按计划附带广告) */
    onRefresh: () => void;
    /** 时间轴页「识别广告」按钮: 仅跑广告识别 */
    onDetectAds: () => void;
    /** 导出菜单项: 导出视频总结 Markdown */
    onExport: () => void;
    /** 头部 ⊘ 按钮: 切换自动跳过广告 */
    onAdSkipToggle: (enabled: boolean) => void;
    /** 广告横幅「跳过」按钮: seek 到片段结束 */
    onAdBannerSkip: (seekTarget: number) => void;
}

const TASK_IDS: TaskId[] = ["summary", "ads"];
const AD_BANNER_DURATION = 10_000;

export class Panel {
    private root: HTMLElement | null = null;
    private viewRoots: Partial<Record<TabId, HTMLElement>> = {};
    private tabButtons: Partial<Record<TabId, HTMLButtonElement>> = {};
    private fabStack: HTMLElement | null = null;
    private refreshFab: HTMLButtonElement | null = null;
    private exportMenu: HTMLElement | null = null;
    private exportItem: HTMLButtonElement | null = null;
    private adBanner: HTMLElement | null = null;
    private adBannerText: HTMLElement | null = null;
    private adBannerTimer: ReturnType<typeof setTimeout> | null = null;
    /** 当前横幅提示的广告段 from (未显示 = -1) */
    private adBannerFrom = -1;
    private adButton: HTMLButtonElement | null = null;
    private followButton: HTMLButtonElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private timelineHandle: TimelineHandle | null = null;
    private activeTab: TabId = "summary";

    private phase: Phase = "loading";
    private phaseMessage = "";
    private doc: SubtitleDoc | null = null;
    private aiConfigured = false;
    private adSkipEnabled = getFeatureSettings().autoSkipAds;
    private followEnabled = true;
    private lastTimelineTime = -1;
    private programmaticScrollUntil = 0;
    private timelineRendered = false;
    private statusBar: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;
    private statusTimer: ReturnType<typeof setInterval> | null = null;
    private loadingSince = 0;
    private aiReceivedChars = 0;
    private lastPartialRender = 0;
    private tasks: Record<TaskId, TaskState> = {
        summary: { status: "idle" },
        ads: { status: "idle" },
    };
    private summary: SummaryResult | null = null;
    private ads: AdSegment[] = [];

    constructor(private callbacks: PanelCallbacks) {}

    get isMounted(): boolean {
        return this.root?.isConnected ?? false;
    }

    getSummary(): SummaryResult | null {
        return this.summary;
    }

    mount(parent: Element, before: Element | null): void {
        if (!this.root) this.build();
        if (!this.root) return;
        parent.insertBefore(this.root, before);
    }

    reset(): void {
        this.phase = "loading";
        this.phaseMessage = "";
        this.doc = null;
        this.summary = null;
        this.ads = [];
        this.timelineHandle = null;
        this.timelineRendered = false;
        this.lastTimelineTime = -1;
        this.setFollowState(true);
        this.tasks = {
            summary: { status: "idle" },
            ads: { status: "idle" },
        };
        this.hideAdConfirm();
        this.renderActive();
    }

    setSubtitleLoading(): void {
        this.phase = "loading";
        this.phaseMessage = "正在获取视频字幕...";
        this.doc = null;
        this.renderActive();
    }

    setSubtitleError(message: string): void {
        this.phase = "error";
        this.phaseMessage = message;
        this.renderActive();
    }

    setNoSubtitle(message: string): void {
        this.phase = "none";
        this.phaseMessage = message;
        this.doc = null;
        this.renderActive();
    }

    setDoc(doc: SubtitleDoc): void {
        this.doc = doc;
        this.phase = "ready";
        this.renderActive();
    }

    setAiConfigured(configured: boolean): void {
        if (this.aiConfigured === configured) return;
        this.aiConfigured = configured;
        this.renderActive();
    }

    /** 页面进入: 按 plan 置初始任务态. */
    setTasksInitial(plan: { summary: boolean; ads: boolean }): void {
        this.tasks = {
            summary: plan.summary ? { status: "idle" } : { status: "disabled" },
            ads: plan.ads ? { status: "idle" } : { status: "disabled" },
        };
        this.renderActive();
    }

    /** 开始生成: 仅把涉及的任务置 loading (手动单跑不影响另一任务). */
    startGenerating(scope: { summary: boolean; ads: boolean }): void {
        if (scope.summary) this.tasks.summary = { status: "loading" };
        if (scope.ads) this.tasks.ads = { status: "loading" };
        this.loadingSince = Date.now();
        this.aiReceivedChars = 0;
        this.renderActive();
    }

    get generating(): boolean {
        return TASK_IDS.some((id) => this.tasks[id].status === "loading");
    }

    /** 流式部分结果 (节流渲染, 避免每个 token 都重绘). */
    setSummaryPartial(result: SummaryResult): void {
        this.summary = result;
        this.aiReceivedChars = JSON.stringify(result).length;
        this.throttledRender();
    }

    setAdsPartial(segments: AdSegment[]): void {
        this.ads = segments;
        this.aiReceivedChars = Math.max(
            this.aiReceivedChars,
            JSON.stringify(segments).length,
        );
        this.throttledRender();
    }

    private throttledRender(): void {
        const now = Date.now();
        if (now - this.lastPartialRender < 400) return;
        this.lastPartialRender = now;
        this.renderActive();
    }

    setTaskError(task: TaskId, message: string): void {
        this.tasks[task] = { status: "error", error: message };
        this.renderActive();
    }

    setSummary(result: SummaryResult): void {
        this.summary = result;
        this.tasks.summary = { status: "done" };
        this.renderActive();
    }

    setAds(segments: AdSegment[]): void {
        this.ads = segments;
        this.tasks.ads = { status: "done" };
        this.renderActive();
    }

    /** 应用缓存结果: ads 为 null 表示该视频尚未识别过 (任务回到 idle). */
    applyResult(entry: {
        summary: SummaryResult | null;
        ads: AdSegment[] | null;
    }): void {
        this.summary = entry.summary;
        this.ads = entry.ads ?? [];
        if (entry.summary) this.tasks.summary = { status: "done" };
        if (entry.ads !== null) this.tasks.ads = { status: "done" };
        this.renderActive();
    }

    getAds(): AdSegment[] {
        return this.ads;
    }

    hasAds(): boolean {
        return this.ads.length > 0;
    }

    setAdSkipState(enabled: boolean): void {
        this.adSkipEnabled = enabled;
        if (this.adButton) {
            this.adButton.classList.toggle("bia-on", enabled);
            this.adButton.title = `自动跳过广告: ${enabled ? "已开启" : "已关闭 (播放到广告时提示)"}`;
        }
    }

    /** 弹窗/选项页修改设置后同步面板 (storage.onChanged → main → 这里). */
    syncSettings(): void {
        this.setAdSkipState(getFeatureSettings().autoSkipAds);
        this.renderActive();
    }

    setCurrentTime(time: number): void {
        this.lastTimelineTime = time;
        const handle = this.timelineHandle;
        if (!handle) return;
        const changed = handle.update(time);
        if (changed && this.followEnabled) this.scrollToCurrentRow();
    }

    /** 时间轴自动跟随播放滚动; 用户手动滚动时由 onBodyScroll 关闭. */
    setFollowState(enabled: boolean): void {
        this.followEnabled = enabled;
        if (this.followButton) {
            this.followButton.classList.toggle("bia-on", enabled);
            this.followButton.title = `自动聚焦当前字幕: ${enabled ? "已开启" : "已关闭"}`;
        }
    }

    private onBodyScroll(): void {
        if (Date.now() < this.programmaticScrollUntil) return;
        if (this.activeTab !== "timeline" || !this.followEnabled) return;
        this.setFollowState(false);
    }

    private scrollToCurrentRow(): void {
        const row = this.timelineHandle?.getRow();
        const body = this.bodyEl;
        if (!row || !body) return;
        const rowRect = row.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const margin = 12;
        if (
            rowRect.top < bodyRect.top + margin ||
            rowRect.bottom > bodyRect.bottom - margin
        ) {
            this.programmaticScrollUntil = Date.now() + 250;
            body.scrollTop +=
                rowRect.top -
                bodyRect.top -
                bodyRect.height / 2 +
                rowRect.height / 2;
        }
    }

    private switchTab(tab: TabId): void {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.renderActive();
    }

    private renderActive(): void {
        if (!this.viewRoots.summary || !this.tabButtons.summary) return;
        const tabs: TabId[] = ["summary", "timeline"];
        for (const tab of tabs) {
            this.viewRoots[tab]?.classList.toggle(
                "bia-active",
                tab === this.activeTab,
            );
            this.tabButtons[tab]?.classList.toggle(
                "bia-active",
                tab === this.activeTab,
            );
        }
        this.timelineHandle = null;
        this.timelineRendered = false;

        const generating = this.generating;
        if (this.activeTab === "summary") {
            renderSummaryView(this.viewRoots.summary!, {
                phase: this.phase,
                phaseMessage: this.phaseMessage,
                task: this.tasks.summary,
                aiConfigured: this.aiConfigured,
                doc: this.doc,
                summary: this.summary,
                clickAction: getClickAction(),
                onSeek: this.callbacks.onSeek,
                onCopy: this.callbacks.onCopyText,
            });
        } else {
            const wasRendered = this.timelineRendered;
            const prevScrollTop = this.bodyEl?.scrollTop ?? 0;
            const handle = renderTimelineView(this.viewRoots.timeline!, {
                phase: this.phase,
                phaseMessage: this.phaseMessage,
                doc: this.doc,
                ads: this.ads,
                adsTask: this.tasks.ads,
                clickAction: getClickAction(),
                generating,
                onSeek: this.callbacks.onSeek,
                onCopy: this.callbacks.onCopyText,
                onDetectAds: this.callbacks.onDetectAds,
            });
            this.timelineHandle = handle;
            this.timelineRendered = true;
            if (handle && this.lastTimelineTime >= 0) {
                handle.update(this.lastTimelineTime);
            }
            if (this.followEnabled) {
                this.scrollToCurrentRow();
            } else if (wasRendered && this.bodyEl) {
                // 广告等状态更新导致重渲染时, 保留用户手动滚动的位置
                this.programmaticScrollUntil = Date.now() + 250;
                this.bodyEl.scrollTop = prevScrollTop;
            }
        }
        this.updateLoadingBar();
    }

    private build(): void {
        const panel = el("section", "bia-panel");

        const header = el("header", "bia-header");
        const tabs = el("div", "bia-tabs");
        const tabDefs: { id: TabId; label: string }[] = [
            { id: "summary", label: "视频总结" },
            { id: "timeline", label: "时间轴" },
        ];
        for (const def of tabDefs) {
            const button = el(
                "button",
                "bia-tab",
                def.label,
            ) as HTMLButtonElement;
            button.type = "button";
            button.dataset.tab = def.id;
            button.addEventListener("click", () => this.switchTab(def.id));
            tabs.appendChild(button);
            this.tabButtons[def.id] = button;
        }

        const actions = el("div", "bia-actions");

        const followButton = el("button", "bia-icon-btn") as HTMLButtonElement;
        followButton.type = "button";
        followButton.innerHTML = ICON_FOCUS;
        followButton.addEventListener("click", () => {
            const next = !this.followEnabled;
            this.setFollowState(next);
            if (next) this.scrollToCurrentRow();
        });
        this.followButton = followButton;
        this.setFollowState(this.followEnabled);

        const adButton = el("button", "bia-icon-btn") as HTMLButtonElement;
        adButton.type = "button";
        adButton.innerHTML = ICON_AD_BLOCK;
        adButton.addEventListener("click", () => {
            const next = !this.adSkipEnabled;
            this.setAdSkipState(next);
            this.callbacks.onAdSkipToggle(next);
        });
        this.adButton = adButton;
        this.setAdSkipState(this.adSkipEnabled);

        actions.append(followButton, adButton);
        header.append(tabs, actions);

        // 广告确认横幅: 自动跳过关闭时, 播放到广告段提示是否跳过 (10s 自动关闭)
        this.adBanner = el("div", "bia-ad-banner");
        const bannerText = el("span", "bia-ad-banner-text");
        const bannerSkip = el(
            "button",
            "bia-btn bia-ad-banner-skip",
            "跳过",
        ) as HTMLButtonElement;
        bannerSkip.type = "button";
        bannerSkip.addEventListener("click", () => {
            const target = this.pendingSkipTarget;
            this.hideAdConfirm();
            if (target >= 0) this.callbacks.onAdBannerSkip(target);
        });
        this.adBannerText = bannerText;
        this.adBanner.append(bannerText, bannerSkip);

        const body = el("main", "bia-body");
        this.bodyEl = body;
        body.addEventListener("scroll", () => this.onBodyScroll());
        this.viewRoots = {
            summary: el("div", "bia-view bia-view-summary"),
            timeline: el("div", "bia-view bia-view-timeline"),
        };
        body.append(this.viewRoots.summary!, this.viewRoots.timeline!);

        panel.append(header, this.adBanner, body, this.buildStatusBar());

        // 右下角悬浮按钮组: 导出 + 重新生成 (统一 UI)
        const fabStack = el("div", "bia-fab-stack");
        fabStack.append(this.buildExportFab(), this.buildRefreshFab());
        this.fabStack = fabStack;
        panel.appendChild(fabStack);

        this.root = panel;
        this.renderActive();
        this.startAdaptiveObservers();
    }

    private buildRefreshFab(): HTMLButtonElement {
        const refreshFab = el("button", "bia-fab") as HTMLButtonElement;
        refreshFab.type = "button";
        refreshFab.title = "重新生成 (总结 + 广告识别)";
        refreshFab.innerHTML = ICON_REFRESH;
        refreshFab.addEventListener("click", () => this.callbacks.onRefresh());
        this.refreshFab = refreshFab;
        return refreshFab;
    }

    /** 导出悬浮钮: Popover API + invoker commands 菜单 (基线模式, 见 DEVELOPMENT.md). */
    private buildExportFab(): HTMLElement {
        const exportFab = el("button", "bia-fab") as HTMLButtonElement;
        exportFab.type = "button";
        exportFab.title = "导出";
        exportFab.innerHTML = ICON_EXPORT;
        exportFab.setAttribute("aria-haspopup", "menu");

        const menu = el("div", "bia-export-menu");
        menu.id = "bia-export-menu"; // commandfor 通过 id 关联
        menu.setAttribute("popover", "auto");
        const focusWrap = el("div", "bia-export-menu-inner");
        focusWrap.setAttribute("focusgroup", "menu nomemory");
        const item = el(
            "button",
            "bia-export-item",
            "导出视频总结 (.md)",
        ) as HTMLButtonElement;
        item.type = "button";
        item.disabled = true;
        item.addEventListener("click", () => {
            menu.hidePopover();
            this.callbacks.onExport();
        });
        focusWrap.appendChild(item);
        menu.appendChild(focusWrap);
        exportFab.setAttribute("commandfor", "bia-export-menu");
        exportFab.setAttribute("command", "toggle-popover");
        // 旧 Chrome 无 invoker commands: 退化为脚本开关 popover
        if (!("command" in HTMLButtonElement.prototype)) {
            exportFab.addEventListener("click", () => {
                if (menu.matches(":popover-open")) menu.hidePopover();
                else menu.showPopover();
            });
        }
        this.exportMenu = menu;
        this.exportItem = item;
        const wrap = el("div", "bia-export-wrap");
        wrap.append(exportFab, menu);
        return wrap;
    }

    /** 广告确认横幅: 同一广告段只提示一次; 10s 无操作自动关闭后同段不再打扰. */
    showAdConfirm(
        ad: AdSegment,
        skip: (seekTarget: number) => void,
    ): void {
        if (!this.adBanner || !this.adBannerText) return;
        if (this.adBannerFrom === ad.from) return; // 已在提示该片段
        if (this.dismissedAdFrom === ad.from) return; // 本段已被超时关闭, 离开段前不再弹出
        if (this.adBannerTimer !== null) clearTimeout(this.adBannerTimer);
        this.adBannerFrom = ad.from;
        this.adBannerText.textContent = `疑似检测到广告 ${Math.floor(ad.from)}s-${Math.floor(ad.to)}s, 是否跳过?`;
        this.adBanner.classList.add("bia-show");
        this.adBannerTimer = setTimeout(() => {
            this.dismissedAdFrom = this.adBannerFrom;
            this.adBannerTimer = null;
            this.adBannerFrom = -1;
            this.pendingSkipTarget = -1;
            this.adBanner?.classList.remove("bia-show");
        }, AD_BANNER_DURATION);
        this.pendingSkipTarget = ad.to + 0.2;
        this.adSkipResolve = skip;
    }

    private pendingSkipTarget = -1;
    private dismissedAdFrom = -1;
    private adSkipResolve: ((target: number) => void) | null = null;

    hideAdConfirm(): void {
        if (this.adBannerTimer !== null) {
            clearTimeout(this.adBannerTimer);
            this.adBannerTimer = null;
        }
        this.adBannerFrom = -1;
        this.dismissedAdFrom = -1;
        this.pendingSkipTarget = -1;
        this.adBanner?.classList.remove("bia-show");
    }

    getAdBannerFrom(): number {
        return this.adBannerFrom;
    }

    private buildStatusBar(): HTMLElement {
        const bar = el("div", "bia-statusbar");
        const spinner = el("div", "bia-spinner bia-sm");
        const text = el("span");
        bar.append(spinner, text);
        this.statusBar = bar;
        this.statusTextEl = text;
        return bar;
    }

    /** 状态栏: 有 AI 任务进行中时显示模型名/耗时/已生成字数; 生成中禁用 FAB. */
    private updateLoadingBar(): void {
        if (!this.statusBar || !this.statusTextEl) return;
        const anyLoading = this.generating;
        if (!anyLoading) {
            this.statusBar.classList.remove("bia-show");
            if (this.statusTimer !== null) {
                clearInterval(this.statusTimer);
                this.statusTimer = null;
            }
        }
        // 任务进行中: 悬浮按钮组上浮避开状态栏并旋转指示, 全部禁用
        this.fabStack?.classList.toggle("bia-above-bar", anyLoading);
        if (this.refreshFab) {
            this.refreshFab.disabled = anyLoading;
            this.refreshFab.classList.toggle("bia-spinning", anyLoading);
        }
        // 导出菜单项: 无总结时置灰
        if (this.exportItem) this.exportItem.disabled = !this.summary;
        if (!anyLoading) return;
        if (this.statusTimer === null) {
            this.statusTimer = setInterval(() => this.updateLoadingBar(), 1000);
        }
        const model = getAiSettings().model || "AI";
        const elapsed = Math.max(
            0,
            Math.round((Date.now() - this.loadingSince) / 1000),
        );
        const chars = this.aiReceivedChars;
        this.statusBar.classList.add("bia-show");
        this.statusTextEl.textContent = `AI 生成中 · ${model} · ${elapsed}s${
            chars > 0 ? ` · 已生成 ${chars} 字` : ""
        }`;
    }

    /** 跟随视频选集宽度 + 跟随 B站深浅色主题. */
    private startAdaptiveObservers(): void {
        const panel = this.root;
        if (!panel) return;

        const applyWidth = () => {
            // 选集容器宽度变化时同步面板宽度 (与弹幕列表等宽)
            const pod = document.querySelector(".video-pod-above-modules");
            if (pod) {
                const width = Math.round(pod.getBoundingClientRect().width);
                if (width > 0) {
                    panel.style.setProperty("--bia-panel-width", `${width}px`);
                }
            }
        };
        applyWidth();
        const resizeObserver = new ResizeObserver(applyWidth);
        const pod = document.querySelector(".video-pod-above-modules");
        if (pod) resizeObserver.observe(pod);

        // 主题跟随: B站深色标记在 <html> 上 (html.night-mode 存在即深色, 否则浅色)
        const applyTheme = () => {
            const isDark = document.documentElement.classList.contains(
                "night-mode",
            );
            panel.dataset.theme = isDark ? "dark" : "light";
        };
        applyTheme();
        const themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }
}
