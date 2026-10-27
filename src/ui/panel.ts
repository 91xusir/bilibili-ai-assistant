import type { MindmapResult } from "../ai/mindmap";
import { fetchModelList, testAiConnection } from "../api/ai";
import { kimiAuthBootstrap } from "../core/kimi-port";
import {
    getAdSkipEnabled,
    getAiSettings,
    getTaskToggles,
    saveAiSettings,
    saveTaskToggles,
} from "../config/settings";
import type {
    AdSegment,
    SubtitleDoc,
    SummaryResult,
    TabId,
    TaskId,
    TaskState,
    TaskToggles,
    AiProvider,
} from "../types";
import { el, type Phase } from "./common";
import { renderMindmapView } from "./mindmapView";
import { renderSummaryView } from "./summaryView";
import { showToast } from "./toast";
import { renderTimelineView, type TimelineHandle } from "./timelineView";

const ICON_AD_BLOCK =
    '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z"/></svg>';
const ICON_FOCUS =
    '<svg viewBox="0 0 24 24"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
const ICON_REFRESH =
    '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';

export interface PanelCallbacks {
    onSeek: (time: number) => void;
    onRefresh: () => void;
    onAdSkipToggle: (enabled: boolean) => void;
}

const TASK_IDS: TaskId[] = ["summary", "mindmap", "ads"];

export class Panel {
    private root: HTMLElement | null = null;
    private viewRoots: Record<TabId, HTMLElement> | null = null;
    private tabButtons: Record<TabId, HTMLButtonElement> | null = null;
    private refreshFab: HTMLButtonElement | null = null;
    private adButton: HTMLButtonElement | null = null;
    private followButton: HTMLButtonElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private timelineHandle: TimelineHandle | null = null;
    private activeTab: TabId = "summary";

    private phase: Phase = "loading";
    private phaseMessage = "";
    private doc: SubtitleDoc | null = null;
    private aiConfigured = false;
    private adSkipEnabled = getAdSkipEnabled();
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
    private modelOptions: string[] = [];
    private tasks: Record<TaskId, TaskState> = {
        summary: { status: "idle" },
        mindmap: { status: "idle" },
        ads: { status: "idle" },
    };
    private summary: SummaryResult | null = null;
    private mindmap: MindmapResult | null = null;
    private ads: AdSegment[] = [];

    constructor(private callbacks: PanelCallbacks) {}

    get isMounted(): boolean {
        return this.root?.isConnected ?? false;
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
        this.mindmap = null;
        this.ads = [];
        this.timelineHandle = null;
        this.timelineRendered = false;
        this.lastTimelineTime = -1;
        this.setFollowState(true);
        this.tasks = {
            summary: { status: "idle" },
            mindmap: { status: "idle" },
            ads: { status: "idle" },
        };
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

    setTasksLoading(toggles?: TaskToggles): void {
        this.tasks = {
            summary:
                toggles?.summary === false
                    ? { status: "disabled" }
                    : { status: "loading" },
            mindmap:
                toggles?.mindmap === false
                    ? { status: "disabled" }
                    : { status: "loading" },
            ads: { status: "loading" },
        };
        this.loadingSince = Date.now();
        this.aiReceivedChars = 0;
        this.renderActive();
    }

    setTasksIdle(toggles?: TaskToggles): void {
        this.tasks = {
            summary:
                toggles?.summary === false
                    ? { status: "disabled" }
                    : { status: "idle" },
            mindmap:
                toggles?.mindmap === false
                    ? { status: "disabled" }
                    : { status: "idle" },
            ads: { status: "idle" },
        };
        this.renderActive();
    }

    /** 流式部分结果 (节流渲染, 避免每个 token 都重绘). */
    setSummaryPartial(result: SummaryResult): void {
        this.summary = result;
        this.aiReceivedChars = JSON.stringify(result).length;
        this.throttledRender();
    }

    setMindmapPartial(result: MindmapResult): void {
        this.mindmap = result;
        this.aiReceivedChars = JSON.stringify(result).length;
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

    setMindmap(result: MindmapResult): void {
        this.mindmap = result;
        this.tasks.mindmap = { status: "done" };
        this.renderActive();
    }

    setAds(segments: AdSegment[]): void {
        this.ads = segments;
        this.tasks.ads = { status: "done" };
        this.renderActive();
    }

    applyResult(
        result: {
            summary: SummaryResult | null;
            mindmap: MindmapResult | null;
            ads: AdSegment[];
        },
        toggles?: TaskToggles,
    ): void {
        // 已在设置中关闭的任务不应用缓存内容
        this.summary = toggles?.summary === false ? null : result.summary;
        this.mindmap = toggles?.mindmap === false ? null : result.mindmap;
        this.ads = result.ads;
        this.tasks = {
            summary:
                toggles?.summary === false
                    ? { status: "disabled" }
                    : { status: "done" },
            mindmap:
                toggles?.mindmap === false
                    ? { status: "disabled" }
                    : { status: "done" },
            ads: { status: "done" },
        };
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
            this.adButton.title = `自动跳过广告: ${enabled ? "已开启" : "已关闭"}`;
        }
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

    /** 打开 AI 设置: 直接切到「设置」标签页 (不再使用弹窗). */
    openSettings(): void {
        if (!this.root) return;
        this.switchTab("settings");
    }

    private switchTab(tab: TabId): void {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.renderActive();
    }

    private renderActive(): void {
        if (!this.viewRoots || !this.tabButtons) return;
        for (const tab of [
            "summary",
            "mindmap",
            "timeline",
            "settings",
        ] as TabId[]) {
            this.viewRoots[tab].classList.toggle(
                "bia-active",
                tab === this.activeTab,
            );
            this.tabButtons[tab].classList.toggle(
                "bia-active",
                tab === this.activeTab,
            );
        }
        this.timelineHandle = null;
        this.timelineRendered = false;

        if (this.activeTab === "summary") {
            renderSummaryView(this.viewRoots.summary, {
                phase: this.phase,
                phaseMessage: this.phaseMessage,
                task: this.tasks.summary,
                aiConfigured: this.aiConfigured,
                doc: this.doc,
                summary: this.summary,
                onSeek: this.callbacks.onSeek,
            });
        } else if (this.activeTab === "mindmap") {
            renderMindmapView(this.viewRoots.mindmap, {
                phase: this.phase,
                phaseMessage: this.phaseMessage,
                task: this.tasks.mindmap,
                aiConfigured: this.aiConfigured,
                doc: this.doc,
                mindmap: this.mindmap,
                onSeek: this.callbacks.onSeek,
            });
        } else if (this.activeTab === "timeline") {
            const wasRendered = this.timelineRendered;
            const prevScrollTop = this.bodyEl?.scrollTop ?? 0;
            const handle = renderTimelineView(this.viewRoots.timeline, {
                phase: this.phase,
                phaseMessage: this.phaseMessage,
                doc: this.doc,
                ads: this.ads,
                onSeek: this.callbacks.onSeek,
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
        this.tabButtons = {
            summary: null!,
            mindmap: null!,
            timeline: null!,
            settings: null!,
        };
        const tabDefs: { id: TabId; label: string }[] = [
            { id: "summary", label: "视频总结" },
            { id: "mindmap", label: "思维导图" },
            { id: "timeline", label: "时间轴" },
            { id: "settings", label: "设置" },
        ];
        for (const def of tabDefs) {
            const button = el("button", "bia-tab", def.label) as HTMLButtonElement;
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

        // 刷新入口: 右下角浮动圆钮 (不再放在头部)
        const refreshFab = el(
            "button",
            "bia-refresh-fab",
        ) as HTMLButtonElement;
        refreshFab.type = "button";
        refreshFab.title = "重新生成 AI 分析";
        refreshFab.innerHTML = ICON_REFRESH;
        refreshFab.addEventListener("click", () => this.callbacks.onRefresh());
        this.refreshFab = refreshFab;

        // 设置入口统一为顶部「设置」标签页, 不再放齿轮图标 (避免重复入口)
        actions.append(followButton, adButton);
        header.append(tabs, actions);

        const body = el("main", "bia-body");
        this.bodyEl = body;
        body.addEventListener("scroll", () => this.onBodyScroll());
        this.viewRoots = {
            summary: el("div", "bia-view bia-view-summary"),
            mindmap: el("div", "bia-view bia-view-mindmap"),
            timeline: el("div", "bia-view bia-view-timeline"),
            settings: el("div", "bia-view bia-view-settings"),
        };
        body.append(
            this.viewRoots.summary,
            this.viewRoots.mindmap,
            this.viewRoots.timeline,
            this.viewRoots.settings,
        );
        this.buildSettingsView(this.viewRoots.settings);

        panel.append(header, body, this.buildStatusBar());
        panel.appendChild(this.refreshFab!);

        this.root = panel;
        this.renderActive();
        this.startAdaptiveObservers();
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

    private buildSwitchRow(
        label: string,
        desc: string,
        initial: boolean,
        onChange: (value: boolean) => void,
    ): HTMLElement {
        const row = el("div", "bia-switch-row");
        const text = el("div", "bia-switch-text");
        text.appendChild(el("span", "bia-switch-label", label));
        if (desc) text.appendChild(el("span", "bia-switch-desc", desc));
        const button = el("button", "bia-switch") as HTMLButtonElement;
        button.type = "button";
        button.setAttribute("role", "switch");
        button.appendChild(el("span", "bia-switch-knob"));
        const render = () =>
            button.classList.toggle("bia-on", button.dataset.on === "1");
        button.dataset.on = initial ? "1" : "0";
        render();
        button.addEventListener("click", () => {
            button.dataset.on = button.dataset.on === "1" ? "0" : "1";
            render();
            onChange(button.dataset.on === "1");
        });
        row.append(text, button);
        return row;
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

    /** 状态栏: 有 AI 任务进行中时显示模型名/耗时/已生成字数. */
    private updateLoadingBar(): void {
        if (!this.statusBar || !this.statusTextEl) return;
        const anyLoading = TASK_IDS.some(
            (id) => this.tasks[id].status === "loading",
        );
        if (!anyLoading) {
            this.statusBar.classList.remove("bia-show");
            if (this.statusTimer !== null) {
                clearInterval(this.statusTimer);
                this.statusTimer = null;
            }
        }
        // 任务进行中: 浮动刷新钮上浮避开状态栏并旋转指示
        this.refreshFab?.classList.toggle("bia-above-bar", anyLoading);
        this.refreshFab?.classList.toggle("bia-spinning", anyLoading);
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

    /** 「设置」标签页内容: 只构建一次, 切换标签/刷新状态不会重置表单. */
    private buildSettingsView(container: HTMLElement): void {
        container.appendChild(el("div", "bia-modal-title", "AI 设置"));
        container.appendChild(
            el(
                "div",
                "bia-modal-desc",
                "默认使用 Kimi 网页版 (免 API Key, 复用 kimi.com 登录态); 也可切换为 OpenAI 兼容接口。API Key 仅保存在本地。",
            ),
        );

        // AI 任务开关 (即时保存)
        container.appendChild(el("div", "bia-modal-title", "AI 任务"));
        const toggles = getTaskToggles();
        container.appendChild(
            this.buildSwitchRow(
                "生成视频总结",
                "关闭后「视频总结」页不再生成内容",
                toggles.summary,
                (value) => {
                    saveTaskToggles({ ...getTaskToggles(), summary: value });
                    showToast(
                        value ? "已开启视频总结" : "已关闭视频总结, 点击 ⟳ 重新生成",
                    );
                },
            ),
        );
        container.appendChild(
            this.buildSwitchRow(
                "生成思维导图",
                "关闭后「思维导图」页不再生成内容",
                toggles.mindmap,
                (value) => {
                    saveTaskToggles({ ...getTaskToggles(), mindmap: value });
                    showToast(
                        value ? "已开启思维导图" : "已关闭思维导图, 点击 ⟳ 重新生成",
                    );
                },
            ),
        );
        // 单次汇总: 关闭则三任务分别请求 (Kimi 会多建会话 / OpenAI 多次调用)
        container.appendChild(
            this.buildSwitchRow(
                "单次汇总 (一次请求生成全部)",
                "开启时总结/导图/广告由一个请求完成: Kimi 只建一个会话",
                getAiSettings().combinedTasks !== false,
                (value) => {
                    saveAiSettings({ combinedTasks: value });
                    showToast(
                        value
                            ? "已开启单次汇总, 点击 ⟳ 重新生成"
                            : "已关闭单次汇总, 三任务将分别请求",
                    );
                },
            ),
        );
        container.appendChild(el("div", "bia-modal-title", "AI 服务商"));
        const providerRow = el("div", "bia-provider-row");
        const kimiProviderButton = el(
            "button",
            "bia-provider-btn",
            "Kimi 网页版 (默认)",
        ) as HTMLButtonElement;
        const openaiProviderButton = el(
            "button",
            "bia-provider-btn",
            "OpenAI 兼容接口",
        ) as HTMLButtonElement;
        kimiProviderButton.type = "button";
        openaiProviderButton.type = "button";
        providerRow.append(kimiProviderButton, openaiProviderButton);
        let provider: AiProvider =
            getAiSettings().provider === "openai" ? "openai" : "kimi";

        // Kimi 授权块
        const kimiBox = el("div");
        const kimiStatus = el(
            "div",
            "bia-kimi-status",
            "Kimi 授权状态: 未知 (点击下方按钮获取)",
        );
        const authButton = el("button", "bia-btn", "重新获取授权") as HTMLButtonElement;
        authButton.type = "button";
        authButton.addEventListener("click", () => {
            kimiStatus.textContent = "正在获取授权 (可能打开 kimi.com 页面)...";
            void kimiAuthBootstrap().then((result) => {
                kimiStatus.textContent = result.ok
                    ? `Kimi 授权已就绪 (refresh_token ${result.hasRefreshToken ? "✓" : "✗"})`
                    : `授权失败: ${result.error ?? "未知"}`;
            });
        });
        const openKimiButton = el(
            "button",
            "bia-btn",
            "打开 kimi.com 登录",
        ) as HTMLButtonElement;
        openKimiButton.type = "button";
        openKimiButton.addEventListener("click", () => {
            window.open("https://www.kimi.com/", "_blank");
        });
        const kimiButtonRow = el("div", "bia-kimi-button-row");
        kimiButtonRow.append(authButton, openKimiButton);
        kimiBox.append(
            kimiStatus,
            kimiButtonRow,
            el(
                "div",
                "bia-modal-desc",
                "无需 API Key, 直接使用 kimi.com 网页登录态 (每次任务会创建独立的 kimi 会话)。首次使用请先在浏览器登录 kimi.com。",
            ),
        );

        // OpenAI 兼容配置块
        const openAiBox = el("div");
        container.append(providerRow, kimiBox, openAiBox);

        const makeField = (
            label: string,
            placeholder: string,
            type: string,
            secret = false,
        ): HTMLInputElement => {
            const field = el("label", "bia-field", label);
            const input = el("input", "bia-input") as HTMLInputElement;
            input.type = type;
            input.placeholder = placeholder;
            input.autocomplete = "off";
            input.spellcheck = false;
            // 不用 type=password: 避免浏览器密码管理器弹出"保存密码"
            if (secret) input.classList.add("bia-secret");
            field.appendChild(input);
            openAiBox.appendChild(field);
            return input;
        };
        const baseUrl = makeField("接口地址 Base URL", "https://api.openai.com/v1", "text");
        const apiKey = makeField("API Key (本地服务可留空)", "sk-...", "text", true);

        // 模型行: 输入框 + 自定义下拉 (datalist 会按当前值过滤, 必须清空才能看到全部)
        // 注意这里用 div 而不是 label: label 会把下拉选项的点击转发给输入框, 导致下拉关不掉
        const modelField = el("div", "bia-field");
        modelField.appendChild(el("span", undefined, "模型名称"));
        const modelRow = el("div", "bia-model-row");
        const modelWrap = el("div", "bia-model-wrap");
        const model = el("input", "bia-input") as HTMLInputElement;
        model.type = "text";
        model.placeholder = "glm-4.6 / deepseek-chat / gpt-4o-mini";
        model.autocomplete = "off";
        model.spellcheck = false;
        const modelDropdown = el("div", "bia-model-dropdown");
        const modelClear = el(
            "button",
            "bia-model-clear",
            "×",
        ) as HTMLButtonElement;
        modelClear.type = "button";
        modelClear.title = "清空模型名称";
        modelWrap.append(model, modelClear, modelDropdown);
        const fetchModelsButton = el(
            "button",
            "bia-btn bia-model-btn",
            "获取列表",
        ) as HTMLButtonElement;
        fetchModelsButton.type = "button";
        fetchModelsButton.title = "从上游接口拉取模型列表 (GET /models)";

        const renderModelDropdown = (filter: string) => {
            modelDropdown.innerHTML = "";
            const value = filter.trim().toLowerCase();
            let list = this.modelOptions;
            if (value) {
                const filtered = list.filter((id) =>
                    id.toLowerCase().includes(value),
                );
                if (filtered.length > 0) list = filtered; // 无匹配则显示全部
            }
            for (const id of list) {
                const item = el("div", "bia-model-item", id);
                if (id === model.value) item.classList.add("bia-current");
                item.addEventListener("click", () => {
                    model.value = id;
                    updateClearButton();
                    closeModelDropdown();
                });
                modelDropdown.appendChild(item);
            }
            modelDropdown.classList.toggle("bia-open", list.length > 0);
        };
        const closeModelDropdown = () =>
            modelDropdown.classList.remove("bia-open");
        const openModelDropdown = () => renderModelDropdown(model.value);

        const updateClearButton = () =>
            modelWrap.classList.toggle("has-value", model.value.length > 0);
        modelClear.addEventListener("click", () => {
            model.value = "";
            updateClearButton();
            renderModelDropdown("");
            model.focus();
        });
        model.addEventListener("focus", openModelDropdown);
        model.addEventListener("click", openModelDropdown);
        model.addEventListener("input", () => {
            updateClearButton();
            renderModelDropdown(model.value);
        });
        model.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeModelDropdown();
        });
        document.addEventListener("click", (event) => {
            if (!modelWrap.contains(event.target as Node)) closeModelDropdown();
        });

        fetchModelsButton.addEventListener("click", () => {
            saveAiSettings({
                provider,
                baseUrl: baseUrl.value.trim(),
                apiKey: apiKey.value.trim(),
                model: model.value.trim(),
                reasoningEffort: effortSelect.value,
                cacheTtlHours: getAiSettings().cacheTtlHours,
            });
            fetchModelsButton.textContent = "获取中...";
            testResult.className = "bia-test-result";
            fetchModelList()
                .then((ids) => {
                    this.modelOptions = ids;
                    testResult.textContent = `已加载 ${ids.length} 个模型, 点击输入框可选`;
                    testResult.classList.add("bia-test-ok");
                    openModelDropdown();
                })
                .catch((error) => {
                    testResult.textContent =
                        error instanceof Error ? error.message : String(error);
                    testResult.classList.add("bia-test-fail");
                })
                .finally(() => {
                    setTimeout(() => {
                        fetchModelsButton.textContent = "获取列表";
                    }, 2500);
                });
        });
        modelRow.append(modelWrap, fetchModelsButton);
        modelField.appendChild(modelRow);
        openAiBox.appendChild(modelField);

        // 思考等级: 设置则发送标准 reasoning_effort, 不设置则关闭思考模式
        const effortField = el("label", "bia-field", "思考等级 (reasoning effort)");
        const effortSelect = el("select", "bia-input") as HTMLSelectElement;
        const effortOptions: { value: string; label: string }[] = [
            { value: "", label: "关闭思考模式 (默认)" },
            { value: "low", label: "低 (low)" },
            { value: "medium", label: "中 (medium)" },
            { value: "high", label: "高 (high)" },
        ];
        for (const item of effortOptions) {
            const option = el("option");
            option.value = item.value;
            option.textContent = item.label;
            effortSelect.appendChild(option);
        }
        effortField.appendChild(effortSelect);
        openAiBox.appendChild(effortField);

        const testRow = el("div", "bia-test-row");
        const testButton = el("button", "bia-btn", "测试连接") as HTMLButtonElement;
        testButton.type = "button";
        const testResult = el("span", "bia-test-result");
        testButton.addEventListener("click", () => {
            // 先保存表单当前值, 便于测试未保存的配置
            saveAiSettings({
                provider,
                baseUrl: baseUrl.value.trim(),
                apiKey: apiKey.value.trim(),
                model: model.value.trim(),
                reasoningEffort: effortSelect.value,
                cacheTtlHours: getAiSettings().cacheTtlHours,
            });
            testResult.className = "bia-test-result";
            testResult.textContent = "测试中...";
            testAiConnection()
                .then((reply) => {
                    testResult.textContent = `连接成功: ${reply || "OK"}`;
                    testResult.classList.add("bia-test-ok");
                })
                .catch((error) => {
                    testResult.textContent =
                        error instanceof Error ? error.message : String(error);
                    testResult.classList.add("bia-test-fail");
                });
        });
        testRow.append(testButton, testResult);
        container.appendChild(testRow);

        const renderProvider = () => {
            kimiProviderButton.classList.toggle(
                "bia-active",
                provider === "kimi",
            );
            openaiProviderButton.classList.toggle(
                "bia-active",
                provider === "openai",
            );
            kimiBox.style.display = provider === "kimi" ? "block" : "none";
            openAiBox.style.display =
                provider === "openai" ? "block" : "none";
        };
        kimiProviderButton.addEventListener("click", () => {
            provider = "kimi";
            renderProvider();
        });
        openaiProviderButton.addEventListener("click", () => {
            provider = "openai";
            renderProvider();
        });

        // 缓存: 开关即时保存; TTL 随「保存设置」一起保存
        container.appendChild(el("div", "bia-modal-title", "缓存"));
        const cacheSwitchRow = this.buildSwitchRow(
            "启用结果缓存",
            "关闭后每次进入视频都重新调用 AI",
            getAiSettings().cacheEnabled !== false,
            (value) => {
                saveAiSettings({
                    ...getAiSettings(),
                    cacheEnabled: value,
                });
                showToast(
                    value ? "已启用结果缓存" : "已关闭结果缓存, ⟳ 后将不写缓存",
                );
            },
        );
        container.appendChild(cacheSwitchRow);
        const cacheTtlField = el("label", "bia-field", "缓存保留时长 (小时)");
        const cacheTtlInput = el("input", "bia-input") as HTMLInputElement;
        cacheTtlInput.type = "number";
        cacheTtlInput.min = "0";
        cacheTtlInput.step = "1";
        cacheTtlInput.placeholder = "0 = 永久保留, 到期自动删除";
        cacheTtlField.appendChild(cacheTtlInput);
        container.appendChild(cacheTtlField);
        const cacheTtlInputAtMount = getAiSettings().cacheTtlHours;
        cacheTtlInput.value = String(
            Number.isFinite(cacheTtlInputAtMount) && cacheTtlInputAtMount > 0
                ? Math.round(cacheTtlInputAtMount)
                : 0,
        );

        const actions = el("div", "bia-settings-actions");
        const saveButton = el(
            "button",
            "bia-btn bia-btn-primary",
            "保存设置",
        ) as HTMLButtonElement;
        saveButton.type = "button";
        saveButton.addEventListener("click", () => {
            const ttl = Number(cacheTtlInput.value);
            saveAiSettings({
                provider,
                baseUrl: baseUrl.value.trim(),
                apiKey: apiKey.value.trim(),
                model: model.value.trim(),
                reasoningEffort: effortSelect.value,
                cacheTtlHours:
                    Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : 0,
            });
            showToast("AI 设置已保存, 点击 ⟳ 重新生成");
        });
        actions.appendChild(saveButton);
        container.appendChild(actions);

        // 回填当前已保存配置
        const saved = getAiSettings();
        baseUrl.value = saved.baseUrl;
        apiKey.value = saved.apiKey;
        model.value = saved.model;
        effortSelect.value = saved.reasoningEffort ?? "";
        provider = saved.provider === "openai" ? "openai" : "kimi";
        updateClearButton();
        renderProvider();
    }
}
