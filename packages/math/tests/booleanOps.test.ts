import { pointFrom } from "../src/point";
import { polygonFromPoints } from "../src/polygon";
import { lineSegment } from "../src/segment";
import {
  polygonBoolean,
  polygonUnion,
  polygonIntersection,
  polygonDifference,
  polygonXor,
  lineSegmentClipToPolygon,
  lineSegmentSplitByPolygon,
} from "../src/booleanOps";
import type { GlobalPoint } from "../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type P = GlobalPoint;

function pt(x: number, y: number): P {
  return pointFrom<P>(x, y);
}

/**
 * Build a CCW rectangle polygon: [x0,y0] → [x1,y0] → [x1,y1] → [x0,y1] → close.
 */
function rect(x0: number, y0: number, x1: number, y1: number) {
  return polygonFromPoints<P>([
    pt(x0, y0),
    pt(x1, y0),
    pt(x1, y1),
    pt(x0, y1),
  ]);
}

/**
 * Normalise a polygon to a canonical rotation so that coordinate comparisons
 * are rotation-independent.  Also strips the closing duplicate if present.
 */
function canonicalise(poly: P[]): P[] {
  const pts = (
    poly.length > 1 &&
    poly[0][0] === poly[poly.length - 1][0] &&
    poly[0][1] === poly[poly.length - 1][1]
      ? poly.slice(0, -1)
      : [...poly]
  ).map((p) => [round(p[0]), round(p[1])] as P);

  // Find lexicographically smallest point as start.
  let minIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (
      pts[i][0] < pts[minIdx][0] ||
      (pts[i][0] === pts[minIdx][0] && pts[i][1] < pts[minIdx][1])
    ) {
      minIdx = i;
    }
  }
  return [...pts.slice(minIdx), ...pts.slice(0, minIdx)];
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function expectPolygon(actual: P[], expected: P[]) {
  expect(canonicalise(actual)).toEqual(canonicalise(expected));
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe("polygonIntersection", () => {
  it("overlapping rectangles – intersection is the overlap square", () => {
    // Subject: [0,0]-[4,4],  Clip: [2,2]-[6,6]  → overlap: [2,2]-[4,4]
    const subject = rect(0, 0, 4, 4);
    const clip = rect(2, 2, 6, 6);
    const result = polygonIntersection(subject, clip);
    expect(result).toHaveLength(1);
    expectPolygon(result[0], [pt(2, 2), pt(4, 2), pt(4, 4), pt(2, 4)]);
  });

  it("identical rectangles → returns the polygon itself", () => {
    const r = rect(0, 0, 4, 4);
    const result = polygonIntersection(r, r);
    // With no edge crossings (identical polys) the fallback applies: subject ⊂ clip → [subject]
    expect(result).toHaveLength(1);
  });

  it("disjoint rectangles → empty result", () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(5, 5, 7, 7);
    expect(polygonIntersection(a, b)).toHaveLength(0);
  });

  it("fully contained subject → returns subject", () => {
    const outer = rect(0, 0, 10, 10);
    const inner = rect(2, 2, 5, 5);
    const result = polygonIntersection(inner, outer);
    expect(result).toHaveLength(1);
    expectPolygon(result[0], inner);
  });
});

describe("polygonUnion", () => {
  it("overlapping rectangles – union is the L-shape outer boundary", () => {
    const subject = rect(0, 0, 4, 4);
    const clip = rect(2, 2, 6, 6);
    const result = polygonUnion(subject, clip);
    expect(result).toHaveLength(1);
    // Expected vertices (CCW, any rotation):
    // [0,0],[4,0],[4,2],[6,2],[6,6],[2,6],[2,4],[0,4]
    expect(result[0].length).toBeGreaterThanOrEqual(7);
  });

  it("disjoint rectangles → returns both polygons", () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(5, 5, 7, 7);
    const result = polygonUnion(a, b);
    expect(result).toHaveLength(2);
  });

  it("fully contained → returns the outer polygon", () => {
    const outer = rect(0, 0, 10, 10);
    const inner = rect(2, 2, 5, 5);
    const result = polygonUnion(inner, outer);
    expect(result).toHaveLength(1);
    expectPolygon(result[0], outer);
  });
});

describe("polygonDifference", () => {
  it("overlapping rectangles – difference removes the overlap", () => {
    const subject = rect(0, 0, 4, 4);
    const clip = rect(2, 2, 6, 6);
    const result = polygonDifference(subject, clip);
    expect(result).toHaveLength(1);
    // Subject minus overlap: [0,0]-[4,0]-[4,2]-[2,2]-[2,4]-[0,4]
    expect(result[0].length).toBeGreaterThanOrEqual(5);
  });

  it("disjoint rectangles → returns subject unchanged", () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(5, 5, 7, 7);
    const result = polygonDifference(a, b);
    expect(result).toHaveLength(1);
    expectPolygon(result[0], a);
  });

  it("subject fully inside clip → empty result", () => {
    const outer = rect(0, 0, 10, 10);
    const inner = rect(2, 2, 5, 5);
    const result = polygonDifference(inner, outer);
    expect(result).toHaveLength(0);
  });
});

describe("polygonXor", () => {
  it("overlapping rectangles – xor produces two non-overlapping regions", () => {
    const subject = rect(0, 0, 4, 4);
    const clip = rect(2, 2, 6, 6);
    const result = polygonXor(subject, clip);
    // xor = diff(A,B) ∪ diff(B,A) → 2 polygons
    expect(result).toHaveLength(2);
  });

  it("disjoint rectangles → same as union (2 regions)", () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(5, 5, 7, 7);
    expect(polygonXor(a, b)).toHaveLength(2);
  });
});

describe("polygonBoolean – generic dispatcher", () => {
  const a = rect(0, 0, 4, 4);
  const b = rect(2, 2, 6, 6);

  it("dispatches union correctly", () => {
    expect(polygonBoolean(a, b, "union")).toEqual(polygonUnion(a, b));
  });
  it("dispatches intersection correctly", () => {
    expect(polygonBoolean(a, b, "intersection")).toEqual(
      polygonIntersection(a, b),
    );
  });
  it("dispatches difference correctly", () => {
    expect(polygonBoolean(a, b, "difference")).toEqual(
      polygonDifference(a, b),
    );
  });
  it("dispatches xor correctly", () => {
    expect(polygonBoolean(a, b, "xor")).toEqual(polygonXor(a, b));
  });
});

describe("lineSegmentClipToPolygon", () => {
  const box = rect(0, 0, 10, 10);

  it("segment fully inside → returned as-is", () => {
    const seg = lineSegment(pt(2, 2), pt(8, 8));
    const clips = lineSegmentClipToPolygon(seg, box);
    expect(clips).toHaveLength(1);
    expect(round(clips[0][0][0])).toBe(2);
    expect(round(clips[0][1][0])).toBe(8);
  });

  it("segment fully outside → empty", () => {
    const seg = lineSegment(pt(-5, -5), pt(-1, -1));
    expect(lineSegmentClipToPolygon(seg, box)).toHaveLength(0);
  });

  it("segment crossing box → only inner part kept", () => {
    const seg = lineSegment(pt(-2, 5), pt(12, 5));
    const clips = lineSegmentClipToPolygon(seg, box);
    expect(clips).toHaveLength(1);
    expect(round(clips[0][0][0])).toBe(0);
    expect(round(clips[0][1][0])).toBe(10);
  });

  it("segment entering and exiting non-convex polygon", () => {
    // U-shape (non-convex): outer square minus a notch from the top
    // This exercises the parametric midpoint test for non-convex cases.
    const notchedPoly = polygonFromPoints<P>([
      pt(0, 0),
      pt(10, 0),
      pt(10, 10),
      pt(7, 10),
      pt(7, 5),
      pt(3, 5),
      pt(3, 10),
      pt(0, 10),
    ]);
    // Horizontal segment at y=7 crosses the notch gap at x=3..7
    const seg = lineSegment(pt(-1, 7), pt(11, 7));
    const clips = lineSegmentClipToPolygon(seg, notchedPoly);
    // Should get 2 sub-segments: 0..3 and 7..10
    expect(clips).toHaveLength(2);
  });
});

describe("lineSegmentSplitByPolygon", () => {
  const box = rect(0, 0, 10, 10);

  it("classifies inside/outside sub-segments correctly", () => {
    // Segment from outside (-2,5) to outside (12,5) crossing box
    const seg = lineSegment(pt(-2, 5), pt(12, 5));
    const parts = lineSegmentSplitByPolygon(seg, box);
    // 3 parts: outside(-2..0), inside(0..10), outside(10..12)
    expect(parts).toHaveLength(3);
    expect(parts[0].inside).toBe(false);
    expect(parts[1].inside).toBe(true);
    expect(parts[2].inside).toBe(false);
  });

  it("fully inside segment → 1 part, inside=true", () => {
    const seg = lineSegment(pt(2, 5), pt(8, 5));
    const parts = lineSegmentSplitByPolygon(seg, box);
    expect(parts).toHaveLength(1);
    expect(parts[0].inside).toBe(true);
  });
});
