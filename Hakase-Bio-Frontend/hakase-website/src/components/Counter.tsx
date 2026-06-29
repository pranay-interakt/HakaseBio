"use client";
import { useEffect, useRef, useState } from "react";

export default function Counter({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1200
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(to * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(node);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [to, duration]);

  return <span ref={ref}>{prefix}{val.toFixed(decimals)}{suffix}</span>;
}
