import { describe, expect, test } from "bun:test";
import { findAdHit } from "../src/ai/adHit";
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
