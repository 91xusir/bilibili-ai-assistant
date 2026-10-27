import { chatJson } from "../api/ai";
import type { SubtitleItem, VideoMeta } from "../types";
import { adMessages, buildTranscript, chunkTranscript } from "./prompt";

export interface AdSegment {
    from: number;
    to: number;
    reason: string;
}

async function detectAdsInChunk(
    chunk: SubtitleItem[],
    meta: VideoMeta,
): Promise<AdSegment[]> {
    const json = (await chatJson(
        adMessages(meta, buildTranscript(chunk)),
        { temperature: 0.1 },
    )) as Record<string, unknown>;
    const list = json?.ads;
    if (!Array.isArray(list)) return [];
    return list
        .map((item: Record<string, unknown>) => ({
            from: Number(item?.from) || 0,
            to: Number(item?.to) || 0,
            reason: String(item?.reason ?? "").trim() || "广告",
        }))
        .filter((segment) => segment.to > segment.from);
}

/** 识别广告/推广片段; 超长字幕分块并行识别后合并. */
export async function detectAds(
    items: SubtitleItem[],
    meta: VideoMeta,
): Promise<AdSegment[]> {
    const chunks = chunkTranscript(items);
    const results = await Promise.all(
        chunks.map((chunk) => detectAdsInChunk(chunk, meta)),
    );
    return results
        .flat()
        .sort((a, b) => a.from - b.from);
}
