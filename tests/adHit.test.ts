import { describe, expect, test } from "bun:test";
import { filterAdsByDuration, findAdHit } from "../src/ai/adHit";
import type { AdSegment } from "../src/types";

const ads: AdSegment[] = [
    { from: 10, to: 20, reason: "口播" },
    { from: 100, to: 110, reason: "带货" },
];

describe("findAdHit", () => {
    test("片段内命中", () => {
        expect(findAdHit(ads, 15)?.from).toBe(10);
        expect(findAdHit(ads, 100)?.to).toBe(110);
    });

    test("起点前 0.3s 容差内命中", () => {
        expect(findAdHit(ads, 9.8)?.from).toBe(10);
    });

    test("片段结束前 0.5s 视为已离开", () => {
        expect(findAdHit(ads, 19.6)).toBeNull();
    });

    test("片段外未命中", () => {
        expect(findAdHit(ads, 5)).toBeNull();
        expect(findAdHit(ads, 50)).toBeNull();
        expect(findAdHit([], 10)).toBeNull();
    });
});

describe("filterAdsByDuration", () => {
    const ads: AdSegment[] = [
        { from: 10, to: 12, reason: "太短" },
        { from: 30, to: 45, reason: "够长" },
    ];

    test("过滤短于阈值的片段", () => {
        expect(filterAdsByDuration(ads, 5)).toEqual([{ from: 30, to: 45, reason: "够长" }]);
    });

    test("恰好等于阈值保留", () => {
        expect(filterAdsByDuration(ads, 2).length).toBe(2);
    });

    test("阈值 <=0 不过滤", () => {
        expect(filterAdsByDuration(ads, 0).length).toBe(2);
    });
});
