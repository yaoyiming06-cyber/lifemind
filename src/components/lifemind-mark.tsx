export function LifemindMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none">
        <g strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round">
          <path
            className="mark-thread mark-thread-blue"
            d="M14 59V28C14 19 25 15 31 24L40 38"
            stroke="#4285F4"
          />
          <path
            className="mark-thread mark-thread-red"
            d="M40 38L49 24C55 15 66 19 66 28V59"
            stroke="#EA4335"
          />
          <path
            className="mark-thread mark-thread-yellow"
            d="M14 59C14 70 28 72 34 61L40 49"
            stroke="#FBBC04"
          />
          <path
            className="mark-thread mark-thread-green"
            d="M66 59C66 70 52 72 46 61L40 49"
            stroke="#34A853"
          />
        </g>
      </svg>
    </span>
  );
}
