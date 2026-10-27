/** chrome.storage.local 的同步缓存封装: 启动时全量水合, 之后读写内存 + 写穿. */

const storageCache = new Map<string, unknown>();

/**
 * 把 chrome.storage.local 全量读入内存.
 * 之后 storageGet/storageSet 都走同步缓存 + 写穿, 必须在首次读配置前 await 调用 (main 入口).
 */
export async function storageHydrate(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(all)) {
        storageCache.set(key, value);
    }
}

export function storageGet<T>(key: string, defaultValue: T): T {
    try {
        const value = storageCache.get(key);
        return value === undefined || value === null
            ? defaultValue
            : (value as T);
    } catch {
        return defaultValue;
    }
}

export function storageSet(key: string, value: unknown): void {
    storageCache.set(key, value);
    void chrome.storage.local.set({ [key]: value }).catch(() => {
        /* 存储写入失败时保留内存值 */
    });
}

export function storageDelete(key: string): void {
    storageCache.delete(key);
    void chrome.storage.local.remove(key).catch(() => {});
}

export function injectStyle(css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
}
