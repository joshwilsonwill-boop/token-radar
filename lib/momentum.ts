// Momentum: the week's risers, a second signal beside implied value.
//
// Implied value answers what a launch would be worth. Momentum answers a different question:
// who is actually growing right now. A protocol whose locked value is climbing into its launch
// window is a better farm than one of the same size standing still, so the board carries a
// momentum score beside every implied value, and the dossier lists the week's risers.
//
// The score is deliberately hard to game. It starts from the seven-day move in locked value,
// then discounts it by size, so a tiny pool that doubles on a hundred dollars cannot outrank a
// large protocol climbing steadily. A move past the cap is treated as a launch spike or a data
// print, not a trend a farmer can chase, and the score counts only the capped part of it.
//
//   weekly   = the protocol's seven-day move, in percent; missing data counts as no move
//   clipped  = weekly held inside [-90, 150]
//   heft     = how much of the move counts, from locked value: nothing under $1M, everything
//              over $100M, and a smooth ramp between the two on a log scale
//   momentum = clipped x heft, to one decimal
//
// Rows are ordered by momentum, then by locked value, then by slug, so the order is the same on
// every run. The risers are the ten highest with a score above zero, each with a one-line reason
// written from its own numbers. No protocol name is ever special-cased.

/** The least a row must carry for the momentum score: slug, name, locked value, weekly move, rank. */
export interface MomentumRow {
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null;
  rank: number;
}

/** A board row with its momentum standing attached. */
export interface MomentumScored extends MomentumRow {
  momentum_rank: number;
  momentum_score: number;
}

/** One riser: a board row that is climbing, with its reason in plain words. */
export interface Riser {
  momentum_rank: number;
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null;
  momentum_score: number;
  reason: string;
}

/** The weekly move the score counts: past the cap it is a spike, not a trend. */
export const RISE_CAP_PCT = 150;
export const FALL_FLOOR_PCT = -90;

/** The locked-value ramp: no credit under the floor, full credit over the cap. */
export const HEFT_FLOOR_USD = 1_000_000;
export const HEFT_CAP_USD = 100_000_000;

/** How many risers the dossier lists. */
export const RISERS_COUNT = 10;

/** A number held inside a band, endpoints included. */
function clampBand(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The weekly move the score will use: the snapshot's figure, or no move when it is missing. */
function weeklyMove(change7d: number | null): number {
  return typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0;
}

/** The move after the cap: a spike counts only up to the cap, a drain only down to the floor. */
function clippedMove(change7d: number | null): number {
  return clampBand(weeklyMove(change7d), FALL_FLOOR_PCT, RISE_CAP_PCT);
}

/** The size weight: a ramp on locked value, so a tiny base cannot buy a big score. */
function heftOf(tvlUsd: number): number {
  if (!(tvlUsd > 0) || !Number.isFinite(tvlUsd)) return 0;
  const span = Math.log10(HEFT_CAP_USD) - Math.log10(HEFT_FLOOR_USD);
  return clampBand((Math.log10(tvlUsd) - Math.log10(HEFT_FLOOR_USD)) / span, 0, 1);
}

/** One protocol's momentum: its capped weekly move, weighted by its size. */
export function momentumOf(row: MomentumRow): number {
  const score = clippedMove(row.change_7d) * heftOf(row.tvl_usd);
  return Math.round(score * 10) / 10;
}

/** A dollar figure in compact words: millions with one decimal, thousands whole. */
function compactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

/** The weekly move as the risers list states it: the figure, or "more than the cap" for a spike. */
function statedMove(change7d: number | null): string {
  const raw = weeklyMove(change7d);
  if (raw > RISE_CAP_PCT) return `more than ${RISE_CAP_PCT}%`;
  return `${raw.toFixed(1)}%`;
}

/** The plain-words read on a riser's week, from the size of its score. */
function readOf(score: number): string {
  if (score >= 100) return 'the sharpest climb on the board this week';
  if (score >= 50) return 'a sharp climb, well ahead of the week';
  if (score >= 20) return 'a strong week while most of the board fell';
  if (score >= 5) return 'a steady climb in a down week';
  return 'a small gain while the market slipped';
}

/** One riser's reason: its move, its size, and what the week meant, in a single sentence. */
export function riserReason(row: MomentumScored): string {
  return `TVL up ${statedMove(row.change_7d)} in seven days on ${compactUsd(row.tvl_usd)} of TVL — ${readOf(row.momentum_score)}.`;
}

/**
 * Score every board row for momentum and pull out the risers. The board's own order is untouched:
 * momentum is a second standing beside the implied-value rank, not a re-ranking of it.
 */
export function scoreBoard<T extends MomentumRow>(rows: T[]): {
  scored: (T & { momentum_rank: number; momentum_score: number })[];
  risers: Riser[];
} {
  const withScores = rows.map((row) => ({ ...row, momentum_score: momentumOf(row) }));
  const order = [...withScores].sort(
    (a, b) => b.momentum_score - a.momentum_score || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  const rankOf = new Map(order.map((row, i) => [row.slug, i + 1]));
  const scored = withScores.map((row) => ({
    ...row,
    momentum_rank: rankOf.get(row.slug)!,
  }));
  const risers: Riser[] = order
    .filter((row) => row.momentum_score > 0)
    .slice(0, RISERS_COUNT)
    .map((row) => ({
      momentum_rank: rankOf.get(row.slug)!,
      slug: row.slug,
      name: row.name,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      momentum_score: row.momentum_score,
      reason: riserReason({ ...row, momentum_rank: rankOf.get(row.slug)! }),
    }));
  return { scored, risers };
}

/** The risers as the dossier carries them: a heading, how the score works, and the list. */
export function risersMarkdown(risers: Riser[]): string {
  const lines = [
    '# Risers — the week\'s sharpest climbs',
    '',
    'Momentum is the board\'s second signal: a protocol\'s seven-day move in locked value, capped at 150% so a launch spike counts as a spike and not a trend, then weighted by size on a log ramp from $1M to $100M, so a tiny base cannot buy a big score. The risers below are the ten highest with a score above zero.',
    '',
  ];
  for (const r of risers) {
    lines.push(`${r.momentum_rank}. ${r.name} — momentum ${r.momentum_score.toFixed(1)}, ${compactUsd(r.tvl_usd)} TVL. ${r.reason}`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}
