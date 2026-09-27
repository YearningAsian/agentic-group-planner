"use client";

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeReducedMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

/** Subtle scroll reveal; disabled under prefers-reduced-motion. */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <div
      ref={ref}
      className={className}
      style={
        reduceMotion
          ? undefined
          : {
              opacity: visible ? 1 : 0,
              transform: visible ? "none" : "translateY(14px)",
              transition: `opacity 220ms ease-out ${delayMs}ms, transform 220ms ease-out ${delayMs}ms`,
            }
      }
    >
      {children}
    </div>
  );
}

export { usePrefersReducedMotion };
