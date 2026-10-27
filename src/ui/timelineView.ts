import { findCurrentIndex, formatTime } from "../subtitle";
import type { AdSegment, SubtitleDoc } from "../types";
import { el, renderPhaseBlock, type Phase } from "./common";

export interface TimelineViewProps {
    phase: Phase;
    phaseMessage: string;
    doc: SubtitleDoc | null;
    ads: AdSegment[];
    onSeek: (time: number) => void;
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
        const content = el("span", "bia-tl-content", item.content);
        row.append(time, content);
        if (ad) {
            const tag = el("span", "bia-tl-ad-tag", "广告");
            tag.title = ad.reason;
            row.append(tag);
        }
        row.addEventListener("click", () => props.onSeek(item.from));
        fragment.appendChild(row);
        rows.push(row);
    }
    root.appendChild(fragment);

    let currentIndex = -1;
    const setCurrent = (index: number): boolean => {
        if (index === currentIndex) return false;
        if (currentIndex >= 0 && rows[currentIndex]) {
            rows[currentIndex].classList.remove("bia-tl-current");
        }
        if (index >= 0 && rows[index]) {
            rows[index].classList.add("bia-tl-current");
        }
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
