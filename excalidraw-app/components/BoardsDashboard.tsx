import React, { useCallback, useEffect, useRef, useState } from "react";
import { INSTANTDB_CONFIGURED, useInstantBoards } from "../data/instantdb";
import {
  createLocalBoard,
  deleteLocalBoard,
  listBoards,
  saveLocalBoard,
  type BoardMeta,
} from "../data/localBoards";
import "./BoardsDashboard.scss";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to the excalidraw canvas for a specific board */
function openBoard(id: string) {
  window.location.hash = `#board=${id}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const GRADIENTS = [
  "",
  "alt1",
  "alt2",
  "alt3",
  "alt4",
];
const gradientClass = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[h % GRADIENTS.length];
};

// ─── Share dialog ─────────────────────────────────────────────────────────────

interface ShareDialogProps {
  board: BoardMeta;
  onClose: () => void;
  onMakePublic: () => void;
}

const ShareDialog: React.FC<ShareDialogProps> = ({
  board,
  onClose,
  onMakePublic,
}) => {
  const shareUrl = board.isPublic
    ? `${window.location.origin}${window.location.pathname}#share=${board.shareToken}`
    : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!shareUrl) {
      return;
    }
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="board-share-dialog" onClick={onClose} role="dialog" aria-modal>
      <div
        className="board-share-dialog__panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 className="board-share-dialog__title">Share "{board.title}"</h3>
          <button className="board-share-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!board.isPublic ? (
          <>
            <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
              This board is private. Make it public to generate a shareable link.
            </p>
            <button className="btn btn--primary" onClick={onMakePublic}>
              🔗 Make Public & Copy Link
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
              Share this link with anyone to view this board:
            </p>
            <div className="board-share-dialog__url-row">
              <input
                ref={inputRef}
                className="board-share-dialog__url-input"
                readOnly
                value={shareUrl ?? ""}
                onFocus={(e) => e.target.select()}
              />
              <button className="btn btn--primary" onClick={handleCopy}>
                {copied ? "✓ Copied!" : "Copy"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Board card ───────────────────────────────────────────────────────────────

interface BoardCardProps {
  board: BoardMeta;
  onOpen: () => void;
  onRename: (title: string) => void;
  onShare: () => void;
  onDelete: () => void;
}

const BoardCard: React.FC<BoardCardProps> = ({
  board,
  onOpen,
  onRename,
  onShare,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(board.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== board.title) {
      onRename(trimmed);
    } else {
      setDraftTitle(board.title);
    }
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const grad = gradientClass(board.id);

  return (
    <div
      className="board-card"
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      role="button"
      aria-label={`Open board ${board.title}`}
    >
      <div
        className={`board-card__preview${grad ? ` board-card__preview--${grad}` : ""}`}
      >
        ✏️
        {board.isPublic && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              fontSize: "0.7rem",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
              borderRadius: 99,
              padding: "2px 7px",
              fontWeight: 600,
            }}
          >
            Public
          </span>
        )}
      </div>

      <div className="board-card__body">
        {editing ? (
          <input
            ref={inputRef}
            className="board-card__title-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitRename();
              } else if (e.key === "Escape") {
                setDraftTitle(board.title);
                setEditing(false);
              }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="board-card__title">{board.title}</div>
        )}
        <div className="board-card__meta">
          Updated {formatDate(board.updatedAt)}
        </div>
      </div>

      <div className="board-card__actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="board-card__action-btn"
          onClick={() => {
            setEditing(true);
          }}
          title="Rename"
        >
          ✏️ Rename
        </button>
        <button
          className="board-card__action-btn"
          onClick={onShare}
          title="Share"
        >
          🔗 Share
        </button>
        <button
          className="board-card__action-btn board-card__action-btn--danger"
          onClick={onDelete}
          title="Delete"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

// ─── Main dashboard ───────────────────────────────────────────────────────────

const BoardsDashboard: React.FC = () => {
  // InstantDB boards (null when not configured)
  const { boards: instantBoards, isLoading } = useInstantBoards();

  // Local boards as fallback
  const [localBoards, setLocalBoards] = useState<BoardMeta[]>(() =>
    listBoards(),
  );

  // Use InstantDB if configured, otherwise local storage
  const boards = INSTANTDB_CONFIGURED ? instantBoards : localBoards;
  const loading = INSTANTDB_CONFIGURED ? isLoading : false;

  const [shareTarget, setShareTarget] = useState<BoardMeta | null>(null);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    const title = `Board ${(boards?.length ?? 0) + 1}`;

    if (INSTANTDB_CONFIGURED) {
      const { createBoardInInstantDB } = await import("../data/instantdb");
      const id = await createBoardInInstantDB(title);
      openBoard(id);
    } else {
      const meta = createLocalBoard(title);
      setLocalBoards(listBoards());
      openBoard(meta.id);
    }
  }, [boards]);

  const handleRename = useCallback(
    async (id: string, title: string) => {
      if (INSTANTDB_CONFIGURED) {
        const { renameBoardInInstantDB } = await import("../data/instantdb");
        await renameBoardInInstantDB(id, title);
      } else {
        saveLocalBoard(id, { title });
        setLocalBoards(listBoards());
      }
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this board? This cannot be undone.")) {
      return;
    }
    if (INSTANTDB_CONFIGURED) {
      const { deleteBoardFromInstantDB } = await import("../data/instantdb");
      await deleteBoardFromInstantDB(id);
    } else {
      deleteLocalBoard(id);
      setLocalBoards(listBoards());
    }
  }, []);

  const handleMakePublic = useCallback(async (board: BoardMeta) => {
    if (INSTANTDB_CONFIGURED) {
      const { shareBoardInInstantDB } = await import("../data/instantdb");
      await shareBoardInInstantDB(board.id, board.shareToken);
    } else {
      saveLocalBoard(board.id, { isPublic: true });
      setLocalBoards(listBoards());
    }
    // Re-open share dialog with updated board
    setShareTarget({ ...board, isPublic: true });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="boards-dashboard">
      {/* Header */}
      <header className="boards-dashboard__header">
        <div className="boards-dashboard__logo">
          <span style={{ fontSize: "2rem" }}>✏️</span>
          <span className="boards-dashboard__logo-text">Lawhaa</span>
        </div>

        <div className="boards-dashboard__header-actions">
          {INSTANTDB_CONFIGURED && (
            <span className="instantdb-badge">⚡ InstantDB</span>
          )}
          <button className="btn btn--primary" onClick={handleCreate}>
            + New Board
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="boards-dashboard__content">
        <h2 className="boards-dashboard__section-title">Your Boards</h2>

        {loading ? (
          <div style={{ color: "#888", textAlign: "center", padding: 40 }}>
            Loading boards…
          </div>
        ) : !boards || boards.length === 0 ? (
          <div className="boards-dashboard__empty">
            <div className="boards-dashboard__empty-icon">🖼️</div>
            <div className="boards-dashboard__empty-text">
              No boards yet. Create one to get started!
            </div>
            <button className="btn btn--primary" onClick={handleCreate}>
              + Create your first board
            </button>
          </div>
        ) : (
          <div className="boards-dashboard__grid">
            {boards.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                onOpen={() => openBoard(board.id)}
                onRename={(title) => handleRename(board.id, title)}
                onShare={() => setShareTarget(board)}
                onDelete={() => handleDelete(board.id)}
              />
            ))}

            {/* New board card */}
            <div
              className="board-card board-card--new"
              onClick={handleCreate}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              tabIndex={0}
              role="button"
              aria-label="Create new board"
            >
              <div className="board-card--new__inner">
                <span className="board-card--new__icon">+</span>
                <span className="board-card--new__label">New Board</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Share dialog */}
      {shareTarget && (
        <ShareDialog
          board={shareTarget}
          onClose={() => setShareTarget(null)}
          onMakePublic={() => handleMakePublic(shareTarget)}
        />
      )}
    </div>
  );
};

export default BoardsDashboard;
