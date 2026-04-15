/**
 * Local-storage backed boards manager.
 *
 * Used as a fallback when InstantDB is not configured, or as the primary
 * storage for offline/self-hosted deployments.
 *
 * Storage layout:
 *   localStorage["lawhaa-boards-index"]  → JSON string of BoardMeta[]
 *   localStorage["lawhaa-board-<id>"]    → JSON string of BoardData
 */

export interface BoardMeta {
  id: string;
  title: string;
  shareToken: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BoardData extends BoardMeta {
  elements: string; // JSON
  appState: string; // JSON
}

const INDEX_KEY = "lawhaa-boards-index";
const boardKey = (id: string) => `lawhaa-board-${id}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listBoards(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) {
      return [];
    }
    const boards: BoardMeta[] = JSON.parse(raw);
    return boards.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

function saveIndex(boards: BoardMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(boards));
}

export function createLocalBoard(title: string): BoardMeta {
  const now = Date.now();
  const meta: BoardMeta = {
    id: generateId(),
    title,
    shareToken: generateShareToken(),
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  };

  const data: BoardData = {
    ...meta,
    elements: "[]",
    appState: "{}",
  };

  const boards = listBoards();
  boards.unshift(meta);
  saveIndex(boards);
  localStorage.setItem(boardKey(meta.id), JSON.stringify(data));

  return meta;
}

export function getLocalBoard(id: string): BoardData | null {
  try {
    const raw = localStorage.getItem(boardKey(id));
    return raw ? (JSON.parse(raw) as BoardData) : null;
  } catch {
    return null;
  }
}

export function saveLocalBoard(
  id: string,
  patch: Partial<Pick<BoardData, "title" | "elements" | "appState" | "isPublic">>,
): void {
  const board = getLocalBoard(id);
  if (!board) {
    return;
  }

  const updated: BoardData = {
    ...board,
    ...patch,
    updatedAt: Date.now(),
  };

  localStorage.setItem(boardKey(id), JSON.stringify(updated));

  // Update meta in index
  const boards = listBoards();
  const idx = boards.findIndex((b) => b.id === id);
  if (idx !== -1) {
    boards[idx] = {
      id: updated.id,
      title: updated.title,
      shareToken: updated.shareToken,
      isPublic: updated.isPublic,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
    saveIndex(boards);
  }
}

export function deleteLocalBoard(id: string): void {
  const boards = listBoards().filter((b) => b.id !== id);
  saveIndex(boards);
  localStorage.removeItem(boardKey(id));
}

export function getLocalBoardByShareToken(token: string): BoardData | null {
  const boards = listBoards();
  const meta = boards.find((b) => b.shareToken === token && b.isPublic);
  return meta ? getLocalBoard(meta.id) : null;
}
