export function LifemindMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 80 80" role="img">
        <defs>
          <radialGradient id="markFace" cx="38%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="58%" stopColor="#ececea" />
            <stop offset="100%" stopColor="#cfcfcc" />
          </radialGradient>
          <linearGradient id="markStroke" x1="18" x2="64" y1="14" y2="67">
            <stop stopColor="#f9f9f7" />
            <stop offset="45%" stopColor="#a8aaa7" />
            <stop offset="100%" stopColor="#f4f4f1" />
          </linearGradient>
          <filter id="markShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#a8aaa7" floodOpacity="0.42" />
          </filter>
        </defs>
        <circle cx="40" cy="40" r="30" fill="url(#markFace)" filter="url(#markShadow)" />
        <circle cx="40" cy="40" r="25" fill="none" stroke="url(#markStroke)" strokeWidth="2.3" />
        <path
          d="M25 42C31 30 48 29 55 38C61 46 55 57 43 58C31 59 22 51 25 42Z"
          fill="none"
          stroke="#8e918e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.1"
        />
        <path
          d="M28 46C37 39 45 40 53 47M35 33L39 51M48 34L39 51"
          fill="none"
          stroke="#b8bab6"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <circle cx="35" cy="33" r="3.4" fill="#fafaf8" stroke="#9fa29e" strokeWidth="1.6" />
        <circle cx="48" cy="34" r="3.4" fill="#fafaf8" stroke="#9fa29e" strokeWidth="1.6" />
        <circle cx="39" cy="51" r="3.8" fill="#ffffff" stroke="#888b87" strokeWidth="1.7" />
      </svg>
    </span>
  );
}
