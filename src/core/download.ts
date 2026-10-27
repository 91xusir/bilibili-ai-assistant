/** 触发浏览器下载一个文本文件 (内容脚本页面上下文). */
export function downloadTextFile(
    filename: string,
    content: string,
    mime = "text/markdown",
): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化 (去掉非法字符). */
export function sanitizeFilename(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}
