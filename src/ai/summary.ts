import { chatJson, chatJsonStream } from "../api/ai";
import { normalizeSections } from "./normalize";
import {
    extractArrayItemsSoFar,
    extractStringField,
} from "../api/streamJson";
import { snapTime } from "../subtitle";
import type {
    SubtitleItem,
    SummaryResult,
    SummarySection,
    VideoMeta,
} from "../types";
import {
    buildTranscript,
    chunkTranscript,
    mergeSummaryMessages,
    partialSummaryMessages,
    summaryMessages,
} from "./prompt";

/**
 * 生成视频总结.
 * 短视频: 单次流式请求, 章节卡片随生成逐步出现 (onPartial).
 * 长视频: 分段 map-reduce, 每段完成推进一次 onPartial.
 */
export async function generateSummary(
    items: SubtitleItem[],
    meta: VideoMeta,
    onPartial?: (partial: SummaryResult) => void,
): Promise<SummaryResult> {
    const chunks = chunkTranscript(items);
    let overview = "";
    let sections: SummarySection[];

    if (chunks.length <= 1) {
        const json = (await chatJsonStream(
            summaryMessages(meta, buildTranscript(items)),
            {
                onPartialText: (text) => {
                    if (!onPartial) return;
                    const partialSections = normalizeSections(
                        extractArrayItemsSoFar(text, "sections"),
                    );
                    const partialOverview =
                        extractStringField(text, "overview") ?? "";
                    if (partialSections.length > 0 || partialOverview) {
                        onPartial({
                            overview: partialOverview,
                            sections: partialSections,
                        });
                    }
                },
            },
        )) as Record<string, unknown>;
        overview = String(json?.overview ?? "").trim();
        sections = normalizeSections(json);
    } else {
        const partials: SummarySection[][] = [];
        const emitPartial = () => {
            if (!onPartial) return;
            onPartial({
                overview: "",
                sections: partials.flat().sort((a, b) => a.start - b.start),
            });
        };
        for (let index = 0; index < chunks.length; index++) {
            const chunk = chunks[index];
            if (!chunk) continue;
            const json = (await chatJson(
                partialSummaryMessages(
                    meta,
                    buildTranscript(chunk),
                    index + 1,
                    chunks.length,
                ),
            )) as Record<string, unknown>;
            const partSections = normalizeSections(json);
            if (partSections.length > 0) partials.push(partSections);
            emitPartial();
        }
        if (partials.length === 0) {
            throw new Error("AI 未返回有效的分段总结");
        }
        const merged = (await chatJson(
            mergeSummaryMessages(meta, partials),
        )) as Record<string, unknown>;
        overview = String(merged?.overview ?? "").trim();
        sections = normalizeSections(merged);
        if (sections.length === 0) {
            sections = partials.flat().sort((a, b) => a.start - b.start);
        }
    }

    sections = sections.map((section) => ({
        ...section,
        start: snapTime(section.start, items),
    }));

    if (!overview && sections.length === 0) {
        throw new Error("AI 未返回有效的总结内容");
    }
    return { overview, sections };
}
