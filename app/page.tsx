"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import {
  BOT_LEVELS,
  type BotLevel,
  type MoveClassification,
  chooseEngineMove,
  resultLabel,
  reviewRecordedMove,
  staticEvaluation,
} from "./chess-engine";

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const LEVEL_ORDER: BotLevel[] = ["novice", "club", "expert", "master"];

type PromotionChoice = { from: Square; to: Square } | null;

type GameSnapshot = { fen: string; history: Move[] };

type ReviewEntry = {
  ply: number;
  color: Color;
  san: string;
  bestSan: string;
  loss: number;
  classification: MoveClassification;
  evaluation: number;
  fenAfter: string;
  from: string;
  to: string;
};

function initialSnapshot(): GameSnapshot {
  const game = new Chess();
  return { fen: game.fen(), history: [] };
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function Icon({ name }: { name: "undo" | "hint" | "flip" | "flag" }) {
  const paths = {
    undo: <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 0 12h-1" />,
    hint: <><path d="M9 18h6M10 22h4" /><path d="M8.4 14.5A7 7 0 1 1 15.7 15c-1 .8-1.7 1.5-1.7 3h-4c0-1.6-.7-2.6-1.6-3.5Z" /></>,
    flip: <><path d="m17 3 4 4-4 4" /><path d="M3 7h18M7 21l-4-4 4-4M21 17H3" /></>,
    flag: <><path d="M5 21V4" /><path d="M5 5h11l-2 4 2 4H5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const gameRef = useRef(new Chess());
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTokenRef = useRef(0);
  const finalMovesRef = useRef<Move[]>([]);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [level, setLevel] = useState<BotLevel>("club");
  const [thinking, setThinking] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<PromotionChoice>(null);
  const [result, setResult] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const [reviewPly, setReviewPly] = useState(0);
  const [reviewProgress, setReviewProgress] = useState(0);
  const [whiteClock, setWhiteClock] = useState(600);
  const [blackClock, setBlackClock] = useState(600);
  const liveGame = useMemo(() => new Chess(snapshot.fen), [snapshot.fen]);
  const reviewFen = reviewEntries[reviewPly]?.fenAfter;
  const game = useMemo(() => new Chess(reviewMode && reviewFen ? reviewFen : snapshot.fen), [reviewFen, reviewMode, snapshot.fen]);

  const refresh = useCallback(() => {
    const current = gameRef.current;
    setSnapshot({ fen: current.fen(), history: current.history({ verbose: true }) as Move[] });
  }, []);

  const finishIfNeeded = useCallback(() => {
    if (gameRef.current.isGameOver()) {
      finalMovesRef.current = gameRef.current.history({ verbose: true }) as Move[];
      setThinking(false);
      setResult(resultLabel(gameRef.current));
      return true;
    }
    return false;
  }, []);

  const makeAiMove = useCallback(() => {
    const current = gameRef.current;
    if (current.turn() !== "b" || current.isGameOver() || result) return;
    setThinking(true);
    setSelected(null);
    setTargets(new Set());
    setHint(null);

    aiTimerRef.current = setTimeout(() => {
      const choice = chooseEngineMove(current.fen(), level);
      if (choice) {
        current.move({ from: choice.from, to: choice.to, promotion: choice.promotion ?? "q" });
        setLastMove({ from: choice.from, to: choice.to });
        refresh();
      }
      setThinking(false);
      finishIfNeeded();
    }, 380);
  }, [finishIfNeeded, level, refresh, result]);

  useEffect(() => {
    if (liveGame.turn() === "b" && !thinking && !result) makeAiMove();
  }, [makeAiMove, thinking, result, snapshot.fen, liveGame]);

  useEffect(() => () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
  }, []);

  useEffect(() => {
    if (result) return;
    const timer = setInterval(() => {
      if (gameRef.current.turn() === "w") {
        setWhiteClock((time) => {
          if (time <= 1) {
            finalMovesRef.current = gameRef.current.history({ verbose: true }) as Move[];
            setResult("Black wins on time");
          }
          return Math.max(0, time - 1);
        });
      } else {
        setBlackClock((time) => {
          if (time <= 1) {
            finalMovesRef.current = gameRef.current.history({ verbose: true }) as Move[];
            setResult("White wins on time");
          }
          return Math.max(0, time - 1);
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);

  const legalTargets = useCallback((square: Square) => {
    const moves = gameRef.current.moves({ square, verbose: true }) as Move[];
    setTargets(new Set(moves.map((move) => move.to)));
  }, []);

  const commitHumanMove = useCallback((from: Square, to: Square, promoteTo: PieceSymbol = "q") => {
    try {
      const move = gameRef.current.move({ from, to, promotion: promoteTo });
      setLastMove({ from: move.from, to: move.to });
      setSelected(null);
      setTargets(new Set());
      setHint(null);
      setPromotion(null);
      refresh();
      finishIfNeeded();
    } catch {
      setSelected(null);
      setTargets(new Set());
    }
  }, [finishIfNeeded, refresh]);

  const tryHumanMove = useCallback((from: Square, to: Square) => {
    const options = gameRef.current.moves({ square: from, verbose: true }) as Move[];
    const matching = options.filter((move) => move.to === to);
    if (!matching.length) return;
    if (matching.some((move) => move.promotion)) {
      setPromotion({ from, to });
      return;
    }
    commitHumanMove(from, to);
  }, [commitHumanMove]);

  const handleSquare = useCallback((square: Square) => {
    if (thinking || result || gameRef.current.turn() !== "w") return;
    const piece = gameRef.current.get(square);
    if (selected && targets.has(square)) {
      tryHumanMove(selected, square);
      return;
    }
    if (piece?.color === "w") {
      setSelected(square);
      legalTargets(square);
    } else {
      setSelected(null);
      setTargets(new Set());
    }
  }, [legalTargets, result, selected, targets, thinking, tryHumanMove]);

  const newGame = useCallback(() => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    reviewTokenRef.current += 1;
    gameRef.current = new Chess();
    finalMovesRef.current = [];
    setThinking(false);
    setResult(null);
    setReviewMode(false);
    setReviewEntries([]);
    setReviewPly(0);
    setReviewProgress(0);
    setSelected(null);
    setTargets(new Set());
    setLastMove(null);
    setHint(null);
    setWhiteClock(600);
    setBlackClock(600);
    refresh();
  }, [refresh]);

  const endGame = useCallback((label: string) => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    finalMovesRef.current = gameRef.current.history({ verbose: true }) as Move[];
    setThinking(false);
    setResult(label);
  }, []);

  const startReview = useCallback(() => {
    const recorded = finalMovesRef.current.length
      ? finalMovesRef.current
      : gameRef.current.history({ verbose: true }) as Move[];
    if (!recorded.length) return;

    reviewTokenRef.current += 1;
    const token = reviewTokenRef.current;
    const replay = new Chess();
    const collected: ReviewEntry[] = [];
    setReviewMode(true);
    setReviewEntries([]);
    setReviewPly(0);
    setReviewProgress(0);

    const analyzeNext = (index: number) => {
      if (token !== reviewTokenRef.current) return;
      if (index >= recorded.length) {
        setReviewProgress(100);
        setReviewPly(Math.max(0, collected.length - 1));
        return;
      }

      const move = recorded[index];
      const beforeFen = replay.fen();
      const review = reviewRecordedMove(beforeFen, {
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      });
      replay.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
      const entry: ReviewEntry = {
        ply: index,
        color: move.color,
        san: review.san,
        bestSan: review.bestSan,
        loss: review.loss,
        classification: review.classification,
        evaluation: review.evaluation,
        fenAfter: replay.fen(),
        from: move.from,
        to: move.to,
      };
      collected.push(entry);
      setReviewEntries([...collected]);
      setReviewPly(index);
      setReviewProgress(Math.round(((index + 1) / recorded.length) * 100));
      window.setTimeout(() => analyzeNext(index + 1), 18);
    };

    window.setTimeout(() => analyzeNext(0), 30);
  }, []);

  const undo = useCallback(() => {
    if (thinking || result) return;
    const history = gameRef.current.history();
    if (!history.length) return;
    gameRef.current.undo();
    if (gameRef.current.turn() === "b") gameRef.current.undo();
    setLastMove(null);
    setHint(null);
    setSelected(null);
    setTargets(new Set());
    refresh();
  }, [refresh, result, thinking]);

  const showHint = useCallback(() => {
    if (thinking || result || gameRef.current.turn() !== "w") return;
    const choice = chooseEngineMove(gameRef.current.fen(), "expert", { budgetOverride: 450 });
    if (choice) {
      setHint({ from: choice.from, to: choice.to });
      setSelected(choice.from as Square);
      legalTargets(choice.from as Square);
    }
  }, [legalTargets, result, thinking]);

  const orderedSquares = useMemo(() => {
    const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flipped ? [...FILES].reverse() : FILES;
    return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square));
  }, [flipped]);

  const history = snapshot.history;
  const rows = Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => ({
    white: history[index * 2]?.san ?? "",
    black: history[index * 2 + 1]?.san ?? "",
  }));
  const capturedByWhite = history.filter((move) => move.color === "w" && move.captured).map((move) => PIECES.b[move.captured!]);
  const capturedByBlack = history.filter((move) => move.color === "b" && move.captured).map((move) => PIECES.w[move.captured!]);
  const evaluation = Math.max(-8, Math.min(8, staticEvaluation(game.fen()) / 100));
  const selectedReview = reviewEntries[reviewPly];
  const activeMove = reviewMode && selectedReview
    ? { from: selectedReview.from, to: selectedReview.to }
    : lastMove;
  const accuracyFor = (color: Color) => {
    const moves = reviewEntries.filter((entry) => entry.color === color);
    if (!moves.length) return 0;
    return Math.round(moves.reduce((sum, entry) => sum + Math.max(0, 100 * Math.exp(-entry.loss / 260)), 0) / moves.length);
  };
  const whiteAccuracy = accuracyFor("w");
  const blackAccuracy = accuracyFor("b");
  const criticalMoments = reviewEntries.filter((entry) => entry.classification === "Mistake" || entry.classification === "Blunder").length;

  return (
    <main className="app-shell">
      <header className="brandbar">
        <span className="brand-rule" />
        <div className="brand-mark"><span>♔</span><strong>SOVEREIGN</strong><small>CHESS CLUB</small></div>
        <span className="brand-rule" />
      </header>

      <div className="game-layout">
        <section className="play-column" aria-label="Chess game">
          <div className="player-strip opponent">
            <div className="avatar black-avatar">♟</div>
            <div className="player-copy">
              <strong>Sovereign {BOT_LEVELS[level].label}</strong>
              <span><i className="strength-bars">▂▄▆</i> {BOT_LEVELS[level].rating}</span>
            </div>
            <div className={`clock ${liveGame.turn() === "b" && !result ? "active" : ""}`}>{formatClock(blackClock)}</div>
          </div>

          <div className="board-frame">
            <div className={`chessboard ${flipped ? "flipped" : ""}`}>
              {orderedSquares.map((square, index) => {
                const piece = game.get(square);
                const file = FILES.indexOf(square[0]);
                const rank = Number(square[1]);
                const isLight = (file + rank) % 2 === 1;
                const isSelected = selected === square;
                const isTarget = targets.has(square);
                const isLast = activeMove?.from === square || activeMove?.to === square;
                const isHint = hint?.from === square || hint?.to === square;
                const showFile = index >= 56;
                const showRank = index % 8 === 0;
                return (
                  <button
                    className={`square ${isLight ? "light" : "dark"} ${isSelected ? "selected" : ""} ${isLast ? "last" : ""} ${isHint ? "hinted" : ""}`}
                    key={square}
                    onClick={() => handleSquare(square)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = event.dataTransfer.getData("text/plain") as Square;
                      if (from) tryHumanMove(from, square);
                    }}
                    aria-label={`${square}${piece ? `, ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`}
                  >
                    {showRank && <span className="rank-label">{square[1]}</span>}
                    {showFile && <span className="file-label">{square[0]}</span>}
                    {isTarget && <span className={piece ? "capture-ring" : "move-dot"} />}
                    {piece && (
                      <span
                        className={`piece ${piece.color === "w" ? "white-piece" : "black-piece"}`}
                        draggable={piece.color === "w" && !thinking && !result}
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", square)}
                      >
                        {PIECES[piece.color][piece.type]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {promotion && (
              <div className="promotion-panel" role="dialog" aria-label="Choose promotion piece">
                <span>Promote pawn to</span>
                <div>
                  {(["q", "r", "b", "n"] as PieceSymbol[]).map((piece) => (
                    <button key={piece} onClick={() => commitHumanMove(promotion.from, promotion.to, piece)}>{PIECES.w[piece]}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="player-strip user">
            <div className="avatar white-avatar">♙</div>
            <div className="player-copy"><strong>You</strong><span><i className="strength-bars">▂▄▆</i> White</span></div>
            <div className={`clock ${liveGame.turn() === "w" && !result ? "active" : ""}`}>{formatClock(whiteClock)}</div>
          </div>
        </section>

        <aside className="game-panel">
          {reviewMode ? (
            <>
              <div className="status-block review-heading">
                <p className="eyebrow">POST-GAME ANALYSIS</p>
                <h1>Your game, decoded</h1>
                <p>{result} · Reviewed by the Sovereign engine</p>
              </div>

              <section className="analysis-summary">
                <div><span>Your accuracy</span><strong>{whiteAccuracy}<small>%</small></strong></div>
                <div><span>Opponent</span><strong>{blackAccuracy}<small>%</small></strong></div>
                <div><span>Critical</span><strong>{criticalMoments}</strong></div>
              </section>

              <div className="analysis-progress" aria-label={`Analysis ${reviewProgress}% complete`}>
                <span style={{ width: `${reviewProgress}%` }} />
              </div>

              <section className="panel-section review-moves-section">
                <div className="section-heading"><span>Move-by-move</span><strong>{reviewProgress < 100 ? `Analyzing ${reviewProgress}%` : `${reviewEntries.length} reviewed`}</strong></div>
                <div className="review-move-list" aria-live="polite">
                  {reviewEntries.map((entry, index) => (
                    <button
                      key={`${entry.ply}-${entry.san}`}
                      className={`review-move ${reviewPly === index ? "active" : ""}`}
                      onClick={() => setReviewPly(index)}
                      aria-label={`Move ${Math.floor(index / 2) + 1}${entry.color === "w" ? " white" : " black"}: ${entry.san}, ${entry.classification}`}
                    >
                      <span>{Math.floor(index / 2) + 1}{entry.color === "w" ? "." : "…"}</span>
                      <b>{entry.san}</b>
                      <em className={`grade grade-${entry.classification.toLowerCase()}`}>{entry.classification}</em>
                    </button>
                  ))}
                </div>
              </section>

              <section className="panel-section review-insight">
                {selectedReview ? (
                  <>
                    <div className="insight-title"><span className={`grade-dot grade-${selectedReview.classification.toLowerCase()}`} /> <strong>{selectedReview.classification}</strong><em>{selectedReview.loss} cp lost</em></div>
                    <p>
                      {selectedReview.san === selectedReview.bestSan
                        ? `${selectedReview.san} was the engine’s first choice.`
                        : selectedReview.loss <= 18
                          ? `${selectedReview.color === "w" ? "You" : "Sovereign"} played ${selectedReview.san}, matching the top evaluation. ${selectedReview.bestSan} was another leading choice.`
                          : `${selectedReview.color === "w" ? "You" : "Sovereign"} played ${selectedReview.san}. The engine preferred ${selectedReview.bestSan}.`}
                    </p>
                    <div className="eval-chip">Position after move <b>{selectedReview.evaluation > 0 ? "+" : ""}{(selectedReview.evaluation / 100).toFixed(1)}</b></div>
                  </>
                ) : <p className="analysis-wait">The engine is reading the first position…</p>}
              </section>

              <div className="panel-actions review-actions">
                <button className="new-game" onClick={newGame}>Play another game</button>
                <div className="review-secondary">
                  <button onClick={() => setReviewMode(false)}>Back to result</button>
                  <button onClick={() => setFlipped((value) => !value)}>Flip board</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="status-block">
                <p className="eyebrow">{result ? "GAME COMPLETE" : "MATCH IN PROGRESS"}</p>
                <h1>{result ?? (thinking ? "Sovereign is thinking" : liveGame.inCheck() ? "Your king is in check" : "Your turn")}</h1>
                <p>{result ? "Review accuracy, turning points, and a better choice for every move." : thinking ? `Searching at ${BOT_LEVELS[level].label.toLowerCase()} strength…` : "Choose a piece to see its legal moves."}</p>
              </div>

              <section className="panel-section level-section">
                <div className="section-heading"><span>Opponent strength</span><strong>{BOT_LEVELS[level].rating}</strong></div>
                <div className="level-tabs" role="group" aria-label="Bot difficulty">
                  {LEVEL_ORDER.map((item) => (
                    <button key={item} className={level === item ? "active" : ""} onClick={() => setLevel(item)} disabled={thinking || Boolean(result)}>
                      {BOT_LEVELS[item].label}
                    </button>
                  ))}
                </div>
                <p className="level-description">{BOT_LEVELS[level].description}</p>
              </section>

              <section className="panel-section moves-section">
                <div className="section-heading"><span>Move history</span><strong>{history.length ? `${history.length} ply` : "Opening"}</strong></div>
                <div className="move-list" aria-live="polite">
                  {!rows.length && <div className="empty-moves"><span>♙</span><p>Your first move begins the scorecard.</p></div>}
                  {rows.map((row, index) => (
                    <div className={`move-row ${index === rows.length - 1 ? "current" : ""}`} key={index}>
                      <span>{index + 1}.</span><b>{row.white}</b><b>{row.black}</b>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel-section capture-section">
                <div className="section-heading"><span>Captured</span><strong className={evaluation > 0.15 ? "positive" : evaluation < -0.15 ? "negative" : ""}>{evaluation > 0 ? "+" : ""}{evaluation.toFixed(1)}</strong></div>
                <div className="captured-row"><span className="captured black-captured">{capturedByWhite.join("") || "—"}</span><i /><span className="captured white-captured">{capturedByBlack.join("") || "—"}</span></div>
              </section>

              <div className="panel-actions">
                <button className="new-game" onClick={result ? startReview : newGame} disabled={Boolean(result) && !history.length}>{result ? "Analyze game" : "New game"}</button>
                <div className="utilities">
                  <button onClick={undo} disabled={thinking || !history.length || Boolean(result)}><Icon name="undo" /><span>Undo</span></button>
                  <button onClick={showHint} disabled={thinking || Boolean(result)}><Icon name="hint" /><span>Hint</span></button>
                  <button onClick={() => setFlipped((value) => !value)}><Icon name="flip" /><span>Flip</span></button>
                  <button onClick={() => endGame("Black wins by resignation")} disabled={Boolean(result)}><Icon name="flag" /><span>Resign</span></button>
                </div>
                {result && <button className="text-action" onClick={newGame}>Skip review and play again</button>}
              </div>
            </>
          )}
        </aside>
      </div>

      <footer><span>Click or drag a piece to move</span><span>Legal moves, castling, en passant & promotion included</span></footer>
    </main>
  );
}
