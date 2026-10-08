"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { lifemindThreads, markThreadPath, type MarkPoint } from "./lifemind-mark";

const SESSION_KEY = "lifemind.startup-animation-seen";
const HOLD_MS = 220;
const FLIGHT_MS = 1_320;
const REVEAL_MS = HOLD_MS + FLIGHT_MS + 80;
const PAGE_REVEAL_MS = 360;

// Following the outline joins green → red → blue → yellow into one continuous
// line. Reverse the right/left return strokes so every adjoining endpoint agrees.
const ribbonThreads = [
  { thread: lifemindThreads[3], reverse: false },
  { thread: lifemindThreads[1], reverse: true },
  { thread: lifemindThreads[0], reverse: false },
  { thread: lifemindThreads[2], reverse: true },
].map(({ thread, reverse }) => ({
  name: thread.name,
  points: reverse ? [...thread.points].reverse() : thread.points,
}));

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number) {
  const time = clamp(value);
  return time * time * (3 - 2 * time);
}

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function flightPoint(start: MarkPoint, end: MarkPoint, progress: number, radius: number): MarkPoint {
  const time = smoothStep(progress);
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const orbit = Math.min(radius, distance * 0.24) * Math.sin(progress * Math.PI);
  const angle = progress * Math.PI * 2;

  return [
    mix(start[0], end[0], time) + orbit * (Math.cos(angle) - 1),
    mix(start[1], end[1], time) + orbit * Math.sin(angle),
  ];
}

export function StartupAnimation() {
  const [visible, setVisible] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);

  useLayoutEffect(() => {
    if (!visible) return;

    const overlay = overlayRef.current;
    const application = document.querySelector<HTMLElement>(".app-shell");
    if (!overlay || !application) {
      setVisible(false);
      return;
    }

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let alreadySeen = false;
    try {
      alreadySeen = Boolean(window.sessionStorage.getItem(SESSION_KEY));
    } catch {
      // Restricted WebViews may disable storage; playback still remains bounded.
    }

    if (motionPreference.matches || alreadySeen) {
      setVisible(false);
      return;
    }

    let finished = false;
    let revealing = false;
    let frame = 0;
    let pageReveal: Animation | null = null;
    let revealSafetyTimer = 0;
    let restoreFocus = false;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const hadApplicationFocus = Boolean(previousFocus && application.contains(previousFocus));
    const wasInert = application.inert;
    application.inert = true;
    application.dataset.startup = "playing";

    const finish = () => {
      if (finished) return;
      restoreFocus = restoreFocus || hadApplicationFocus;
      finished = true;
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // The visual sequence can finish without session storage.
      }
      setVisible(false);
    };

    let origin: MarkPoint = [window.innerWidth / 2, window.innerHeight / 2];
    let destination: MarkPoint = origin;
    let centerScale = 112 / 80;
    let destinationScale = 36 / 80;
    let canTravel = false;

    const measure = () => {
      const target = application.querySelector<HTMLElement>(".workspace-brand .brand-mark");
      const bounds = target?.getBoundingClientRect();
      origin = [window.innerWidth / 2, window.innerHeight / 2];
      centerScale = Math.min(112, window.innerWidth * 0.28) / 80;
      canTravel = Boolean(
        target
          && bounds
          && bounds.left >= 0
          && bounds.right <= window.innerWidth
          && bounds.top >= 0
          && bounds.bottom <= window.innerHeight
          && getComputedStyle(target).visibility !== "hidden",
      );

      if (bounds && canTravel) {
        destination = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
        destinationScale = bounds.width / 80;
        return;
      }

      // The compact drawer is intentionally off-canvas until the user opens it.
      // Keep the same measured sidebar geometry as a virtual destination so the
      // identity still resolves into the upper-left application lockup.
      if (window.matchMedia("(max-width: 760px)").matches) {
        const chromeBottom = application.querySelector<HTMLElement>(".app-chrome")?.getBoundingClientRect().bottom ?? 68;
        destination = [46, chromeBottom + 46];
        destinationScale = 36 / 80;
        canTravel = true;
      }
    };
    measure();

    const renderThreads = (elapsed: number) => {
      const progress = canTravel ? clamp((elapsed - HOLD_MS) / FLIGHT_MS) : 0;
      const scale = mix(centerScale, destinationScale, smoothStep(progress));
      const outline = 1 - smoothStep((progress - 0.04) / 0.2)
        + smoothStep((progress - 0.78) / 0.22);
      const span = Math.sin(progress * Math.PI) * 0.46;
      const radius = Math.max(0, Math.min(
        150,
        (origin[0] + destination[0]) / 4 - 16,
        window.innerHeight * 0.18,
      ));

      ribbonThreads.forEach((thread, ribbonIndex) => {
        const pathIndex = lifemindThreads.findIndex(({ name }) => name === thread.name);
        const path = pathsRef.current[pathIndex];
        if (!path) return;

        const points = thread.points.map(([x, y], pointIndex): MarkPoint => {
          // All four colors sample consecutive portions of the same orbit.
          // Shared endpoints use exactly the same time and outline offset,
          // keeping the ribbon joined as it opens, loops, and reforms the mark.
          const along = (ribbonIndex + pointIndex / (thread.points.length - 1))
            / ribbonThreads.length;
          const travel = clamp(progress + (0.5 - along) * span);
          const position = flightPoint(origin, destination, travel, radius);

          return [
            position[0] + (x - 40) * scale * outline,
            position[1] + (y - 40) * scale * outline,
          ];
        });

        path.setAttribute("d", markThreadPath(points));
        path.setAttribute("stroke-width", String(7.5 * scale));
      });
    };
    renderThreads(0);

    const beginReveal = () => {
      if (finished || revealing) return;
      revealing = true;
      window.cancelAnimationFrame(frame);
      renderThreads(HOLD_MS + FLIGHT_MS);
      overlay.dataset.phase = "revealing";
      application.dataset.startup = "revealing";

      // The browser owns the fade. Keep the startup layer until it actually
      // completes instead of removing it on a flight timer or resize event.
      pageReveal = application.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: PAGE_REVEAL_MS,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
        },
      );
      void pageReveal.finished.then(finish, finish);
      revealSafetyTimer = window.setTimeout(() => {
        pageReveal?.finish();
        finish();
      }, PAGE_REVEAL_MS + 250);
    };

    const startedAt = performance.now();
    const tick = (now: number) => {
      if (finished || revealing) return;
      const elapsed = now - startedAt;
      renderThreads(elapsed);

      if (elapsed >= (canTravel ? REVEAL_MS : HOLD_MS)) {
        beginReveal();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    const safetyTimer = window.setTimeout(beginReveal, REVEAL_MS + 500);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocus = true;
      beginReveal();
    };
    const handleResize = () => {
      measure();
      renderThreads(HOLD_MS + FLIGHT_MS);
      beginReveal();
    };
    const handleMotionChange = () => {
      if (motionPreference.matches) finish();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleResize);
    motionPreference.addEventListener("change", handleMotionChange);

    return () => {
      finished = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(safetyTimer);
      window.clearTimeout(revealSafetyTimer);
      pageReveal?.cancel();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleResize);
      motionPreference.removeEventListener("change", handleMotionChange);
      application.inert = wasInert;
      delete application.dataset.startup;

      if (restoreFocus) {
        const nextFocus = previousFocus?.isConnected && previousFocus !== document.body
          ? previousFocus
          : application.querySelector<HTMLElement>(".sidebar-toggle");
        nextFocus?.focus({ preventScroll: true });
      }
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className="startup-animation"
      data-phase="playing"
      aria-hidden="true"
    >
      <svg className="startup-animation-canvas" fill="none" aria-hidden="true">
        <g strokeLinecap="round" strokeLinejoin="round">
          {lifemindThreads.map((thread, index) => (
            <path
              key={thread.name}
              ref={(element) => { pathsRef.current[index] = element; }}
              data-thread={thread.name}
              stroke={thread.color}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
