import { findCurrentIndex, formatTime } from "../subtitle";
import type {
    AdSegment,
    ClickAction,
    SubtitleDoc,
    TaskState,
} from "../types";
import { el, renderPhaseBlock, type Phase } from "./common";

export interface TimelineViewProps {
    phase: Phase;
    phaseMessage: string;
    doc: SubtitleDoc | null;
    ads: AdSegment[];
    adsTask: TaskState;
    clickAction: ClickAction;
    generating: boolean;
    onSeek: (time: number) => void;
    onCopy: (text: string) => void;
    onDetectAds: () => void;
}

export interface TimelineHandle {
    /** 更新当前行高亮, 返回当前行是否发生变化 */
    update(time: number): boolean;
    /** 当前高亮行元素 (无则 null) */
    getRow(): HTMLElement | null;
}

export function renderTimelineView(
    root: HTMLElement,
    props: TimelineViewProps,
): TimelineHandle | null {
    root.innerHTML = "";
    if (props.phase !== "ready" || !props.doc || props.doc.items.length === 0) {
        renderPhaseBlock(root, props.phase, props.phaseMessage);
        return null;
    }

    // 工具栏: 识别广告手动触发 (自动识别被关闭时由此补跑)
    root.appendChild(buildToolbar(props));

    const items = props.doc.items;
    const ads = props.ads;
    const rows: HTMLElement[] = [];
    const fragment = document.createDocumentFragment();

    for (const item of items) {
        const row = el("div", "bia-tl-row");
        const ad = ads.find(
            (segment) =>
                item.from >= segment.from - 0.01 && item.from < segment.to,
        );
        if (ad) row.classList.add("bia-tl-ad-row");

        const time = el("span", "bia-tl-time", formatTime(item.from));
        time.title = "跳转到此时间";
        time.addEventListener("click", (event) => {
            event.stopPropagation();
            props.onSeek(item.from);
        });
        const content = el("span", "bia-tl-content", item.content);
        row.append(time, content);
        if (ad) {
            const tag = el("span", "bia-tl-ad-tag", "广告");
            tag.title = ad.reason;
            row.append(tag);
        }
        row.addEventListener("click", () => {
            if (props.clickAction === "copy") props.onCopy(item.content);
            else props.onSeek(item.from);
        });
        fragment.appendChild(row);
        rows.push(row);
    }
    root.appendChild(fragment);

    let currentIndex = -1;
    const setCurrent = (index: number): boolean => {
        if (index === currentIndex) return false;
        const prev = currentIndex >= 0 ? rows[currentIndex] : undefined;
        if (prev) prev.classList.remove("bia-tl-current");
        const next = index >= 0 ? rows[index] : undefined;
        if (next) next.classList.add("bia-tl-current");
        currentIndex = index;
        return true;
    };
    return {
        update(time: number) {
            return setCurrent(findCurrentIndex(items, time));
        },
        getRow() {
            return currentIndex >= 0 ? (rows[currentIndex] ?? null) : null;
        },
    };
}

function buildToolbar(props: TimelineViewProps): HTMLElement {
    const bar = el("div", "bia-tl-toolbar");
    const button = el(
        "button",
        "bia-btn bia-detect-btn",
        props.adsTask.status === "loading" ? "识别中..." : "识别广告",
    ) as HTMLButtonElement;
    button.type = "button";
    button.title = "单独识别本视频的广告片段 (时间轴标记红行)";
    button.disabled = props.generating;
    button.addEventListener("click", () => props.onDetectAds());
    bar.appendChild(button);

    let statusText = "";
    if (props.adsTask.status === "loading") statusText = "AI 正在识别广告...";
    else if (props.adsTask.status === "error") {
        statusText = `识别失败: ${props.adsTask.error ?? "未知"}`;
    } else if (props.adsTask.status === "disabled") {
        statusText = "广告识别已关闭";
    } else if (props.adsTask.status === "done") {
        statusText =
            props.ads.length > 0
                ? `已标记 ${props.ads.length} 段广告`
                : "未发现广告";
    }
    if (statusText) {
        const status = el("span", "bia-tl-status", statusText);
        if (props.adsTask.status === "error") status.classList.add("bia-test-fail");
        bar.appendChild(status);
    }
    return bar;
}
