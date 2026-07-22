# Sovereign Chess

A polished browser chess game with a fully local computer opponent and post-game analysis.

## Features

- Complete legal chess rules through `chess.js`, including castling, en passant, promotion, repetition, stalemate, and checkmate
- Four AI levels: Novice, Club, Expert, and Master
- Iterative-deepening negamax search with alpha-beta pruning, move ordering, positional evaluation, and per-level time limits
- Click-to-move and drag-and-drop controls
- Legal-move highlights, hints, undo, board flipping, clocks, move history, and captured pieces
- Post-game accuracy scores and move-by-move classifications
- Engine alternatives, centipawn loss, position evaluation, and replayable analysis positions
- Responsive layouts for desktop, tablet, and mobile

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Quality checks

```bash
npm run lint
npm run build
```

The app is implemented with React, TypeScript, Vinext, and `chess.js`.
