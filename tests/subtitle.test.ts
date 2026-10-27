import { describe, expect, test } from "bun:test";
import {
    findCurrentIndex,
    formatTime,
    snapTime,
} from "../src/subtitle";
import type { SubtitleItem } from "../src/types";

describe("formatTime", () => {
    test("分钟与小时格式", () => {
        expect(formatTime(65)).toBe("01:05");
        expect(formatTime(3671)).toBe("1:01:11");
        expect(formatTime(0)).toBe("00:00");
        expect(formatTime(Number.NaN)).toBe("00:00");
    });
});

describe("findCurrentIndex", () => {
    const items: SubtitleItem[] = [
        { from: 0, to: 2, content: "a" },
        { from: 5, to: 7, content: "b" },
        { from: 10, to: 12, content: "c" },
    ];

    test("命中所在行 / 边界 / 未开始", () => {
        expect(findCurrentIndex(items, 6)).toBe(1);
        expect(findCurrentIndex(items, 0)).toBe(0);
        expect(findCurrentIndex(items, 4.9)).toBe(0);
        expect(findCurrentIndex(items, 5)).toBe(1);
        expect(findCurrentIndex(items, 100)).toBe(2);
        expect(findCurrentIndex([], 5)).toBe(-1);
    });
});

describe("snapTime", () => {
    const items: SubtitleItem[] = [
        { from: 10, to: 12, content: "a" },
        { from: 20, to: 22, content: "b" },
    ];

    test("容差内吸附到字幕行开始", () => {
        expect(snapTime(11, items)).toBe(10);
        expect(snapTime(19, items)).toBe(20);
    });

    test("超出容差保留原值", () => {
        expect(snapTime(16, items, 2)).toBe(16);
    });

    test("空字幕/非法时间不吸附", () => {
        expect(snapTime(5, [], 90)).toBe(5);
        expect(snapTime(Number.NaN, items)).toBe(Number.NaN);
    });
});
