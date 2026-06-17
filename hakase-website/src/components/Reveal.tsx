"use client";
/**
 * Pure-CSS reveal. Uses IntersectionObserver + a single transition.
 * No framer-motion, no per-element JS animation tick.
 */
import { useEffect, useRef, useState, ReactNode, ElementType } from "react";

type Props = {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
  amount?: number;
};

export default function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  amount = 0.15
}: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        });
      },
      { threshold: amount, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [amount]);

  return (
    <Tag
      ref={ref as any}
      style={{ transitionDelay: shown ? `${delay}ms` : undefined }}
      className={`transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.7,.2,1)] ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
