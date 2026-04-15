/**
 * InstantDB integration for Lawhaa – board persistence and real-time sync.
 *
 * InstantDB is an alternative real-time database to Firebase/Firestore.
 * https://instantdb.com
 *
 * To enable InstantDB:
 *  1. Create a free app at https://instantdb.com
 *  2. Copy your App ID
 *  3. Set VITE_APP_INSTANTDB_APP_ID=<your-app-id> in .env.development or .env.production
 *
 * If the env var is not set this module is a no-op and the app falls back to
 * local-only storage (localStorage / IndexedDB).
 *
 * Schema used in InstantDB (created automatically via `tx` on first write):
 *
 *   boards {
 *     id          string  (InstantDB auto-id)
 *     title       string
 *     elements    string  (JSON)
 *     appState    string  (JSON)
 *     shareToken  string  (random, used for public share links)
 *     isPublic    boolean
 *     createdAt   number  (unix ms)
 *     updatedAt   number  (unix ms)
 *   }
 */

import { init, tx, id as idbId } from "@instantdb/react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InstantBoard {
  id: string;
  title: string;
  elements: string; // JSON string of ExcalidrawElement[]
  appState: string; // JSON string of partial AppState
  shareToken: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Initialisation (lazy / optional) ────────────────────────────────────────

const APP_ID = import.meta.env.VITE_APP_INSTANTDB_APP_ID as string | undefined;

export const INSTANTDB_CONFIGURED = !!APP_ID;

// We initialise lazily so that the app works without an APP_ID.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: ReturnType<typeof init> | null = null;

export function getInstantDB() {
  if (!INSTANTDB_CONFIGURED) {
    return null;
  }
  if (!_db) {
    _db = init({ appId: APP_ID! });
  }
  return _db;
}

// ─── Board CRUD helpers ───────────────────────────────────────────────────────

/** Generate a short random share token. */
function generateShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Create a new board in InstantDB. Returns the new board id. */
export async function createBoardInInstantDB(title: string): Promise<string> {
  const db = getInstantDB();
  if (!db) {
    throw new Error("InstantDB is not configured");
  }

  const newId = idbId();
  const now = Date.now();

  await db.transact(
    tx.boards[newId].update({
      title,
      elements: "[]",
      appState: "{}",
      shareToken: generateShareToken(),
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    }),
  );

  return newId;
}

/** Save (overwrite) scene data for a board. */
export async function saveBoardToInstantDB(
  boardId: string,
  data: { elements: string; appState: string },
): Promise<void> {
  const db = getInstantDB();
  if (!db) {
    return;
  }

  await db.transact(
    tx.boards[boardId].update({
      elements: data.elements,
      appState: data.appState,
      updatedAt: Date.now(),
    }),
  );
}

/** Update board title. */
export async function renameBoardInInstantDB(
  boardId: string,
  title: string,
): Promise<void> {
  const db = getInstantDB();
  if (!db) {
    return;
  }

  await db.transact(
    tx.boards[boardId].update({ title, updatedAt: Date.now() }),
  );
}

/** Delete a board. */
export async function deleteBoardFromInstantDB(
  boardId: string,
): Promise<void> {
  const db = getInstantDB();
  if (!db) {
    return;
  }

  await db.transact(tx.boards[boardId].delete());
}

/** Make a board public (returns share URL). */
export async function shareBoardInInstantDB(
  boardId: string,
  shareToken: string,
): Promise<void> {
  const db = getInstantDB();
  if (!db) {
    return;
  }

  await db.transact(
    tx.boards[boardId].update({ isPublic: true, updatedAt: Date.now() }),
  );
}

// ─── React hooks (wrappers around InstantDB useQuery) ─────────────────────────

/**
 * Hook: subscribe to all boards (sorted by updatedAt desc).
 * Returns `{ boards, isLoading, error }`.
 * Falls back to `{ boards: null, isLoading: false, error: null }` when
 * InstantDB is not configured.
 */
export function useInstantBoards(): {
  boards: InstantBoard[] | null;
  isLoading: boolean;
  error: unknown;
} {
  const db = getInstantDB();

  // When InstantDB is not configured, return a stable no-op result.
  // We call the hook unconditionally (Rules of Hooks) with a disabled flag.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = db?.useQuery({ boards: {} });

  if (!db || !result) {
    return { boards: null, isLoading: false, error: null };
  }

  const { data, isLoading, error } = result;

  const boards = data?.boards
    ? [...(data.boards as unknown as InstantBoard[])].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      )
    : null;

  return { boards, isLoading, error };
}

/**
 * Hook: subscribe to a single board by id.
 */
export function useInstantBoard(boardId: string | null): {
  board: InstantBoard | null;
  isLoading: boolean;
  error: unknown;
} {
  const db = getInstantDB();

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = db?.useQuery(
    boardId ? { boards: { $: { where: { id: boardId } } } } : null,
  );

  if (!db || !result || !boardId) {
    return { board: null, isLoading: false, error: null };
  }

  const { data, isLoading, error } = result;
  const board = (data?.boards as unknown as InstantBoard[] | undefined)?.[0] ?? null;

  return { board, isLoading, error };
}
