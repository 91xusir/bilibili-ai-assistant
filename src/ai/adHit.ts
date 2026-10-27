import type { AdSegment } from "../types";

/**
 * 播放位置命中的广告片段 (纯函数, 自动跳过与确认横幅共用):
 * from-0.3 ≤ time < max(from+0.5, to-0.5), 避免片段边界来回触发.
 */
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
