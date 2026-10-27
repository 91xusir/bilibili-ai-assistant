/**
 * 读取响应体并按到达顺序回传累积文本.
 * TextDecoder 使用 stream 模式, 保证多字节 UTF-8 字符跨 chunk 时不会乱码.
 */
export async function pumpResponseBody(
    response: Response,
    onChunk: (cumulative: string) => void,
): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let cumulative = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        cumulative += decoder.decode(value, { stream: true });
        onChunk(cumulative);
    }
    cumulative += decoder.decode();
    onChunk(cumulative);
    return cumulative;
}
