import { chatJson } from "../api/ai";
import type { AdSegment, SubtitleItem, VideoMeta } from "../types";
import { normalizeAds } from "./normalize";
import { adMessages, buildTranscript, chunkTranscript } from "./prompt";

async function detectAdsInChunk(
    chunk: SubtitleItem[],
    meta: VideoMeta,
): Promise<AdSegment[]> {
    const json = (await chatJson(
        adMessages(meta, buildTranscript(chunk)),
        { temperature: 0.1 },
    )) as Record<string, unknown>;
    return normalizeAds(json);
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
