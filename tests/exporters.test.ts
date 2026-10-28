import { describe, expect, test } from "bun:test";
import { buildSummaryMarkdown } from "../src/ui/exporters";
import type { SubtitleDoc, SummaryResult } from "../src/types";

const doc: SubtitleDoc = {
    bvid: "BV1test",
    part: 1,
    title: "测试视频",
    upName: "UP",
    duration: 600,
    tracks: [],
    track: null,
    items: [],
};

describe("buildSummaryMarkdown", () => {
    const summary: SummaryResult = {
        overview: "整体概括",
        sections: [
            { start: 10, end: 60, title: "开场", content: "内容 A" },
        ],
    };

    test("包含标题/链接/UP主/章节与跳转链接", () => {
        const md = buildSummaryMarkdown(doc, summary);
        expect(md).toContain("# 测试视频 — 视频总结");
        expect(md).toContain("https://www.bilibili.com/video/BV1test?p=1");
        expect(md).toContain("- UP主: UP");
        expect(md).toContain("## 总览");
        expect(md).toContain("## [00:10] 开场");
        expect(md).toContain("&t=10");
        expect(md).toContain("内容 A");
    });
});
