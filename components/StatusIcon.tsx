// Linear's status glyphs: a ring that fills as work progresses.
//
// The shape carries the state as much as the colour does — a dashed ring, a
// quarter, a half, a tick, a cross — so the set stays readable for anyone who
// cannot separate the greens from the yellows, and at 14px where hue alone is
// unreliable anyway.
//
// These are deliberately literal hex values rather than theme tokens. They are
// Linear's palette, they are identical in light and dark, and the whole point
// is that they read the same here as they do there.
import type { StatusTone } from "./ThreadStatus";
import type { StatusBucket } from "@/lib/status";

const LINEAR = {
  backlog: "#bec2c8",
  todo: "#e2e2e2",
  progress: "#f2c94c",
  review: "#4cb782",
  done: "#5e6ad2",
  blocked: "#eb5757",
  canceled: "#8a8f98",
  /** Not Linear's: an orange for the one state Linear has no word for. */
  attention: "#f2994a",
} as const;

interface Glyph {
  color: string;
  /** 0–1 of the ring filled, for the pie states. */
  fill: number;
  dashed?: boolean;
  mark?: "check" | "cross";
}

/**
 * Row tones, plus the five section buckets. "done" is shared: a merged PR
 * on a row and the Done heading above it are the same fact.
 */
export type StatusGlyphKey = StatusTone | "unread" | StatusBucket;

const BY_TONE: Record<StatusGlyphKey, Glyph> = {
  // The five buckets, as Linear draws its workflow.
  "in-progress": { color: LINEAR.progress, fill: 0.5 },
  "in-review": { color: LINEAR.review, fill: 0.75 },
  backlog: { color: LINEAR.backlog, fill: 0, dashed: true },
  canceled: { color: LINEAR.canceled, fill: 1, mark: "cross" },

  // Both of these are "nearly there, but someone has to act", so they share
  // the three-quarter ring; the hue says which kind of act. An open PR is
  // Linear's In Review exactly. A question or an approval is hotter.
  "needs-you": { color: LINEAR.attention, fill: 0.75 },
  review: { color: LINEAR.review, fill: 0.75 },
  working: { color: LINEAR.progress, fill: 0.5 },
  done: { color: LINEAR.done, fill: 1, mark: "check" },
  problem: { color: LINEAR.blocked, fill: 1, mark: "cross" },
  // Unread reads as Linear's Todo: a complete ring, nothing done to it yet.
  unread: { color: LINEAR.todo, fill: 0 },
  idle: { color: LINEAR.backlog, fill: 0, dashed: true },
};

const RADIUS = 5;
const INNER = 2.5;
const CIRCUMFERENCE = 2 * Math.PI * INNER;

export function StatusIcon({
  tone,
  label,
  className,
}: {
  tone: StatusGlyphKey;
  label?: string;
  className?: string;
}) {
  const glyph = BY_TONE[tone] ?? BY_TONE.idle;
  const filled = glyph.fill >= 1;

  return (
    <svg
      viewBox="0 0 14 14"
      className={className ?? "size-3.5 shrink-0"}
      role={label === undefined ? "presentation" : "img"}
      aria-label={label}
      aria-hidden={label === undefined}
    >
      <circle
        cx="7"
        cy="7"
        r={RADIUS}
        fill={filled ? glyph.color : "none"}
        stroke={glyph.color}
        strokeWidth="1.5"
        strokeDasharray={glyph.dashed === true ? "1.8 1.8" : undefined}
        strokeLinecap="round"
      />

      {/* The pie. Drawn as a fat stroke on a small circle so a fraction of the
          dash array reads as a filled wedge. */}
      {!filled && glyph.fill > 0 ? (
        <circle
          cx="7"
          cy="7"
          r={INNER}
          fill="none"
          stroke={glyph.color}
          strokeWidth={INNER * 2}
          strokeDasharray={`${CIRCUMFERENCE * glyph.fill} ${CIRCUMFERENCE}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}

      {/* The mark is cut out of the disc in the page's background colour,
          so it reads as a hole rather than a white scratch in dark mode. */}
      {glyph.mark === "check" ? (
        <path
          d="M4.6 7.1 6.2 8.7 9.4 5.5"
          fill="none"
          stroke="#fff"
          className="stroke-background"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {glyph.mark === "cross" ? (
        <path
          d="M5.2 5.2 8.8 8.8 M8.8 5.2 5.2 8.8"
          fill="none"
          stroke="#fff"
          className="stroke-background"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
