import { describe, expect, test } from "bun:test";
import {
    adMessages,
    buildTranscript,
    chunkTranscript,
    sectionsToTranscript,
    summaryMessages,
} from "../src/ai/prompt";
import { combinedMessages } from "../src/ai/combined";
import type { SubtitleItem, SummarySection } from "../src/types";

const items: SubtitleItem[] = [
    { from: 0, to: 2, content: "大家好" },
    { from: 2, to: 5, content: "今天介绍新产品" },
    { from: 5, to: 8, content: "点击下方链接购买" },
];

describe("buildTranscript", () => {
    test("字幕行格式 [开始秒数] 内容", () => {
        expect(buildTranscript(items)).toBe(
            "[0s] 大家好\n[2s] 今天介绍新产品\n[5s] 点击下方链接购买",
        );
    });
});

describe("chunkTranscript", () => {
    test("短字幕单块", () => {
        expect(chunkTranscript(items).length).toBe(1);
    });

    test("超预算切多块且不丢行", () => {
        const many: SubtitleItem[] = Array.from({ length: 2000 }, (_, i) => ({
            from: i * 2,
            to: i * 2 + 2,
            content: "x".repeat(20),
        }));
        const chunks = chunkTranscript(many, 5000);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.flat().length).toBe(many.length);
    });
});

describe("combinedMessages", () => {
    const meta = { title: "T", upName: "U", duration: 600 };

    test("广告要求必须排在总结要求之前 (流式优先返回广告)", () => {
        const message = combinedMessages(meta, "transcript", {
            summary: true,
            ads: true,
        })[1];
        const content = message!.content;
        const adsIndex = content.indexOf("ads (数组, 必须放在最前)");
        const sectionsIndex = content.indexOf("sections (数组)");
        expect(adsIndex).toBeGreaterThanOrEqual(0);
        expect(sectionsIndex).toBeGreaterThan(adsIndex);
    });

    test("只开总结时要求中不包含广告条目", () => {
        const content = combinedMessages(meta, "t", { summary: true, ads: false })[1]!
            .content;
        expect(content).not.toContain("ads (数组, 必须放在最前)");
        expect(content).toContain("sections (数组)");
        expect(content).toContain("请生成: 视频总结");
    });

    test("只开广告时要求中不包含总结条目", () => {
        const content = combinedMessages(meta, "t", { summary: false, ads: true })[1]!
            .content;
        expect(content).toContain("ads (数组, 必须放在最前)");
        expect(content).not.toContain("overview (字符串)");
        expect(content).toContain("请生成: 广告识别");
    });
});

describe("summaryMessages / adMessages", () => {
    const meta = { title: "T", upName: "U", duration: 600 };

    test("总结消息包含 JSON 模板", () => {
        const content = summaryMessages(meta, "t")[1]!.content;
        expect(content).toContain('"sections"');
        expect(content).toContain('"overview"');
    });

    test("广告消息包含宁可漏判不可误判规则", () => {
        const content = adMessages(meta, "t")[1]!.content;
        expect(content).toContain("宁可漏判不可误判");
    });
});

describe("sectionsToTranscript", () => {
    test("章节转压缩素材", () => {
        const sections: SummarySection[] = [
            { start: 10, end: 60, title: "开场", content: "介绍" },
        ];
        expect(sectionsToTranscript(sections)).toBe("[10s] 开场\n介绍");
    });
});
