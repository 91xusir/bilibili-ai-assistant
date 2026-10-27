import { describe, expect, test } from "bun:test";
import {
    extractArrayItemsSoFar,
    extractStringField,
} from "../src/api/streamJson";

describe("extractArrayItemsSoFar", () => {
    test("提取已完整闭合的对象元素", () => {
        const text = '{"ads": [{"from": 1, "to": 2, "reason": "a"}, {"from": 3';
        const items = extractArrayItemsSoFar(text, "ads");
        expect(items.length).toBe(1);
        expect(items[0]).toEqual({ from: 1, to: 2, reason: "a" });
    });

    test("数组未闭合时返回已闭合项", () => {
        const text =
            '{"ads": [{"from": 1}, {"to": 2}], "sections": [{"start": 5}]}';
        expect(extractArrayItemsSoFar(text, "ads").length).toBe(2);
        expect(extractArrayItemsSoFar(text, "sections").length).toBe(1);
    });

    test("字符串内的花括号/引号不干扰解析", () => {
        const text =
            '{"ads": [{"reason": "他说 \\"买它\\" {促销}"}, {"from": 2';
        const items = extractArrayItemsSoFar(text, "ads");
        expect(items.length).toBe(1);
        expect((items[0] as { reason: string }).reason).toBe('他说 "买它" {促销}');
    });

    test("key 不存在或数组未开始返回空", () => {
        expect(extractArrayItemsSoFar("", "ads")).toEqual([]);
        expect(extractArrayItemsSoFar('{"ads"', "ads")).toEqual([]);
        expect(extractArrayItemsSoFar('{"sections": [', "ads")).toEqual([]);
    });
});

describe("extractStringField", () => {
    test("提取完整字符串字段", () => {
        expect(extractStringField('{"overview": "你好\\"世界"}', "overview")).toBe(
            '你好"世界',
        );
    });

    test("字符串未闭合返回 null", () => {
        expect(extractStringField('{"overview": "进行中', "overview")).toBeNull();
    });

    test("字段不存在返回 null", () => {
        expect(extractStringField('{"a": 1}', "overview")).toBeNull();
    });

    test("字符串中包含转义反斜杠", () => {
        expect(extractStringField('{"k": "a\\\\\\", b"}', "k")).toBe('a\\", b');
    });
});
