/**
 * 流式增量 JSON 提取: 在模型尚未输出完的 JSON 文本中,
 * 找出已经闭合完整的字段/数组元素, 用于边生成边渲染.
 */

/** 提取 text 中 "key": [ ... ] 数组里已完整闭合的对象元素. */
export function extractArrayItemsSoFar(
    text: string,
    arrayKey: string,
): unknown[] {
    const keyIndex = text.indexOf(`"${arrayKey}"`);
    if (keyIndex === -1) return [];
    let index = text.indexOf("[", keyIndex);
    if (index === -1) return [];
    index++;

    const items: unknown[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (; index < text.length; index++) {
        const ch = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === "{") {
            if (depth === 0) start = index;
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                try {
                    items.push(JSON.parse(text.slice(start, index + 1)));
                } catch {
                    /* 模型输出畸形对象, 跳过 */
                }
                start = -1;
            }
        } else if (ch === "]" && depth === 0) {
            break;
        }
    }
    return items;
}

/** 提取 text 中 "key": "<string>" 字段的完整字符串值 (未闭合返回 null). */
export function extractStringField(
    text: string,
    key: string,
): string | null {
    const keyIndex = text.indexOf(`"${key}"`);
    if (keyIndex === -1) return null;
    const colon = text.indexOf(":", keyIndex + key.length + 2);
    if (colon === -1) return null;
    const open = text.indexOf('"', colon + 1);
    if (open === -1) return null;

    let escaped = false;
    for (let i = open + 1; i < text.length; i++) {
        const ch = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            try {
                return JSON.parse(text.slice(open, i + 1)) as string;
            } catch {
                return null;
            }
        }
    }
    return null;
}
