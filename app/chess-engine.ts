import { Chess, type Color, type Move } from "chess.js";

export type BotLevel = "novice" | "club" | "expert" | "master";

export type EngineChoice = {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  score: number;
  depth: number;
  nodes: number;
};

export type MoveClassification = "Best" | "Excellent" | "Good" | "Inaccuracy" | "Mistake" | "Blunder";

export type MoveReview = {
  san: string;
  bestSan: string;
  loss: number;
  classification: MoveClassification;
  evaluation: number;
};

type SearchContext = {
  deadline: number;
  nodes: number;
};

const MATE = 100_000;
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 0,
};

export const BOT_LEVELS: Record<
  BotLevel,
  { label: string; rating: string; depth: number; budget: number; noise: number; description: string }
> = {
  novice: {
    label: "Novice",
    rating: "900",
    depth: 1,
    budget: 80,
    noise: 260,
    description: "Friendly play with frequent tactical oversights.",
  },
  club: {
    label: "Club",
    rating: "1500",
    depth: 2,
    budget: 260,
    noise: 80,
    description: "Solid fundamentals with a little human unpredictability.",
  },
  expert: {
    label: "Expert",
    rating: "1900",
    depth: 3,
    budget: 850,
    noise: 18,
    description: "Calculates tactics and punishes loose pieces.",
  },
  master: {
    label: "Master",
    rating: "2300",
    depth: 4,
    budget: 1_800,
    noise: 0,
    description: "Deep, precise calculation under a longer think time.",
  },
};

const centrality = (file: number, rank: number) =>
  Math.max(0, 4 - (Math.abs(3.5 - file) + Math.abs(3.5 - rank))) * 3;

function whiteCentipawns(game: Chess) {
  let score = 0;
  const board = game.board();

  board.forEach((row, rank) => {
    row.forEach((piece, file) => {
      if (!piece) return;
      const sign = piece.color === "w" ? 1 : -1;
      let positional = 0;

      if (piece.type === "p") {
        const progress = piece.color === "w" ? 6 - rank : rank - 1;
        positional += Math.max(0, progress) * 7;
        if (file === 3 || file === 4) positional += 8;
      }
      if (piece.type === "n" || piece.type === "b") positional += centrality(file, rank);
      if (piece.type === "r" && (rank === 1 || rank === 6)) positional += 8;
      if (piece.type === "q") positional += centrality(file, rank) * 0.35;

      score += sign * (PIECE_VALUES[piece.type] + positional);
    });
  });

  if (game.inCheck()) score += game.turn() === "w" ? -24 : 24;
  return Math.round(score);
}

export function staticEvaluation(fen: string) {
  return whiteCentipawns(new Chess(fen));
}

function terminalScore(game: Chess, ply: number) {
  if (game.isCheckmate()) return -MATE + ply;
  if (game.isDraw()) return 0;
  return null;
}

function orderedMoves(game: Chess) {
  return (game.moves({ verbose: true }) as Move[]).sort((a, b) => {
    const aCapture = a.captured ? PIECE_VALUES[a.captured] - PIECE_VALUES[a.piece] / 10 : 0;
    const bCapture = b.captured ? PIECE_VALUES[b.captured] - PIECE_VALUES[b.piece] / 10 : 0;
    const aPromotion = a.promotion ? PIECE_VALUES[a.promotion] : 0;
    const bPromotion = b.promotion ? PIECE_VALUES[b.promotion] : 0;
    return bCapture + bPromotion - (aCapture + aPromotion);
  });
}

function negamax(game: Chess, depth: number, alpha: number, beta: number, ply: number, ctx: SearchContext): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 127) === 0 && Date.now() > ctx.deadline) throw new Error("search-timeout");

  const terminal = terminalScore(game, ply);
  if (terminal !== null) return terminal;
  if (depth === 0) {
    const whiteScore = whiteCentipawns(game);
    return game.turn() === "w" ? whiteScore : -whiteScore;
  }

  let best = -Infinity;
  for (const move of orderedMoves(game)) {
    game.move(move);
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, ctx);
    game.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function searchDepth(fen: string, depth: number, deadline: number) {
  const game = new Chess(fen);
  const ctx: SearchContext = { deadline, nodes: 0 };
  let alpha = -Infinity;
  let bestScore = -Infinity;
  let bestMoves: Move[] = [];

  for (const move of orderedMoves(game)) {
    game.move(move);
    const score = -negamax(game, depth - 1, -Infinity, -alpha, 1, ctx);
    game.undo();

    if (score > bestScore + 1) {
      bestScore = score;
      bestMoves = [move];
    } else if (Math.abs(score - bestScore) <= 1) {
      bestMoves.push(move);
    }
    if (score > alpha) alpha = score;
  }

  return { bestMoves, score: bestScore, nodes: ctx.nodes };
}

export function chooseEngineMove(
  fen: string,
  level: BotLevel,
  options: { deterministic?: boolean; depthOverride?: number; budgetOverride?: number } = {},
): EngineChoice | null {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true }) as Move[];
  if (!legal.length) return null;

  const profile = BOT_LEVELS[level];
  const targetDepth = options.depthOverride ?? profile.depth;
  const deadline = Date.now() + (options.budgetOverride ?? profile.budget);
  let completedDepth = 0;
  let nodes = 0;
  let candidates = legal;
  let bestScore = -Infinity;

  for (let depth = 1; depth <= targetDepth; depth += 1) {
    try {
      const result = searchDepth(fen, depth, deadline);
      if (result.bestMoves.length) {
        candidates = result.bestMoves;
        bestScore = result.score;
        nodes = result.nodes;
        completedDepth = depth;
      }
    } catch {
      break;
    }
  }

  if (!completedDepth) {
    candidates = legal;
    bestScore = 0;
  }

  let selected = candidates[0];
  if (!options.deterministic && profile.noise > 0) {
    const scored = legal.map((move) => {
      game.move(move);
      let raw = 0;
      try {
        raw = -negamax(
          game,
          Math.max(0, Math.min(completedDepth, 2) - 1),
          -Infinity,
          Infinity,
          1,
          { deadline: Date.now() + 100, nodes: 0 },
        );
      } catch {
        const whiteScore = whiteCentipawns(game);
        raw = game.turn() === "w" ? -whiteScore : whiteScore;
      }
      game.undo();
      return { move, noisy: raw + (Math.random() - 0.5) * profile.noise * 2 };
    });
    scored.sort((a, b) => b.noisy - a.noisy);
    selected = scored[0].move;
  } else {
    selected = candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0];
  }

  return {
    from: selected.from,
    to: selected.to,
    promotion: selected.promotion,
    san: selected.san,
    score: Math.round(bestScore),
    depth: completedDepth,
    nodes,
  };
}

function classifyLoss(loss: number): MoveClassification {
  if (loss <= 18) return "Best";
  if (loss <= 45) return "Excellent";
  if (loss <= 95) return "Good";
  if (loss <= 175) return "Inaccuracy";
  if (loss <= 325) return "Mistake";
  return "Blunder";
}

export function reviewRecordedMove(
  beforeFen: string,
  input: { from: string; to: string; promotion?: string },
): MoveReview {
  const before = new Chess(beforeFen);
  const mover = before.turn();
  const best = chooseEngineMove(beforeFen, "expert", {
    deterministic: true,
    depthOverride: 2,
    budgetOverride: 320,
  });
  const actual = before.move({ from: input.from, to: input.to, promotion: input.promotion ?? "q" });
  const evaluation = whiteCentipawns(before);

  let actualScore: number;
  if (before.isCheckmate()) actualScore = MATE;
  else if (before.isDraw()) actualScore = 0;
  else {
    const reply = chooseEngineMove(before.fen(), "club", {
      deterministic: true,
      depthOverride: 1,
      budgetOverride: 150,
    });
    actualScore = reply ? -reply.score : mover === "w" ? evaluation : -evaluation;
  }

  const loss = Math.max(0, Math.min(1_500, (best?.score ?? actualScore) - actualScore));
  return {
    san: actual.san,
    bestSan: best?.san ?? actual.san,
    loss: Math.round(loss),
    classification: classifyLoss(loss),
    evaluation,
  };
}

export function resultLabel(game: Chess) {
  if (game.isCheckmate()) return game.turn() === "w" ? "Black wins by checkmate" : "White wins by checkmate";
  if (game.isStalemate()) return "Draw by stalemate";
  if (game.isThreefoldRepetition()) return "Draw by repetition";
  if (game.isInsufficientMaterial()) return "Draw by insufficient material";
  if (game.isDraw()) return "Draw by the fifty-move rule";
  return "Game complete";
}

export function moverName(color: Color) {
  return color === "w" ? "White" : "Black";
}
