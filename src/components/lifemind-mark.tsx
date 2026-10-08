export type MarkPoint = readonly [number, number];

export const lifemindThreads = [
  {
    name: "blue",
    color: "#4285F4",
    sequence: 3,
    points: [[40, 38], [37, 100 / 3], [34, 86 / 3], [31, 24], [25, 15], [14, 19], [14, 28], [14, 115 / 3], [14, 146 / 3], [14, 59]],
  },
  {
    name: "red",
    color: "#EA4335",
    sequence: 1,
    points: [[40, 38], [43, 100 / 3], [46, 86 / 3], [49, 24], [55, 15], [66, 19], [66, 28], [66, 115 / 3], [66, 146 / 3], [66, 59]],
  },
  {
    name: "yellow",
    color: "#FBBC04",
    sequence: 2,
    points: [[40, 49], [38, 53], [36, 57], [34, 61], [28, 72], [14, 70], [14, 59], [14, 59], [14, 59], [14, 59]],
  },
  {
    name: "green",
    color: "#34A853",
    sequence: 0,
    points: [[40, 49], [42, 53], [44, 57], [46, 61], [52, 72], [66, 70], [66, 59], [66, 59], [66, 59], [66, 59]],
  },
] as const;

export function markThreadPath(points: readonly MarkPoint[]) {
  const coordinate = ([x, y]: MarkPoint) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M${coordinate(points[0])} C${points.slice(1).map(coordinate).join(" ")}`;
}

export function LifemindMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none">
        <g strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round">
          {lifemindThreads.map((thread) => (
            <path
              key={thread.name}
              className={`mark-thread mark-thread-${thread.name}`}
              d={markThreadPath(thread.points)}
              stroke={thread.color}
            />
          ))}
        </g>
      </svg>
    </span>
  );
}
