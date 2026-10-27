import { chatJsonStream } from "../api/ai";
import {
    extractArrayItemsSoFar,
    extractStringField,
} from "../api/streamJson";
import { snapTime } from "../subtitle";
import type { SubtitleItem, VideoMeta } from "../types";
import { buildTranscript, mindmapMessages } from "./prompt";

export interface MindmapNode {
    title: string;
    start?: number;
    children?: MindmapNode[];
}

export interface MindmapResult {
    title: string;
    children: MindmapNode[];
}

function normalizeNodes(raw: unknown, depth: number): MindmapNode[] {
    if (!Array.isArray(raw) || depth > 4) return [];
    const nodes: MindmapNode[] = [];
    for (const item of raw.slice(0, 40)) {
        const record = item as Record<string, unknown>;
        const title = String(record?.title ?? "").trim();
        if (!title) continue;
        const node: MindmapNode = { title };
        const start = Number(record?.start);
        if (Number.isFinite(start) && start > 0) node.start = start;
        const children = normalizeNodes(record?.children, depth + 1);
        if (children.length > 0) node.children = children;
        nodes.push(node);
    }
    return nodes;
}

/**
 * 生成思维导图 (流式, 节点随生成逐步出现).
 * @param items 完整字幕 (短视频直接用)
 * @param condensedInput 超长视频时传入由章节总结压缩的素材, 为 null 时使用 items
 * @param onPartial 每收到新节点时的部分结果回调
 */
export async function generateMindmap(
    items: SubtitleItem[],
    meta: VideoMeta,
    condensedInput: string | null,
    onPartial?: (partial: MindmapResult) => void,
): Promise<MindmapResult> {
    const input = condensedInput ?? buildTranscript(items);
    const json = (await chatJsonStream(mindmapMessages(meta, input), {
        onPartialText: (text) => {
            if (!onPartial) return;
            const children = normalizeNodes(
                extractArrayItemsSoFar(text, "children"),
                0,
            );
            if (children.length > 0) {
                onPartial({
                    title: extractStringField(text, "title") ?? meta.title,
                    children,
                });
            }
        },
    })) as Record<string, unknown>;

    const children = normalizeNodes(json?.children, 0);
    if (children.length === 0) {
        throw new Error("AI 未返回有效的思维导图");
    }
    const stack = [...children];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.start !== undefined) node.start = snapTime(node.start, items);
        if (node.children) stack.push(...node.children);
    }
    const title = String(json?.title ?? "").trim() || meta.title;
    return { title, children };
}
