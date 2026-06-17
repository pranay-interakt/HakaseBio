"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { PRODUCTS } from "@/lib/products";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [openDrop, setOpenDrop] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 4));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 z-50 w-full transition-[background,border-color,backdrop-filter] duration-200 ${
        scrolled ? "border-b border-ink-100 bg-white/85 backdrop-blur-md" : "border-b border-transparent bg-white/0"
      }`}
    >
      <div className="container-x flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/hakase-logo.png" alt="Hakase" width={32} height={32} priority className="h-7 w-7 object-contain" />
          <span className="text-[17px] font-semibold tracking-tight">
            hakase<span className="text-cyan-600">.ai</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/about">About</NavLink>
          <div
            className="relative"
            onMouseEnter={() => setOpenDrop(true)}
            onMouseLeave={() => setOpenDrop(false)}
          >
            <button className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-ink-700 hover:text-ink-900">
              Platform <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
            {openDrop && (
              <div className="absolute left-1/2 top-full z-40 w-[640px] -translate-x-1/2 pt-2">
                <div className="rounded-xl border border-ink-100 bg-white p-2 shadow-card">
                  <div className="grid grid-cols-2 gap-1">
                    {PRODUCTS.map((p, i) => (
                      <Link
                        key={p.slug}
                        href={`/products/${p.slug}`}
                        className="group flex items-start gap-3 rounded-lg p-3 transition hover:bg-ink-50"
                      >
                        <span className="mt-0.5 font-mono text-[11px] text-ink-400">0{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink-900">{p.name}</div>
                          <div className="mt-0.5 text-xs text-ink-500">{p.short}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  <Link
                    href="/products"
                    className="mt-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-ink-700 hover:bg-ink-50"
                  >
                    <span>The whole platform</span>
                    <span className="font-mono text-[11px] uppercase tracking-mono text-ink-400">overview →</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
          <NavLink href="/blog">Blog</NavLink>
          <NavLink href="/contact">Contact</NavLink>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/contact" className="btn-primary">Request a demo</Link>
        </div>

        <button
          onClick={() => setMobile((m) => !m)}
          className="rounded-md p-2 text-ink-700 md:hidden"
          aria-label="Menu"
        >
          {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobile && (
        <div className="border-t border-ink-100 bg-white md:hidden">
          <div className="container-x flex flex-col py-4">
            <Link href="/about" className="py-2 text-sm">About</Link>
            <div className="py-2 text-[11px] uppercase tracking-mono text-ink-500">Platform</div>
            {PRODUCTS.map((p) => (
              <Link key={p.slug} href={`/products/${p.slug}`} className="py-2 text-sm">
                {p.name} <span className="text-ink-500">· {p.short}</span>
              </Link>
            ))}
            <Link href="/blog" className="py-2 text-sm">Blog</Link>
            <Link href="/contact" className="py-2 text-sm">Contact</Link>
            <Link href="/contact" className="btn-primary mt-3 justify-center">Request a demo</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-2 text-sm text-ink-700 hover:text-ink-900">
      {children}
    </Link>
  );
}
