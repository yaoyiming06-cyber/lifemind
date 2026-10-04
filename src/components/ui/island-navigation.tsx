"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import ToggleLeft from "lucide-react/dist/esm/icons/toggle-left.mjs";
import ToggleRight from "lucide-react/dist/esm/icons/toggle-right.mjs";
import { cn } from "@/lib/utils";

export type IslandNavigationItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
};

export type IslandNavigationProps = {
  items: readonly IslandNavigationItem[];
  active: string;
  onNavigate: (id: string) => void;
  status?: string;
  statusTone?: "idle" | "draft" | "busy" | "confirmed";
  className?: string;
};

export function IslandNavigation({
  items,
  active,
  onNavigate,
  status,
  statusTone = "idle",
  className,
}: IslandNavigationProps) {
  const [open, setOpen] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingFocus = useRef(0);
  const menuId = useId();
  const current = items.find((item) => item.id === active) ?? items[0];
  const menuLength = items.length + 1;

  useEffect(() => {
    if (!open) return;

    itemRefs.current[pendingFocus.current]?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  function focusItem(index: number) {
    const next = (index + menuLength) % menuLength;
    setFocusedIndex(next);
    itemRefs.current[next]?.focus();
  }

  function openMenu(index = 0) {
    pendingFocus.current = index;
    setFocusedIndex(index);
    if (open) focusItem(index);
    else setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function playSelectionMotion() {
    setBurstKey((key) => key + 1);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    triggerRef.current?.animate(
      [
        { transform: "translateY(0) scaleX(1)" },
        { transform: "translateY(-1px) scaleX(1.035)", offset: 0.3 },
        { transform: "translateY(1px) scaleX(.99)", offset: 0.62 },
        { transform: "translateY(0) scaleX(1)" },
      ],
      { duration: 340, easing: "cubic-bezier(.22, 1, .36, 1)" },
    );
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(focusedIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(focusedIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(menuLength - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case "Tab":
        if (event.shiftKey) {
          event.preventDefault();
          closeMenu(true);
        }
        break;
    }
  }

  if (!current) return null;
  const CurrentIcon = current.icon;
  const TextToggle = showLabel ? ToggleRight : ToggleLeft;

  return (
    <nav
      ref={rootRef}
      className={cn("island-nav", className)}
      aria-label="LifeMind 主导航"
      data-open={open}
      data-show-label={showLabel}
      data-has-status={Boolean(status)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      {burstKey > 0 && <span key={burstKey} className="island-burst" aria-hidden="true" />}
      <button
        ref={triggerRef}
        type="button"
        className="island-trigger"
        aria-label="切换页面"
        aria-description={`当前页面：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={current.label}
        onClick={() => {
          playSelectionMotion();
          if (open) closeMenu(true);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? menuLength - 1 : 0);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        <CurrentIcon className="island-current-icon" size={21} aria-hidden="true" />
        <span className="island-label" aria-hidden="true">{current.label}</span>
        {status && (
          <span className="island-status" data-tone={statusTone} aria-live="polite">
            {status}
          </span>
        )}
        <ChevronDown className="island-chevron" size={14} aria-hidden="true" />
      </button>

      <div
        id={menuId}
        className="island-menu"
        role="menu"
        aria-label="页面"
        hidden={!open}
        onKeyDown={handleMenuKeyDown}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const selected = item.id === active;

          return (
            <button
              key={item.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className="island-option"
              data-active={selected}
              aria-current={selected ? "page" : undefined}
              tabIndex={focusedIndex === index ? 0 : -1}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => {
                playSelectionMotion();
                closeMenu(true);
                onNavigate(item.id);
              }}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
              {selected && <Check className="island-option-check" size={16} aria-hidden="true" />}
            </button>
          );
        })}

        <div className="island-menu-divider" role="separator" />
        <button
          ref={(element) => { itemRefs.current[items.length] = element; }}
          type="button"
          role="menuitemcheckbox"
          className="island-options-setting"
          aria-label="导航文字常显"
          aria-checked={showLabel}
          tabIndex={focusedIndex === items.length ? 0 : -1}
          onFocus={() => setFocusedIndex(items.length)}
          onClick={() => setShowLabel((value) => !value)}
        >
          <Settings2 size={17} aria-hidden="true" />
          <span className="island-options-setting-label">显示导航文字</span>
          <TextToggle className="island-options-setting-toggle" size={24} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
