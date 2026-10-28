import { describe, expect, test } from "bun:test";
import {
    combinedMessages,
    extractCombinedSoFar,
} from "../src/ai/combined";
import { normalizeAds, normalizeSections } from "../src/ai/normalize";

describe("extractCombinedSoFar", () => {
    test("流式前段: ads 先于 sections 被提取", () => {
        const scope = { summary: true, ads: true };
        // 模拟流式: ads 已完整, sections 还没开始
        const text = '{"ads": [{"from": 1, "to": 2, "reason": "口播"}], "secti';
        const partial = extractCombinedSoFar(text, scope);
        expect(partial.ads?.length).toBe(1);
        expect(partial.sections).toBeUndefined();
    });

    test("sections 完整后可提取, overview 未闭合不影响", () => {
        const scope = { summary: true, ads: false };
        const text =
            '{"ads": [], "sections": [{"start": 1, "end": 2, "title": "a", "content": "b"}], "over';
        const partial = extractCombinedSoFar(text, scope);
        expect(partial.sections?.length).toBe(1);
        expect(partial.overview).toBeUndefined();
    });

    test("scope.summary=false 时不提取总结字段", () => {
        const scope = { summary: false, ads: true };
        const text =
            '{"ads": [{"from": 1, "to": 2}], "sections": [{"start": 3}]}';
        const partial = extractCombinedSoFar(text, scope);
        expect(partial.ads?.length).toBe(1);
        expect(partial.sections).toBeUndefined();
    });
});

describe("normalizeAds / normalizeSections", () => {
    test("过滤非法片段并按时间排序", () => {
        const ads = normalizeAds([
            { from: 30, to: 20, reason: "倒置丢弃" },
            { from: 50, to: 60, reason: " " },
            { from: 10, to: 20, reason: "口播" },
        ]);
        expect(ads.length).toBe(2);
        expect(ads[0]!.from).toBe(10);
        expect(ads[1]!.reason).toBe("广告"); // 空 reason 补默认值
    });

    test("sections 兜底字段与排序", () => {
        const sections = normalizeSections([
            { start: 20, title: "B", content: "" },
            { start: 10, title: "", content: "C" },
        ]);
        expect(sections.length).toBe(2);
        expect(sections[0]!.start).toBe(10);
        expect(sections[0]!.title).toBe("未命名章节");
    });
});

describe("combinedMessages", () => {
    test("JSON 模板不再包含 children (思维导图已移除)", () => {
        const content = combinedMessages(
            { title: "T", upName: "U", duration: 1 },
            "t",
            { summary: true, ads: true },
        )[1]!.content;
        expect(content).not.toContain("children");
    });
});
