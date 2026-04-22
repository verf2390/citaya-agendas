"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type RevealOnScrollProps = {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  yOffset?: number;
};

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RevealOnScroll({ children, className = "", delayMs = 0, yOffset = 18 }: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : `translateY(${yOffset}px)`,
        transition: `opacity 420ms ease-out ${delayMs}ms, transform 420ms ease-out ${delayMs}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
