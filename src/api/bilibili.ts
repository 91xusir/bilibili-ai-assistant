import { platformRequest } from "../core/net";
import type {
    SubtitleDoc,
    SubtitleItem,
    SubtitleTrack,
    VideoId,
} from "../types";

const VIEW_API = "https://api.bilibili.com/x/web-interface/view";
const PLAYER_API = "https://api.bilibili.com/x/player/wbi/v2";

/** 从 URL 解析视频 id (BV/av + 分P). */
export function getVideoId(url: string = location.href): VideoId | null {
    try {
        const parsed = new URL(url);
        const segment = parsed.pathname
            .split("/")
            .find((part) => /^(BV1\w{9}|av\d+)$/i.test(part));
        if (!segment) return null;
        const part = Number(parsed.searchParams.get("p") ?? "1") || 1;
        if (/^av/i.test(segment)) {
            return { bvId: null, avId: Number(segment.slice(2)), part };
        }
        return { bvId: segment, avId: null, part };
    } catch {
        return null;
    }
}

export function videoKey(id: VideoId): string {
    return `${id.bvId ?? `av${id.avId}`}?p=${id.part}`;
}

async function fetchJson<T>(
    url: string,
    params: Record<string, string | number>,
): Promise<T> {
    const query = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    // 经后台 Service Worker 请求 (带 Cookie), 内容脚本不直接 fetch
    const response = await platformRequest({
        method: "GET",
        url: `${url}?${query}`,
        credentials: "include",
    });
    const resp = await response.promise;
    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`B站接口请求失败 (HTTP ${resp.status})`);
    }
    let json: any;
    try {
        json = JSON.parse(resp.responseText);
    } catch {
        throw new Error("B站接口返回格式异常");
    }
    if (json?.code !== 0) {
        throw new Error(`B站接口错误: ${json?.message ?? json?.code ?? "未知"}`);
    }
    return json.data as T;
}

interface BiliViewPage {
    cid: number;
    page: number;
    part: string;
    duration: number;
}

interface BiliView {
    bvid: string;
    aid: number;
    title: string;
    owner?: { name?: string };
    duration: number;
    pages: BiliViewPage[];
}

function trackOrder(track: SubtitleTrack): number {
    if (/中文|简体|繁体|zh/i.test(track.lanDoc)) return 0;
    if (/英语|英文|en/i.test(track.lanDoc)) return 1;
    return 2;
}

function compareTracks(a: SubtitleTrack, b: SubtitleTrack): number {
    const orderDiff = trackOrder(a) - trackOrder(b);
    if (orderDiff !== 0) return orderDiff;
    if (a.aiStatus !== b.aiStatus) return a.aiStatus ? 1 : -1;
    return 0;
}

export async function fetchSubtitleItems(
    subtitleUrl: string,
): Promise<SubtitleItem[]> {
    // 字幕 CDN 走后台, 内容脚本零 fetch
    const response = await platformRequest({
        method: "GET",
        url: subtitleUrl,
        credentials: "omit",
    });
    const resp = await response.promise;
    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`字幕下载失败 (HTTP ${resp.status})`);
    }
    let json: any;
    try {
        json = JSON.parse(resp.responseText);
    } catch {
        throw new Error("字幕返回格式异常");
    }
    const body = Array.isArray(json?.body) ? json.body : [];
    return body
        .map((line: Record<string, unknown>) => ({
            from: Number(line.from) || 0,
            to: Number(line.to) || 0,
            content: String(line.content ?? "")
                .replace(/\s+/g, " ")
                .trim(),
        }))
        .filter(
            (item: SubtitleItem) => item.content && item.to > item.from,
        )
        .sort((a: SubtitleItem, b: SubtitleItem) => a.from - b.from);
}

/** 获取视频信息 + 字幕轨 + 默认字幕内容. */
export async function getSubtitleDoc(videoId: VideoId): Promise<SubtitleDoc> {
    const idParams: Record<string, string> = videoId.bvId
        ? { bvid: videoId.bvId }
        : { aid: String(videoId.avId) };

    const view = await fetchJson<BiliView>(VIEW_API, idParams);
    const page =
        view.pages.find((item) => item.page === videoId.part) ?? view.pages[0];
    if (!page) throw new Error("未找到视频分P信息");

    const player = await fetchJson<Record<string, any>>(PLAYER_API, {
        cid: page.cid,
        ...idParams,
    });
    const rawSubtitles: Record<string, any>[] =
        player?.subtitle?.subtitles ?? [];
    const tracks: SubtitleTrack[] = rawSubtitles
        .map((sub) => {
            const rawUrl = String(sub.subtitle_url ?? "");
            return {
                id: String(sub.id_str ?? sub.id ?? ""),
                lan: String(sub.lan ?? ""),
                lanDoc: String(sub.lan_doc ?? sub.lan ?? ""),
                aiStatus: Boolean(sub.ai_status),
                subtitleUrl: rawUrl.startsWith("http") ? rawUrl : `https:${rawUrl}`,
            };
        })
        .filter((track) => track.subtitleUrl.startsWith("https"));
    tracks.sort(compareTracks);

    const track = tracks[0] ?? null;
    const items = track ? await fetchSubtitleItems(track.subtitleUrl) : [];

    return {
        bvid: view.bvid,
        part: page.page,
        title: view.title,
        upName: view.owner?.name ?? "",
        duration: page.duration || view.duration || 0,
        tracks,
        track,
        items,
    };
}
