export interface VideoId {
    bvId: string | null;
    avId: number | null;
    part: number;
}

export interface SubtitleTrack {
    id: string;
    lan: string;
    lanDoc: string;
    aiStatus: boolean;
    subtitleUrl: string;
}

export interface SubtitleItem {
    from: number;
    to: number;
    content: string;
}

export interface SubtitleDoc {
    bvid: string;
    avid: number;
    cid: number;
    part: number;
    title: string;
    upName: string;
    duration: number;
    tracks: SubtitleTrack[];
    track: SubtitleTrack | null;
    items: SubtitleItem[];
}

export interface SummarySection {
    start: number;
    end: number;
    title: string;
    content: string;
}

export interface SummaryResult {
    overview: string;
    sections: SummarySection[];
}

export interface MindmapNode {
    title: string;
    start?: number;
    children?: MindmapNode[];
}

export interface MindmapResult {
    title: string;
    children: MindmapNode[];
}

export interface AdSegment {
    from: number;
    to: number;
    reason: string;
}

export type AiProvider = "kimi" | "openai";

export interface AiSettings {
    /** AI 服务商: kimi = kimi.com 网页版 (默认, 免 Key); openai = OpenAI 兼容接口 */
    provider: AiProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 思考等级: "" 关闭思考 / low / medium / high (仅 OpenAI 兼容接口) */
    reasoningEffort: string;
    /** 是否启用 AI 结果缓存 */
    cacheEnabled: boolean;
    /** 缓存保留时长 (小时), 0 = 永久; 到期自动删除 */
    cacheTtlHours: number;
    /**
     * 单次汇总: 总结+导图+广告 一次请求完成 (Kimi 一个会话 / OpenAI 一次调用).
     * 关闭则三任务分别请求.
     */
    combinedTasks: boolean;
}

/** AI 任务开关 (设置页) */
export interface TaskToggles {
    /** 生成视频总结 */
    summary: boolean;
    /** 生成思维导图 */
    mindmap: boolean;
}

export type TabId = "summary" | "mindmap" | "timeline" | "settings";

export type TaskId = "summary" | "mindmap" | "ads";

export type TaskStatus = "idle" | "loading" | "done" | "error" | "disabled";

export interface TaskState {
    status: TaskStatus;
    error?: string;
}

export interface VideoMeta {
    title: string;
    upName: string;
    duration: number;
}
