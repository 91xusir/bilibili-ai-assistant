/**
 * 内容脚本侧的缓存端口: 字幕缓存存在 SW 的扩展源 IndexedDB 里
 * (内容脚本的 IDB 属于 bilibili 源, 选项页读不到), 经消息读写.
 */

import type { SubtitleDoc } from "../types";

export interface SubtitleCacheHit {
    doc: SubtitleDoc;
    savedAt: number;
}

/** 读取字幕缓存; SW 未响应 / 无缓存 / 出错都返回 null (回退在线获取). */
export async function cacheGetDoc(key: string): Promise<SubtitleCacheHit | null> {
    try {
        const reply = (await chrome.runtime.sendMessage({
            kind: "bia-cache",
            action: "get",
            key,
        })) as { ok?: boolean; doc?: SubtitleDoc; savedAt?: number } | null;
        if (reply?.ok && reply.doc) {
            return { doc: reply.doc, savedAt: Number(reply.savedAt) || 0 };
        }
        return null;
    } catch {
        return null;
    }
}

/** 写入字幕缓存 (失败静默, 缓存不影响主流程). */
export async function cachePutDoc(key: string, doc: SubtitleDoc): Promise<void> {
    try {
        await chrome.runtime.sendMessage({
            kind: "bia-cache",
            action: "put",
            key,
            doc,
        });
    } catch {
        /* ignore */
    }
}

/** 删除字幕缓存 (过期惰性清理 / 调试用). */
export async function cacheDeleteDoc(key: string): Promise<void> {
    try {
        await chrome.runtime.sendMessage({
            kind: "bia-cache",
            action: "delete",
            key,
        });
    } catch {
        /* ignore */
    }
}
