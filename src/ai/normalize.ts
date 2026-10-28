/**
 * AI 返回结果的规范化 (纯函数): summary / adDetect / combined 共用,
 * 保证三种请求路径产出的数据形状一致.
 */

import type { AdSegment, SummarySection } from "../types";

export function normalizeSections(raw: unknown): SummarySection[] {
    const list = Array.isArray(raw)
        ? raw
        : (raw as Record<string, unknown>)?.sections;
    if (!Array.isArray(list)) return [];
    return list
        .map((item: Record<string, unknown>) => ({
            start: Number(item?.start) || 0,
            end: Number(item?.end) || 0,
            title: String(item?.title ?? "").trim() || "未命名章节",
            content: String(item?.content ?? "").trim(),
        }))
        .filter((section) => section.content || section.title !== "未命名章节")
        .sort((a, b) => a.start - b.start);
}

export function normalizeAds(raw: unknown): AdSegment[] {
    const list = Array.isArray(raw)
        ? raw
        : (raw as Record<string, unknown>)?.ads;
    if (!Array.isArray(list)) return [];
    return list
        .map((item: Record<string, unknown>) => ({
            from: Number(item?.from) || 0,
            to: Number(item?.to) || 0,
            reason: String(item?.reason ?? "").trim() || "广告",
        }))
        .filter((segment) => segment.to > segment.from)
        .sort((a, b) => a.from - b.from);
}
