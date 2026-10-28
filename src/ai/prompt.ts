import type { ChatMessage } from "../api/ai";
import type { SubtitleItem, SummarySection, VideoMeta } from "../types";

const SYSTEM_JSON = "你是专业的视频内容分析助手。只输出一个 JSON 对象, 不要输出任何解释文字或 markdown 代码块标记。";

/** 字幕 → "[123s] 内容" 文本, 供 AI 引用时间戳. */
export function buildTranscript(items: SubtitleItem[]): string {
    return items
        .map((item) => `[${Math.round(item.from)}s] ${item.content}`)
        .join("\n");
}

/** 按字符预算把字幕切分为多段 (超长视频分块处理). */
export function chunkTranscript(
    items: SubtitleItem[],
    charBudget = 9000,
): SubtitleItem[][] {
    const chunks: SubtitleItem[][] = [];
    let current: SubtitleItem[] = [];
    let currentLength = 0;
    for (const item of items) {
        const length = item.content.length + 12;
        if (current.length > 0 && currentLength + length > charBudget) {
            chunks.push(current);
            current = [];
            currentLength = 0;
        }
        current.push(item);
        currentLength += length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

export function summaryMessages(
    meta: VideoMeta,
    transcript: string,
): ChatMessage[] {
    return [
        { role: "system", content: SYSTEM_JSON },
        {
            role: "user",
            content:
                `视频标题:《${meta.title}》\n` +
                `UP主: ${meta.upName}\n` +
                `总时长: ${Math.round(meta.duration)} 秒\n\n` +
                "以下是完整视频字幕 (每行格式为 [开始秒数] 字幕文本):\n\n" +
                `${transcript}\n\n` +
                "请生成该视频的总结, 严格输出如下 JSON:\n" +
                '{"sections": [{"start": 章节开始的秒数(数字), "end": 章节结束的秒数(数字), "title": "简短章节标题", "content": "该章节 2~4 句要点概括"}], "overview": "对整个视频的 3~5 句概括"}\n' +
                "要求:\n" +
                "1. sections 在前 overview 在后, sections 按时间升序, 5~15 个章节, 覆盖整个视频;\n" +
                "2. start/end 必须取自字幕行的时间戳, 不得虚构;\n" +
                "3. 只输出 JSON。",
        },
    ];
}

export function partialSummaryMessages(
    meta: VideoMeta,
    transcript: string,
    index: number,
    total: number,
): ChatMessage[] {
    return [
        { role: "system", content: SYSTEM_JSON },
        {
            role: "user",
            content:
                `视频《${meta.title}》较长, 以下是第 ${index}/${total} 段字幕 (每行格式为 [开始秒数] 字幕文本):\n\n` +
                `${transcript}\n\n` +
                "请总结这一段的内容, 严格输出 JSON:\n" +
                '{"sections": [{"start": 章节开始的秒数(数字), "end": 章节结束的秒数(数字), "title": "简短章节标题", "content": "该章节 2~4 句要点概括"}]}\n' +
                "要求: start/end 必须取自字幕行的时间戳, 不得虚构; 只输出 JSON。",
        },
    ];
}

export function mergeSummaryMessages(
    meta: VideoMeta,
    partials: SummarySection[][],
): ChatMessage[] {
    const json = JSON.stringify(
        partials.map((sections) => ({ sections })),
    );
    return [
        { role: "system", content: SYSTEM_JSON },
        {
            role: "user",
            content:
                `视频《${meta.title}》被分成多段总结了, 以下是各段的小节列表 (JSON):\n\n` +
                `${json}\n\n` +
                "请把它们合并整理为最终的视频总结, 严格输出 JSON:\n" +
                '{"sections": [{"start": 数字, "end": 数字, "title": "...", "content": "..."}], "overview": "对整个视频的 3~5 句概括"}\n' +
                "要求: 保持 start/end 秒数不变, 合并重复内容, 按时间升序, 总数控制在 5~15 个; 只输出 JSON。",
        },
    ];
}

export function adMessages(meta: VideoMeta, transcript: string): ChatMessage[] {
    return [
        {
            role: "system",
            content:
                "你是视频内容审核专家, 擅长从视频字幕中识别广告片段。只输出一个 JSON 对象, 不要输出任何解释文字。",
        },
        {
            role: "user",
            content:
                `视频标题:《${meta.title}》\n\n` +
                "以下是视频字幕 (每行格式为 [开始秒数] 字幕文本):\n\n" +
                `${transcript}\n\n` +
                "请识别字幕对应的视频片段中的广告/商业推广内容, 严格输出 JSON:\n" +
                '{"ads": [{"from": 开始秒数(数字), "to": 结束秒数(数字), "reason": "判断依据(简短)"}]}\n' +
                "规则:\n" +
                "1. 需要识别: 口播广告、赞助商推广、商品带货、第三方便利入口引导、与视频主题无关的商业宣传;\n" +
                "2. 不要把正常的内容讲解、片头片尾、交互提示误判为广告, 宁可漏判不可误判;\n" +
                "3. from/to 必须取自字幕行的时间戳, 覆盖整个广告片段;\n" +
                "4. 若没有广告, 输出 {\"ads\": []};\n" +
                "5. 只输出 JSON。",
        },
    ];
}
