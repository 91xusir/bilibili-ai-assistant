import type { SubtitleItem } from "../types";

export function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 二分查找: time 所在字幕行的下标, 找不到返回 -1. */
export function findCurrentIndex(items: SubtitleItem[], time: number): number {
    let low = 0;
    let high = items.length - 1;
    let answer = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (items[mid]!==undefined && items[mid].from <= time) {
            answer = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return answer;
}

/**
 * 将 AI 给出的时间吸附到最近的字幕行开始时间 (±tolerance 秒内),
 * 避免模型虚构时间导致跳转位置不准.
 */
export function snapTime(
    time: number,
    items: SubtitleItem[],
    tolerance = 90,
): number {
    if (!items.length || !Number.isFinite(time) || time < 0) return time;
    let low = 0;
    let high = items.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (items[mid]!==undefined && items[mid].from < time) low = mid + 1;
        else high = mid;
    }
    let best = time;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const index of [low - 1, low]) {
        const item = items[index];
        if (!item) continue;
        const diff = Math.abs(item.from - time);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = item.from;
        }
    }
    return bestDiff <= tolerance ? best : time;
}
