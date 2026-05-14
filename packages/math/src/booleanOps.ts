/**
 * Boolean (set) operations on 2D polygons and line segments.
 *
 * Polygon operations are implemented using the Greiner-Hormann algorithm,
 * which supports arbitrary (including non-convex) polygons.
 *
 * Supported operations:
 *   - union        (A ∪ B)
 *   - intersection (A ∩ B)
 *   - difference   (A − B)
 *   - xor          (A △ B = (A−B) ∪ (B−A))
 *
 * Known limitation: when one polygon is entirely inside the other with no
 * edge intersections, the "difference" result omits the interior hole.
 * In that case the result is approximated as the outer polygon boundary.
 */

import { pointFrom, pointsEqual } from "./point";
import { polygonFromPoints, polygonIncludesPoint } from "./polygon";
import { lineSegment, segmentsIntersectAt } from "./segment";
import { PRECISION } from "./utils";

import type { GlobalPoint, LineSegment, LocalPoint, Polygon } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export type BooleanOp = "union" | "intersection" | "difference" | "xor";

// ─── Internal vertex node ─────────────────────────────────────────────────────

type GHNode<P extends GlobalPoint | LocalPoint> = {
  point: P;
  /** Whether this node was inserted as a polygon-edge intersection */
  isIntersect: boolean;
  /**
   * True  → subject enters clip here  (subject perspective)
   * True  → clip enters subject here  (clip perspective, set separately)
   */
  isEntry: boolean;
  /** Parametric position along the parent edge [0, 1]; 0 for original vertices */
  alpha: number;
  /** Corresponding intersection node in the other polygon's list */
  neighbor: GHNode<P> | null;
  processed: boolean;
  next: GHNode<P>;
  prev: GHNode<P>;
};

// ─── Node helpers ─────────────────────────────────────────────────────────────

function makeNode<P extends GlobalPoint | LocalPoint>(
  point: P,
  alpha = 0,
): GHNode<P> {
  const node = {
    point,
    isIntersect: false,
    isEntry: false,
    alpha,
    neighbor: null,
    processed: false,
  } as unknown as GHNode<P>;
  node.next = node;
  node.prev = node;
  return node;
}

function linkAfter<P extends GlobalPoint | LocalPoint>(
  anchor: GHNode<P>,
  node: GHNode<P>,
): void {
  node.next = anchor.next;
  node.prev = anchor;
  anchor.next.prev = node;
  anchor.next = node;
}

/** Build a circular doubly-linked list from a polygon's points. */
function buildList<P extends GlobalPoint | LocalPoint>(
  poly: Polygon<P>,
): GHNode<P> {
  // Polygons are closed (first === last); drop the closing duplicate.
  const pts = polygonIsClosed(poly) ? poly.slice(0, -1) : [...poly];
  const nodes = pts.map((p) => makeNode(p));
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].next = nodes[(i + 1) % nodes.length];
    nodes[i].prev = nodes[(i - 1 + nodes.length) % nodes.length];
  }
  return nodes[0];
}

function polygonIsClosed<P extends GlobalPoint | LocalPoint>(
  poly: P[],
): boolean {
  return poly.length > 1 && pointsEqual(poly[0], poly[poly.length - 1]);
}

// ─── Phase 1 — insert intersection nodes ─────────────────────────────────────

/**
 * Find all edge-edge intersections between subject and clip, insert
 * intersection nodes into both linked lists, and link them as neighbors.
 * Returns the number of intersections found.
 */
function insertAllIntersections<P extends GlobalPoint | LocalPoint>(
  subjectHead: GHNode<P>,
  clipHead: GHNode<P>,
): number {
  let count = 0;
  let s = subjectHead;
  do {
    if (!s.isIntersect) {
      let c = clipHead;
      do {
        if (!c.isIntersect) {
          const sEnd = nextOriginal(s);
          const cEnd = nextOriginal(c);
          const ipt = segmentsIntersectAt(
            lineSegment(s.point, sEnd.point),
            lineSegment(c.point, cEnd.point),
          );
          if (ipt !== null && !nearEndpoint(ipt, s.point, sEnd.point, c.point, cEnd.point)) {
            const alphaS = edgeAlpha(s.point, sEnd.point, ipt);
            const alphaC = edgeAlpha(c.point, cEnd.point, ipt);
            const sNode = insertSorted(s, ipt, alphaS);
            const cNode = insertSorted(c, ipt, alphaC);
            sNode.neighbor = cNode;
            cNode.neighbor = sNode;
            count++;
          }
        }
        c = c.next;
      } while (c !== clipHead);
    }
    s = s.next;
  } while (s !== subjectHead);
  return count;
}

/** Walk forward past any intersection nodes to find the next original vertex. */
function nextOriginal<P extends GlobalPoint | LocalPoint>(
  node: GHNode<P>,
): GHNode<P> {
  let n = node.next;
  while (n.isIntersect) {
    n = n.next;
  }
  return n;
}

/** Return true if `pt` is too close to any of the four edge endpoints. */
function nearEndpoint<P extends GlobalPoint | LocalPoint>(
  pt: P,
  a: P,
  b: P,
  c: P,
  d: P,
): boolean {
  return (
    pointsEqual(pt, a) ||
    pointsEqual(pt, b) ||
    pointsEqual(pt, c) ||
    pointsEqual(pt, d)
  );
}

/** Parametric position of `pt` along edge a→b (result in [0,1]). */
function edgeAlpha<P extends GlobalPoint | LocalPoint>(
  a: P,
  b: P,
  pt: P,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.abs(dx) >= Math.abs(dy)
    ? (pt[0] - a[0]) / dx
    : (pt[1] - a[1]) / dy;
}

/**
 * Insert a new intersection node between `anchor` and the next original
 * vertex, sorted by alpha so multiple intersections on the same edge stay
 * in parametric order.
 */
function insertSorted<P extends GlobalPoint | LocalPoint>(
  anchor: GHNode<P>,
  point: P,
  alpha: number,
): GHNode<P> {
  const node = makeNode(point, alpha);
  node.isIntersect = true;

  // Find the correct position: after anchor, before the next node whose
  // alpha is >= ours (or before the next original vertex).
  let cur = anchor.next;
  while (cur !== anchor && cur.isIntersect && cur.alpha < alpha) {
    cur = cur.next;
  }
  linkAfter(cur.prev, node);
  return node;
}

// ─── Phase 2 — mark entry / exit ─────────────────────────────────────────────

/**
 * Walk `listHead`'s circular list and mark each intersection node as
 * entering or exiting `otherPoly`.
 *
 * `isEntry = true`  → this node is where `listHead`'s polygon crosses into `otherPoly`
 * `isEntry = false` → this node is where it exits
 */
function markEntryExit<P extends GlobalPoint | LocalPoint>(
  listHead: GHNode<P>,
  otherPoly: Polygon<P>,
): void {
  let inside = polygonIncludesPoint(listHead.point, otherPoly);
  let node = listHead;
  do {
    if (node.isIntersect) {
      node.isEntry = !inside; // entering when currently outside
      inside = !inside;
    }
    node = node.next;
  } while (node !== listHead);
}

// ─── Phase 3 — collect result polygons ───────────────────────────────────────

type TraversalConfig = {
  /** Intersection: true (start at entries). Union/Difference: false (start at exits). */
  startAtEntry: boolean;
  /** Whether to traverse the clip polygon forward (true) or backward (false). */
  clipForward: boolean;
};

const OP_CONFIG: Record<Exclude<BooleanOp, "xor">, TraversalConfig> = {
  intersection: { startAtEntry: true, clipForward: true },
  union: { startAtEntry: false, clipForward: true },
  difference: { startAtEntry: false, clipForward: false },
};

/**
 * For BOTH subject and clip nodes, an intersection triggers a polygon switch
 * when its `isEntry` flag differs from `startAtEntry`.
 *
 * Proof:
 *   Intersection  (startAtEntry=true):  switch when isEntry=false (exit)  ✓
 *   Union         (startAtEntry=false): switch when isEntry=true  (entry) ✓
 *   Difference    (startAtEntry=false): switch when isEntry=true  (entry) ✓
 *      — and clip is traversed backward so we naturally hit the right nodes —
 */
function shouldSwitch<P extends GlobalPoint | LocalPoint>(node: GHNode<P>, startAtEntry: boolean): boolean {
  return node.isEntry !== startAtEntry;
}

function advance<P extends GlobalPoint | LocalPoint>(
  node: GHNode<P>,
  forward: boolean,
): GHNode<P> {
  return forward ? node.next : node.prev;
}

function collectResults<P extends GlobalPoint | LocalPoint>(
  subjectHead: GHNode<P>,
  cfg: TraversalConfig,
): Polygon<P>[] {
  const { startAtEntry, clipForward } = cfg;
  const results: Polygon<P>[] = [];

  let s = subjectHead;
  do {
    if (s.isIntersect && s.isEntry === startAtEntry && !s.processed) {
      const points: P[] = [s.point];
      s.processed = true;

      let cur: GHNode<P> = s.next; // subject always goes forward
      let onSubject = true;
      let guard = 0;

      while (guard++ < 10_000) {
        if (cur.isIntersect && shouldSwitch(cur, startAtEntry)) {
          // Termination: if switching back would land us at the start node.
          if (cur.neighbor === s) break;

          cur.processed = true;
          if (cur.neighbor) {
            cur.neighbor.processed = true;
          }
          points.push(cur.point);

          if (onSubject) {
            // Subject → clip
            onSubject = false;
            cur = clipForward ? cur.neighbor!.next : cur.neighbor!.prev;
          } else {
            // Clip → subject (always forward)
            onSubject = true;
            cur = cur.neighbor!.next;
          }
        } else {
          points.push(cur.point);
          cur = advance(cur, onSubject || clipForward);
        }

        if (cur === s) break;
      }

      if (points.length > 2) {
        results.push(polygonFromPoints(points));
      }
    }
    s = s.next;
  } while (s !== subjectHead);

  return results;
}

// ─── No-intersection fallback ─────────────────────────────────────────────────

/**
 * When no edge crossings exist the polygons are either disjoint or one fully
 * contains the other.  Return the correct result for each operation.
 */
function noIntersectionResult<P extends GlobalPoint | LocalPoint>(
  subject: Polygon<P>,
  clip: Polygon<P>,
  op: Exclude<BooleanOp, "xor">,
): Polygon<P>[] {
  const subjInClip = polygonIncludesPoint(subject[0], clip);
  const clipInSubj = polygonIncludesPoint(clip[0], subject);

  switch (op) {
    case "intersection":
      if (subjInClip) {
        return [subject]; // subject fully inside clip
      }
      if (clipInSubj) {
        return [clip]; // clip fully inside subject
      }
      return []; // disjoint

    case "union":
      if (subjInClip) {
        return [clip]; // clip is the outer boundary
      }
      if (clipInSubj) {
        return [subject]; // subject is the outer boundary
      }
      return [subject, clip]; // disjoint — two separate regions

    case "difference":
      if (subjInClip) {
        return []; // subject is entirely inside clip — nothing remains
      }
      // clipInSubj → result has a hole; approximated here as outer boundary only.
      // Disjoint → subject unchanged.
      return [subject];
  }
}

// ─── Core driver ─────────────────────────────────────────────────────────────

function runBoolean<P extends GlobalPoint | LocalPoint>(
  subject: Polygon<P>,
  clip: Polygon<P>,
  op: Exclude<BooleanOp, "xor">,
): Polygon<P>[] {
  const subjectHead = buildList(subject);
  const clipHead = buildList(clip);

  const count = insertAllIntersections(subjectHead, clipHead);
  if (count === 0) {
    return noIntersectionResult(subject, clip, op);
  }

  markEntryExit(subjectHead, clip);
  markEntryExit(clipHead, subject);

  return collectResults(subjectHead, OP_CONFIG[op]);
}

// ─── Public polygon API ───────────────────────────────────────────────────────

/**
 * Compute a boolean set operation on two polygons.
 *
 * Both polygons should use **counter-clockwise** vertex winding.
 * The function returns an array of result polygons (multiple polygons may
 * result from a union of disjoint shapes or a difference that splits a shape).
 *
 * @param subject  The first (subject) polygon.
 * @param clip     The second (clip) polygon.
 * @param op       The boolean operation to perform.
 * @returns        Array of closed result polygons.
 */
export function polygonBoolean<P extends GlobalPoint | LocalPoint>(
  subject: Polygon<P>,
  clip: Polygon<P>,
  op: BooleanOp,
): Polygon<P>[] {
  if (op === "xor") {
    return [
      ...runBoolean(subject, clip, "difference"),
      ...runBoolean(clip, subject, "difference"),
    ];
  }
  return runBoolean(subject, clip, op);
}

/** Compute the union of two polygons (A ∪ B). */
export function polygonUnion<P extends GlobalPoint | LocalPoint>(
  a: Polygon<P>,
  b: Polygon<P>,
): Polygon<P>[] {
  return polygonBoolean(a, b, "union");
}

/** Compute the intersection of two polygons (A ∩ B). */
export function polygonIntersection<P extends GlobalPoint | LocalPoint>(
  a: Polygon<P>,
  b: Polygon<P>,
): Polygon<P>[] {
  return polygonBoolean(a, b, "intersection");
}

/** Compute the difference of two polygons (A − B). */
export function polygonDifference<P extends GlobalPoint | LocalPoint>(
  a: Polygon<P>,
  b: Polygon<P>,
): Polygon<P>[] {
  return polygonBoolean(a, b, "difference");
}

/** Compute the symmetric difference of two polygons (A △ B). */
export function polygonXor<P extends GlobalPoint | LocalPoint>(
  a: Polygon<P>,
  b: Polygon<P>,
): Polygon<P>[] {
  return polygonBoolean(a, b, "xor");
}

// ─── Line-segment operations ──────────────────────────────────────────────────

/**
 * Clip a line segment against a polygon, returning the sub-segment(s) that
 * lie inside the polygon.
 *
 * Works for arbitrary (including non-convex) polygons by:
 *   1. Collecting all parametric intersection positions with the polygon edges.
 *   2. Sorting them along the segment.
 *   3. Keeping sub-segments whose midpoints are inside the polygon.
 *
 * @param seg  The line segment to clip.
 * @param poly A closed polygon (counter-clockwise winding).
 * @returns    Array of sub-segments inside the polygon (may be empty).
 */
export function lineSegmentClipToPolygon<P extends GlobalPoint | LocalPoint>(
  seg: LineSegment<P>,
  poly: Polygon<P>,
): LineSegment<P>[] {
  const [p1, p2] = seg;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];

  // Collect entry/exit parameters t ∈ [0,1] where the segment crosses the polygon boundary.
  const params: number[] = [0, 1];
  const n = poly.length - 1; // polygon is closed
  for (let i = 0; i < n; i++) {
    const ipt = segmentsIntersectAt(seg, lineSegment(poly[i], poly[i + 1]));
    if (ipt !== null) {
      const t =
        Math.abs(dx) >= Math.abs(dy)
          ? (ipt[0] - p1[0]) / (dx || 1)
          : (ipt[1] - p1[1]) / (dy || 1);
      if (t > PRECISION && t < 1 - PRECISION) {
        params.push(t);
      }
    }
  }

  params.sort((a, b) => a - b);

  // Keep sub-segments whose midpoints are inside the polygon.
  const result: LineSegment<P>[] = [];
  for (let i = 0; i < params.length - 1; i++) {
    const tMid = (params[i] + params[i + 1]) / 2;
    const mid = pointFrom<P>(p1[0] + tMid * dx, p1[1] + tMid * dy);
    if (polygonIncludesPoint(mid, poly)) {
      const a = pointFrom<P>(
        p1[0] + params[i] * dx,
        p1[1] + params[i] * dy,
      );
      const b = pointFrom<P>(
        p1[0] + params[i + 1] * dx,
        p1[1] + params[i + 1] * dy,
      );
      result.push(lineSegment(a, b));
    }
  }
  return result;
}

/**
 * Split a line segment at all intersection points with a polygon's boundary.
 * Returns every sub-segment (both inside and outside), paired with a boolean
 * indicating whether that sub-segment is inside the polygon.
 *
 * Useful for rendering "dashed inside / solid outside" effects.
 *
 * @param seg   The line segment to split.
 * @param poly  A closed polygon.
 * @returns     Array of `{ segment, inside }` records in parametric order.
 */
export function lineSegmentSplitByPolygon<P extends GlobalPoint | LocalPoint>(
  seg: LineSegment<P>,
  poly: Polygon<P>,
): Array<{ segment: LineSegment<P>; inside: boolean }> {
  const [p1, p2] = seg;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];

  const params: number[] = [0, 1];
  const n = poly.length - 1;
  for (let i = 0; i < n; i++) {
    const ipt = segmentsIntersectAt(seg, lineSegment(poly[i], poly[i + 1]));
    if (ipt !== null) {
      const t =
        Math.abs(dx) >= Math.abs(dy)
          ? (ipt[0] - p1[0]) / (dx || 1)
          : (ipt[1] - p1[1]) / (dy || 1);
      if (t > PRECISION && t < 1 - PRECISION) {
        params.push(t);
      }
    }
  }

  params.sort((a, b) => a - b);

  return params.slice(0, -1).map((t, i) => {
    const tMid = (t + params[i + 1]) / 2;
    const mid = pointFrom<P>(p1[0] + tMid * dx, p1[1] + tMid * dy);
    const a = pointFrom<P>(p1[0] + t * dx, p1[1] + t * dy);
    const b = pointFrom<P>(
      p1[0] + params[i + 1] * dx,
      p1[1] + params[i + 1] * dy,
    );
    return {
      segment: lineSegment(a, b) as LineSegment<P>,
      inside: polygonIncludesPoint(mid, poly),
    };
  });
}
