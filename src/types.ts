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
    /** 是否启用缓存 (字幕 + 总结/广告 两层同时生效) */
    cacheEnabled: boolean;
    /** 缓存保留时长 (小时), 0 = 永久; 到期自动删除 */
    cacheTtlHours: number;
}

/** 功能开关 (Popup 快捷开关 / Options 完整设置共用) */
export interface FeatureSettings {
    /** 进入视频后自动生成总结 */
    autoSummary: boolean;
    /** 识别广告片段 (自动跳过开启时强制视为开启) */
    detectAds: boolean;
    /** 播放到广告自动跳过; 关闭时改为弹提示框确认 */
    autoSkipAds: boolean;
    /** 点击文本行为: jump = 跳转播放位置 / copy = 复制文本 (时间徽章始终跳转) */
    clickAction: ClickAction;
}

export type ClickAction = "jump" | "copy";

export type TabId = "summary" | "timeline";

export type TaskId = "summary" | "ads";

export type TaskStatus = "idle" | "loading" | "done" | "error" | "disabled";

export interface TaskState {
    status: TaskStatus;
    error?: string;
}

/**
 * 本次进入视频要执行的任务计划 (由功能开关推导, 纯函数可单测):
 * - ads 生效 = detectAds || autoSkipAds (自动跳过依赖识别结果)
 * - summary 与 ads 同时生效 → combined 单请求 (广告提示词最前, 流式优先返回广告)
 */
export interface TaskPlan {
    summary: boolean;
    ads: boolean;
    autoSkip: boolean;
    mode: "combined" | "summary" | "ads" | "none";
}

/** 视频 AI 结果缓存条目 (chrome.storage.local, 键 bia:ai-cache:{videoKey}) */
export interface AiCacheEntry {
    /** null = 尚未识别过广告; [] = 识别过且无广告 */
    summary: SummaryResult | null;
    ads: AdSegment[] | null;
    savedAt: number;
}

export interface VideoMeta {
    title: string;
    upName: string;
    duration: number;
}
