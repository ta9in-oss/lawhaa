/**
 * InstantDB integration for Lawhaa – board persistence, real-time sync,
 * and Google Auth.
 *
 * InstantDB is an alternative real-time database to Firebase/Firestore.
 * https://instantdb.com
 *
 * Setup:
 *  1. Create a free app at https://instantdb.com
 *  2. Copy your App ID
 *  3. Set VITE_APP_INSTANTDB_APP_ID=<your-app-id> in .env.development / .env.production
 *
 * Google Auth setup (in the InstantDB dashboard):
 *  1. Go to your app → Auth → Google
 *  2. Add your Google OAuth client credentials
 *  3. Set VITE_APP_GOOGLE_CLIENT_NAME to the client name you registered
 *     (defaults to "google" if not set)
 *
 * When VITE_APP_INSTANTDB_APP_ID is not set this module is a no-op and the
 * app falls back to local-only storage (localStorage).
 *
 * Schema (auto-created on first write via `tx`):
 *
 *   boards {
 *     title       string
 *     elements    string  (JSON)
 *     appState    string  (JSON)
 *     shareToken  string
 *     isPublic    boolean
 *     createdAt   number  (unix ms)
 *     updatedAt   number  (unix ms)
 *   }
 */

import { init, tx, id as idbId, type User } from "@instantdb/react";

// ─── Re-export User type ──────────────────────────────────────────────────────

export type { User };

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

// ─── Initialisation ───────────────────────────────────────────────────────────

const APP_ID = import.meta.env.VITE_APP_INSTANTDB_APP_ID as string | undefined;

/** Name of the Google OAuth client registered in the InstantDB dashboard. */
const GOOGLE_CLIENT_NAME = (
  import.meta.env.VITE_APP_GOOGLE_CLIENT_NAME as string | undefined
) ?? "google";

export const INSTANTDB_CONFIGURED = !!APP_ID;

// Singleton db instance — created once so React hooks are stable across renders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = ReturnType<typeof init>;

let _db: AnyDB | null = null;

/**
 * Returns the singleton InstantDB instance.
 * Returns null when VITE_APP_INSTANTDB_APP_ID is not set.
 */
export function getInstantDB(): AnyDB | null {
  if (!INSTANTDB_CONFIGURED) {
    return null;
  }
  if (!_db) {
    _db = init({ appId: APP_ID! });
  }
  return _db;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Initiates the Google OAuth sign-in flow.
 * Redirects the user to Google; on completion, InstantDB redirects back and
 * automatically exchanges the code for a session token.
 */
export function signInWithGoogle(): void {
  const db = getInstantDB();
  if (!db) {
    console.warn("[InstantDB] Not configured — cannot sign in with Google.");
    return;
  }
  const url = db.auth.createAuthorizationURL({
    clientName: GOOGLE_CLIENT_NAME,
    redirectURL: window.location.href,
  });
  window.location.href = url;
}

/**
 * Signs the current user out.
 */
export async function signOutInstantDB(): Promise<void> {
  const db = getInstantDB();
  if (!db) {
    return;
  }
  await db.auth.signOut();
}

/**
 * Hook: returns the current InstantDB auth state.
 * `{ user, isLoading, error }` — mirrors InstantDB's useAuth() shape.
 * Returns a stable "not configured" sentinel when InstantDB is not set up.
 */
export function useInstantAuth(): {
  user: User | null;
  isLoading: boolean;
  error: unknown;
} {
  const db = getInstantDB();

  // Must call hook unconditionally (Rules of Hooks). When db is null we still
  // call `db?.useAuth()` which evaluates to undefined and we fall through.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = db?.useAuth();

  if (!db || !result) {
    return { user: null, isLoading: false, error: null };
  }

  return {
    user: result.user ?? null,
    isLoading: result.isLoading,
    error: result.error,
  };
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

/** Make a board public. */
export async function shareBoardInInstantDB(
  boardId: string,
  _shareToken: string,
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
  const board =
    (data?.boards as unknown as InstantBoard[] | undefined)?.[0] ?? null;

  return { board, isLoading, error };
}
