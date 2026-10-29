import { downloadTextFile, sanitizeFilename } from "../core/download";
import { formatTime } from "../subtitle";
import type { AdSegment, SubtitleDoc, SummaryResult } from "../types";

/** 视频总结 → Markdown 文本. */
export function buildSummaryMarkdown(
    doc: SubtitleDoc,
    summary: SummaryResult,
): string {
    const lines: string[] = [];
    lines.push(`# ${doc.title} — 视频总结`);
    lines.push("");
    lines.push(`- 视频链接: https://www.bilibili.com/video/${doc.bvid}?p=${doc.part}`);
    lines.push(`- UP主: ${doc.upName}`);
    lines.push(`- 导出时间: ${new Date().toLocaleString()}`);
    lines.push("");
    if (summary.overview) {
        lines.push("## 总览");
        lines.push("");
        lines.push(summary.overview);
        lines.push("");
    }
    for (const section of summary.sections) {
        lines.push(`## [${formatTime(section.start)}] ${section.title}`);
        lines.push("");
        if (section.content) {
            lines.push(section.content);
            lines.push("");
        }
        lines.push(`> 跳转: https://www.bilibili.com/video/${doc.bvid}?p=${doc.part}&t=${Math.floor(section.start)}`);
        lines.push("");
    }
    return lines.join("\n");
}

export function exportSummaryFile(
    doc: SubtitleDoc,
    summary: SummaryResult,
): void {
    downloadTextFile(
        `${sanitizeFilename(doc.title)}_视频总结.md`,
        buildSummaryMarkdown(doc, summary),
    );
}

/** 时间轴 → JSON: 视频元信息 + 广告片段 + 字幕行 (命中广告的行带 ad 标记). */
export function buildTimelineJson(
    doc: SubtitleDoc,
    ads: AdSegment[],
): string {
    const payload = {
        video: {
            bvid: doc.bvid,
            title: doc.title,
            upName: doc.upName,
            duration: doc.duration,
            url: `https://www.bilibili.com/video/${doc.bvid}?p=${doc.part}`,
        },
        exportedAt: new Date().toISOString(),
        ads: ads.map((segment) => ({
            from: segment.from,
            to: segment.to,
            reason: segment.reason,
        })),
        subtitles: doc.items.map((item) => {
            const inAd = ads.some(
                (segment) =>
                    item.from >= segment.from - 0.01 &&
                    item.from < segment.to,
            );
            return {
                from: item.from,
                to: item.to,
                content: item.content,
                ...(inAd ? { ad: true } : {}),
            };
        }),
    };
    return JSON.stringify(payload, null, 2);
}

export function exportTimelineFile(doc: SubtitleDoc, ads: AdSegment[]): void {
    downloadTextFile(
        `${sanitizeFilename(doc.title)}_时间轴.json`,
        buildTimelineJson(doc, ads),
        "application/json",
    );
}
