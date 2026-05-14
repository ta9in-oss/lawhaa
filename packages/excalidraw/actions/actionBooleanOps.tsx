/**
 * Actions for boolean (set) operations on shapes:
 *   union, intersection, difference, xor.
 *
 * Each action:
 *   1. Converts selected elements to polygons (rectangles, diamonds, closed lines).
 *   2. Runs the chosen boolean op (Greiner-Hormann via @excalidraw/math).
 *   3. Replaces the selected elements with new closed-line elements for each
 *      result polygon, preserving the style of the first selected element.
 *
 * Elements that cannot be converted to polygons (arrows, text, images, etc.)
 * are silently ignored; the action is only enabled when ≥ 2 polygon-able
 * elements are selected.
 */

import React from "react";

import {
  getNonDeletedElements,
  isLineElement,
  isLinearElement,
  newElementWith,
  newLinearElement,
  CaptureUpdateAction,
} from "@excalidraw/element";

import {
  pointFrom,
  polygonFromPoints,
  polygonBoolean,
} from "@excalidraw/math";

import type { GlobalPoint, LocalPoint, Polygon, Radians } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

import {
  booleanUnionIcon,
  booleanIntersectIcon,
  booleanDifferenceIcon,
  booleanXorIcon,
} from "../components/icons";

import { t } from "../i18n";
import { getSelectedElements } from "../scene";
import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

// ─── Polygon extraction ───────────────────────────────────────────────────────

/**
 * Return true for element types we know how to convert to a polygon.
 */
function isPolygonableElement(el: ExcalidrawElement): boolean {
  if (el.type === "rectangle" || el.type === "diamond") {
    return true;
  }
  if (isLineElement(el) && el.polygon === true && el.points.length >= 3) {
    return true;
  }
  return false;
}

/**
 * Convert a supported element to a CCW Polygon<GlobalPoint>.
 * Returns null if the element type is not supported.
 */
function elementToPolygon(el: ExcalidrawElement): Polygon<GlobalPoint> | null {
  if (el.type === "rectangle") {
    const { x, y, width, height, angle } = el;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const center = pointFrom<GlobalPoint>(cx, cy);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = (px: number, py: number): GlobalPoint => {
      const rx = px - cx;
      const ry = py - cy;
      return pointFrom<GlobalPoint>(cx + rx * cos - ry * sin, cy + rx * sin + ry * cos);
    };
    // CCW: top-left → bottom-left → bottom-right → top-right
    return polygonFromPoints<GlobalPoint>([
      rotate(x, y),
      rotate(x, y + height),
      rotate(x + width, y + height),
      rotate(x + width, y),
    ]);
  }

  if (el.type === "diamond") {
    const { x, y, width, height, angle } = el;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = (px: number, py: number): GlobalPoint => {
      const rx = px - cx;
      const ry = py - cy;
      return pointFrom<GlobalPoint>(cx + rx * cos - ry * sin, cy + rx * sin + ry * cos);
    };
    // CCW: top → left → bottom → right
    return polygonFromPoints<GlobalPoint>([
      rotate(cx, y),
      rotate(x, cy),
      rotate(cx, y + height),
      rotate(x + width, cy),
    ]);
  }

  if (isLineElement(el) && el.polygon === true) {
    const { x, y, angle, points } = el;
    const cx = x + (el.width ?? 0) / 2;
    const cy = y + (el.height ?? 0) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const globalPts: GlobalPoint[] = points.map(([lx, ly]) => {
      const rx = lx - (el.width ?? 0) / 2;
      const ry = ly - (el.height ?? 0) / 2;
      return pointFrom<GlobalPoint>(cx + rx * cos - ry * sin, cy + rx * sin + ry * cos);
    });
    if (globalPts.length < 3) {
      return null;
    }
    return polygonFromPoints<GlobalPoint>(globalPts);
  }

  return null;
}

// ─── Result to element ────────────────────────────────────────────────────────

/**
 * Convert a result Polygon<GlobalPoint> back to a closed ExcalidrawLineElement,
 * adopting the style of `styleSource`.
 */
function polygonToElement(
  poly: Polygon<GlobalPoint>,
  styleSource: ExcalidrawElement,
): ExcalidrawLinearElement {
  // Strip the closing duplicate point if present.
  const pts: GlobalPoint[] =
    poly.length > 1 &&
    poly[0][0] === poly[poly.length - 1][0] &&
    poly[0][1] === poly[poly.length - 1][1]
      ? poly.slice(0, -1)
      : [...poly];

  if (pts.length < 3) {
    // Degenerate polygon – return empty element, caller should discard.
    return newLinearElement({
      type: "line",
      x: 0,
      y: 0,
      points: [],
      polygon: true,
    });
  }

  // Bounding box of the result polygon in global space.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [px, py] of pts) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  // Convert global points to element-local coordinates (origin = top-left of bbox).
  const localPts: LocalPoint[] = pts.map(([px, py]) => [
    px - minX,
    py - minY,
  ] as LocalPoint);

  return newLinearElement({
    type: "line",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: localPts,
    polygon: true,
    strokeColor: styleSource.strokeColor,
    backgroundColor: styleSource.backgroundColor,
    fillStyle: styleSource.fillStyle,
    strokeWidth: styleSource.strokeWidth,
    strokeStyle: styleSource.strokeStyle,
    roughness: styleSource.roughness,
    opacity: styleSource.opacity,
    angle: 0 as Radians,
  });
}

// ─── Shared perform helper ────────────────────────────────────────────────────

function performBooleanOp(
  op: "union" | "intersection" | "difference" | "xor",
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  app: AppClassProperties,
) {
  const selected = getSelectedElements(
    getNonDeletedElements(elements),
    appState,
  ).filter(isPolygonableElement);

  if (selected.length < 2) {
    return { appState, elements, captureUpdate: CaptureUpdateAction.NEVER };
  }

  const polys = selected.map((el) => elementToPolygon(el)!);

  // Fold all polygons left-to-right with the chosen operation.
  let accum: Polygon<GlobalPoint>[] = [polys[0]];
  for (let i = 1; i < polys.length; i++) {
    const next: Polygon<GlobalPoint>[] = [];
    for (const a of accum) {
      const results = polygonBoolean<GlobalPoint>(a, polys[i], op);
      next.push(...results);
    }
    accum = next;
  }

  const styleSource = selected[0];
  const resultElements = accum
    .map((poly) => polygonToElement(poly, styleSource))
    .filter((el) => el.points.length >= 3);

  const selectedIds = new Set(selected.map((el) => el.id));

  const newElements = [
    // Keep all non-selected elements, mark selected as deleted.
    ...elements.map((el) =>
      selectedIds.has(el.id) ? newElementWith(el, { isDeleted: true }) : el,
    ),
    // Append result elements.
    ...resultElements,
  ];

  return {
    elements: newElements,
    appState: {
      ...appState,
      selectedElementIds: Object.fromEntries(
        resultElements.map((el) => [el.id, true as const]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
}

// ─── Eligibility helper ───────────────────────────────────────────────────────

function atLeastTwoPolygonableSelected(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
): boolean {
  return (
    getSelectedElements(getNonDeletedElements(elements), appState).filter(
      isPolygonableElement,
    ).length >= 2
  );
}

// ─── Registered actions ───────────────────────────────────────────────────────

export const actionBooleanUnion = register({
  name: "booleanUnion",
  label: "labels.booleanUnion",
  icon: booleanUnionIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) =>
    performBooleanOp("union", elements, appState, app),
  predicate: (elements, appState) =>
    atLeastTwoPolygonableSelected(elements, appState),
});

export const actionBooleanIntersection = register({
  name: "booleanIntersection",
  label: "labels.booleanIntersection",
  icon: booleanIntersectIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) =>
    performBooleanOp("intersection", elements, appState, app),
  predicate: (elements, appState) =>
    atLeastTwoPolygonableSelected(elements, appState),
});

export const actionBooleanDifference = register({
  name: "booleanDifference",
  label: "labels.booleanDifference",
  icon: booleanDifferenceIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) =>
    performBooleanOp("difference", elements, appState, app),
  predicate: (elements, appState) =>
    atLeastTwoPolygonableSelected(elements, appState),
});

export const actionBooleanXor = register({
  name: "booleanXor",
  label: "labels.booleanXor",
  icon: booleanXorIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) =>
    performBooleanOp("xor", elements, appState, app),
  predicate: (elements, appState) =>
    atLeastTwoPolygonableSelected(elements, appState),
});
