"use client";

import {
  Children,
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  MotionValue,
  type SpringOptions,
  useMotionValue,
  useSpring,
  useTransform,
} from "@/lib/simple-motion";
import { cn } from "@/lib/utils";

const DOCK_HEIGHT = 96;
const DEFAULT_MAGNIFICATION = 58;
const DEFAULT_DISTANCE = 132;
const DEFAULT_PANEL_HEIGHT = 52;

type DockProps = {
  children: React.ReactNode;
  className?: string;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

type DockItemProps = {
  className?: string;
  active?: boolean;
  ariaLabel?: string;
  children: React.ReactNode;
  onClick?: () => void;
};

type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
};

type DockIconProps = {
  className?: string;
  children: React.ReactNode;
};

type DockContextType = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
};

const DockContext = createContext<DockContextType | undefined>(undefined);

function DockProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: DockContextType;
}) {
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

function useDock() {
  const context = useContext(DockContext);
  if (!context) {
    throw new Error("useDock must be used within a DockProvider");
  }
  return context;
}

function Dock({
  children,
  className,
  spring = { mass: 0.14, stiffness: 190, damping: 17 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(DOCK_HEIGHT, magnification + magnification / 2),
    [magnification],
  );
  const rowHeight = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(rowHeight, spring);

  return (
    <motion.div className="dock-shell" style={{ height }}>
      <motion.div
        className={cn("dock-panel", className)}
        onMouseMove={({ pageX }) => {
          isHovered.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="LifeMind 主导航"
      >
        <DockProvider value={{ mouseX, spring, distance, magnification }}>
          {children}
        </DockProvider>
      </motion.div>
    </motion.div>
  );
}

function DockItem({ children, className, active, ariaLabel, onClick }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { distance, magnification, mouseX, spring } = useDock();
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (value) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return value - rect.x - rect.width / 2;
  });

  const widthTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [36, magnification, 36],
  );
  const width = useSpring(widthTransform, spring);

  return (
    <motion.button
      ref={ref}
      type="button"
      className={cn("dock-item", active && "dock-item-active", className)}
      style={{ width }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
    >
      {Children.map(children, (child) =>
        cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          width,
          isHovered,
        }),
      )}
    </motion.button>
  );
}

function DockLabel({ children, className, ...rest }: DockLabelProps) {
  const restProps = rest as Record<string, unknown>;
  const isHovered = restProps.isHovered as MotionValue<number>;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isHovered) return;
    const unsubscribe = isHovered.on("change", (latest) => {
      setVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          className={cn("dock-label", className)}
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: -7, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          role="tooltip"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className, ...rest }: DockIconProps) {
  const restProps = rest as Record<string, unknown>;
  const width = restProps.width as MotionValue<number>;
  const iconWidth = useTransform(width, (value) => Math.max(18, value * 0.48));

  return (
    <motion.span className={cn("dock-icon", className)} style={{ width: iconWidth }}>
      {children}
    </motion.span>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
