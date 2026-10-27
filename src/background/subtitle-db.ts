/**
 * Service Worker 侧的字幕缓存 (IndexedDB, 扩展源).
 *
 * 为什么放 SW 而不是内容脚本: 内容脚本的 IndexedDB 属于 bilibili 页面源,
 * 选项页 (扩展源) 读不到, 缓存管理就无法列出/清理字幕.
 * 数据请求全部经 SW, 字幕 JSON 由 SW 顺手写入扩展源 IDB, 两个页面上下文共享.
 */

import type { SubtitleDoc } from "../types";

const DB_NAME = "bia-cache";
const DB_VERSION = 1;
const STORE_SUBTITLES = "subtitles";

export interface SubtitleCacheInfo {
    key: string;
    title: string;
    part: number;
    savedAt: number;
    /** JSON 序列化近似字节数 */
    bytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_SUBTITLES)) {
                    db.createObjectStore(STORE_SUBTITLES);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB 打开失败"));
        });
        // 打开失败时允许下次重试
        dbPromise.catch(() => {
            dbPromise = null;
        });
    }
    return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error("IndexedDB 操作失败"));
    });
}

async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
    const db = await openDb();
    return new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE_SUBTITLES, mode);
        const store = tx.objectStore(STORE_SUBTITLES);
        const request = run(store);
        if (request) {
            request.onsuccess = () => resolve(request.result as T);
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB 操作失败"));
        } else {
            resolve(null);
        }
        tx.oncomplete = () => resolve(null);
        tx.onerror = () =>
            reject(tx.error ?? new Error("IndexedDB 事务失败"));
    });
}

export async function subtitleGet(
    key: string,
): Promise<{ doc: SubtitleDoc; savedAt: number } | null> {
    const record = await withStore<{ doc: SubtitleDoc; savedAt: number } | undefined>(
        "readonly",
        (store) => store.get(key),
    );
    if (!record?.doc) return null;
    return { doc: record.doc, savedAt: Number(record.savedAt) || 0 };
}

export async function subtitlePut(key: string, doc: SubtitleDoc): Promise<void> {
    await withStore("readwrite", (store) =>
        store.put({ doc, savedAt: Date.now() }, key),
    );
}

export async function subtitleDelete(key: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(key));
}

/** 批量删除 (单事务), 供缓存管理"清理选中"使用. */
export async function subtitleDeleteAll(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await withStore("readwrite", (store) => {
        for (const key of keys) store.delete(key);
        return null;
    });
}

/** 列出全部字幕缓存 (供选项页缓存管理展示). */
export async function subtitleList(): Promise<SubtitleCacheInfo[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const out: SubtitleCacheInfo[] = [];
        const tx = db.transaction(STORE_SUBTITLES, "readonly");
        const request = tx.objectStore(STORE_SUBTITLES).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve(out);
                return;
            }
            const record = cursor.value as
                | { doc?: SubtitleDoc; savedAt?: number }
                | undefined;
            const doc = record?.doc;
            if (doc) {
                out.push({
                    key: String(cursor.key),
                    title: String(doc.title ?? ""),
                    part: Number(doc.part ?? 1),
                    savedAt: Number(record?.savedAt ?? 0),
                    bytes: JSON.stringify(doc).length,
                });
            }
            cursor.continue();
        };
        request.onerror = () =>
            reject(request.error ?? new Error("IndexedDB 遍历失败"));
    });
}

/** 惰性清理: 删除超过保留期的字幕缓存 (ttlHours <= 0 = 永久). */
export async function subtitleDeleteExpired(ttlHours: number): Promise<void> {
    if (!ttlHours || ttlHours <= 0) return;
    const deadline = Date.now() - ttlHours * 3_600_000;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SUBTITLES, "readwrite");
        const request = tx.objectStore(STORE_SUBTITLES).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const savedAt = Number((cursor.value as { savedAt?: number })?.savedAt ?? 0);
            if (savedAt && savedAt < deadline) cursor.delete();
            cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 清理失败"));
    });
}
