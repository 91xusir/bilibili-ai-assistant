import { chatJsonStream, type ChatMessage } from "../api/ai";
import {
    extractArrayItemsSoFar,
    extractStringField,
} from "../api/streamJson";
import { snapTime } from "../subtitle";
import type {
    AdSegment,
    SubtitleItem,
    SummarySection,
    VideoMeta,
} from "../types";

/** 一次请求输出的三任务汇总 (Kimi 单会话 / OpenAI 单次调用). */
export interface CombinedResult {
    overview: string;
    sections: SummarySection[];
    mindmapChildren: unknown[];
    mindmapTitle: string | null;
    ads: AdSegment[];
}

/**
 * 只启用的任务子集, 供提示词裁剪与结果过滤.
 */
export interface CombinedScope {
    summary: boolean;
    mindmap: boolean;
    ads: boolean;
}

const SYSTEM = [
    "你是专业的视频内容分析助手。",
    "根据视频字幕一次性生成三份结构化结果: 视频总结(sections/overview)、思维导图(children)、广告片段(ads)。",
    "只输出一个 JSON 对象, 不要任何解释文字或 markdown 代码块标记。",
].join("\n");

function scopeSection(scope: CombinedScope): string {
    if (scope.summary && scope.mindmap && scope.ads) return "总结、思维导图、广告识别";
    const parts: string[] = [];
    if (scope.summary) parts.push("视频总结");
    if (scope.mindmap) parts.push("思维导图");
    if (scope.ads) parts.push("广告识别");
    return parts.join("、") || "无";
}

function scopeRequirements(scope: CombinedScope): string {
    const reqs: string[] = [];
    // ads 必须放最前: 流式最先到达, 无需等总结/导图完成即可优先判断广告
    if (scope.ads) {
        reqs.push(
            'ads (数组, 必须放在最前): {"from": 起始秒数(数字), "to": 结束秒数(数字), "reason": "判断依据(简短)"}; 识别口播广告/赞助推广/商品带货, 宁可漏判不可误判, 无广告则给空数组。',
        );
    }
    if (scope.summary) {
        reqs.push(
            'sections (数组): 每项 {"start": 章节开始秒数(数字), "end": 章节结束秒数(数字), "title": "简短章节标题", "content": "该章节 2~4 句要点"}; 5~15 个, 按 start 升序, 覆盖整个视频。',
            'overview (字符串): 对整个视频的 3~5 句概括。',
        );
    }
    if (scope.mindmap) {
        reqs.push(
            'children (数组, 思维导图节点): {"title": "节点标题", "start": 该主题首次出现的秒数(数字, 可省略), "children": [同结构子节点]}; 层级 2~3 层, 一级节点 3~8 个, 总节点不超过 40, 每个节点尽量带 start。',
        );
    }
    reqs.push("start/end/from/to 必须取自字幕行的时间戳, 不得虚构。只输出 JSON。");
    return reqs.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

export function combinedMessages(
    meta: VideoMeta,
    transcript: string,
    scope: CombinedScope,
): ChatMessage[] {
    return [
        { role: "system", content: SYSTEM },
        {
            role: "user",
            content:
                `视频标题:《${meta.title}》\n` +
                `UP主: ${meta.upName}\n` +
                `总时长: ${Math.round(meta.duration)} 秒\n\n` +
                "以下是完整视频字幕 (每行格式为 [开始秒数] 字幕文本):\n\n" +
                `${transcript}\n\n` +
                `请生成: ${scopeSection(scope)}。\n` +
                "严格输出如下 JSON (只保留需要的顶层字段):\n" +
                '{"ads": [...], "sections": [...], "overview": "...", "children": [...]}\n\n' +
                `要求:\n${scopeRequirements(scope)}`,
        },
    ];
}

/**
 * 从流式累积文本中提取当前已闭合的部分内容 (供三视图渐进渲染).
 * 字段顺序: ads → sections → overview → children (与提示词一致).
 */
export function extractCombinedSoFar(
    text: string,
    scope: CombinedScope,
): Partial<CombinedResult> {
    const out: Partial<CombinedResult> = {};
    if (scope.summary) {
        const sections = normalizeSections(
            extractArrayItemsSoFar(text, "sections"),
        );
        if (sections.length > 0) out.sections = sections;
        const overview = extractStringField(text, "overview");
        if (overview) out.overview = overview;
    }
    if (scope.mindmap) {
        const children = extractArrayItemsSoFar(text, "children");
        if (children.length > 0) out.mindmapChildren = children;
        const title = extractStringField(text, "title");
        if (title) out.mindmapTitle = title;
    }
    if (scope.ads) {
        const ads = normalizeAds(extractArrayItemsSoFar(text, "ads"));
        if (ads.length > 0) out.ads = ads;
    }
    return out;
}

function normalizeSections(raw: unknown): SummarySection[] {
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

function normalizeAds(raw: unknown): AdSegment[] {
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

/** 递归补齐导图节点的标题/时间吸附 (深度上限由提示词保证). */
function normalizeMindmapChildren(
    raw: unknown,
    items: SubtitleItem[],
    depth = 0,
): unknown[] {
    if (!Array.isArray(raw) || depth > 4) return [];
    const out: unknown[] = [];
    for (const item of raw.slice(0, 40)) {
        const record = item as Record<string, unknown>;
        const title = String(record?.title ?? "").trim();
        if (!title) continue;
        const node: Record<string, unknown> = { title };
        const start = Number(record?.start);
        if (Number.isFinite(start) && start > 0) {
            node.start = snapTime(start, items);
        }
        const children = normalizeMindmapChildren(
            record?.children,
            items,
            depth + 1,
        );
        if (children.length > 0) node.children = children;
        out.push(node);
    }
    return out;
}

/**
 * 一次请求完成三任务: 校验各顶层字段, 空的部分置 null/[], 便于视图显示对应错误.
 * 字段顺序与提示词保持一致 (ads 在最前), 否则流式部分渲染会空转.
 */
export async function generateCombined(
    meta: VideoMeta,
    transcript: string,
    items: SubtitleItem[],
    scope: CombinedScope,
    onPartial?: (partial: Partial<CombinedResult>) => void,
): Promise<CombinedResult> {
    const json = (await chatJsonStream(combinedMessages(meta, transcript, scope), {
        onPartialText: (text) => {
            if (!onPartial) return;
            const partial = extractCombinedSoFar(text, scope);
            if (Object.keys(partial).length > 0) onPartial(partial);
        },
    })) as Record<string, unknown>;

    const sections = scope.summary ? normalizeSections(json) : [];
    const overview = scope.summary
        ? String(json?.overview ?? "").trim()
        : "";
    const mindmapChildren = scope.mindmap
        ? normalizeMindmapChildren(json?.children, items)
        : [];
    const ads = scope.ads ? normalizeAds(json) : [];

    const hasAny =
        (scope.summary && (sections.length > 0 || overview)) ||
        (scope.mindmap && mindmapChildren.length > 0) ||
        (scope.ads && ads.length > 0);
    if (scope.summary && !scope.mindmap && !scope.ads) {
        // 只开总结时, 与单独生成保持一致的报错语义
        if (!overview && sections.length === 0) {
            throw new Error("AI 未返回有效的总结内容");
        }
    } else if (!hasAny) {
        throw new Error("AI 未返回有效的汇总内容");
    }

    return {
        overview,
        sections: sections.map((section) => ({
            ...section,
            start: snapTime(section.start, items),
        })),
        mindmapChildren,
        mindmapTitle: scope.mindmap
            ? String(json?.title ?? "").trim() || meta.title
            : null,
        ads,
    };
}
