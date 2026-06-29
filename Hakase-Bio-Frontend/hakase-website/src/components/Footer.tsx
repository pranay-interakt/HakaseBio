import Link from "next/link";
import Image from "next/image";
import { PRODUCTS } from "@/lib/products";

export default function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="container-x py-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/hakase-logo.png" alt="Hakase" width={28} height={28} className="h-7 w-7" />
              <span className="text-[17px] font-semibold tracking-tight">
                hakase<span className="text-cyan-600">.ai</span>
              </span>
            </Link>
            <p className="mt-5 max-w-md text-sm text-ink-600">
              The operating system for drug development. One self-improving engine, five modules, predict-then-confirm at every layer.
            </p>
            <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-mono text-ink-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />
              Engine never trains on customer data
            </div>
          </div>

          <Col title="Platform">
            {PRODUCTS.map((p) => (
              <FootLink key={p.slug} href={`/products/${p.slug}`}>{p.name}</FootLink>
            ))}
            <FootLink href="/products">Overview</FootLink>
          </Col>

          <Col title="Company">
            <FootLink href="/about">About</FootLink>
            <FootLink href="/blog">Blog</FootLink>
            <FootLink href="/contact">Contact</FootLink>
            <FootLink href="/contact?topic=partner">Partner with us</FootLink>
          </Col>

          <Col title="Legal">
            <FootLink href="#">Privacy</FootLink>
            <FootLink href="#">Terms</FootLink>
            <FootLink href="#">Security & trust</FootLink>
            <FootLink href="#">Responsible AI</FootLink>
          </Col>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-ink-100 pt-6 text-xs text-ink-500 md:flex-row">
          <div>© {new Date().getFullYear()} Hakase AI. All rights reserved.</div>
          <div className="font-mono uppercase tracking-mono">HAIOps · DAaaS · Tenant-isolated by default</div>
        </div>
      </div>
    </footer>
  );
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="md:col-span-2">
      <div className="mono-label">{title}</div>
      <ul className="mt-4 space-y-2 text-sm">{children}</ul>
    </div>
  );
}
function FootLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li><Link href={href} className="text-ink-700 hover:text-cyan-700">{children}</Link></li>
  );
}
