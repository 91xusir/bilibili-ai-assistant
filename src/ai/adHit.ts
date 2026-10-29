import type { AdSegment } from "../types";

/**
 * 播放位置命中的广告片段 (纯函数, 自动跳过与确认横幅共用):
 * from-0.3 ≤ time < max(from+0.5, to-0.5), 避免片段边界来回触发.
 */
/**
 * 过滤短于最短时长的片段 (误判防护, 纯函数):
 * minSeconds <= 0 表示不过滤. 供缓存/识别结果进入面板前统一调用.
 */
export function filterAdsByDuration(
    ads: AdSegment[],
    minSeconds: number,
): AdSegment[] {
    if (minSeconds <= 0) return ads;
    return ads.filter((ad) => ad.to - ad.from >= minSeconds);
}

export function findAdHit(
    ads: AdSegment[],
    time: number,
): AdSegment | null {
    return (
        ads.find(
            (ad) =>
                time >= ad.from - 0.3 &&
                time < Math.max(ad.from + 0.5, ad.to - 0.5),
        ) ?? null
    );
}
