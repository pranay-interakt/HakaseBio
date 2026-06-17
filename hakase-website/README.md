# Hakase — Company Website

A serious, fast, restrained marketing site for HakaseAI.

## Design notes

- **One typeface** (Inter, with JetBrains Mono for technical labels). No display
  serif, no gradient text overload.
- **Restrained motion.** No WebGL, no smooth-scroll hijacking. Animations are
  CSS-only `rise` reveals and a single CSS keyframe on the hero SVG.
- **Static-first.** Most pages are server components; only the navbar, the
  contact form and a few small reveal utilities ship JavaScript.
- **Hairline grids and mono labels** in the spirit of Recursion, Insitro,
  Owkin — not gradient backgrounds and bouncing molecules.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** with a focused ink/cyan palette
- **next-mdx-remote/rsc** for the blog (no client-side MDX runtime)
- **lucide-react** icons
- No three.js, no R3F, no Lenis, no Framer Motion.

## Run

```bash
cd hakase-website
pnpm install     # or npm install / yarn
pnpm dev         # http://localhost:3000
pnpm build && pnpm start
```

## Editing

- **Modules** — `src/lib/products.ts`
- **Blog posts** — `content/blog/*.mdx` (front-matter: `title`, `description`,
  `date`, `author`, `tag`, `readTime`)
- **Theme** — `tailwind.config.ts` + `src/app/globals.css`
- **Logo** — `public/hakase-logo.png`

## Pages

- `/` — hero, metrics row, ticker, problem framing, platform diagram, modules grid, HAIOps/DAaaS, dark CTA
- `/about` — mission/vision, six principles, timeline, CTA
- `/products` — platform diagram + module index
- `/products/[slug]` — Bio · Clinical · Commz · Care · Regdoks (each: hero, metrics, capabilities grid, optional L1/L2/L3 layers, cross-sell, dark CTA)
- `/blog` — featured + grid (MDX)
- `/blog/[slug]` — article view
- `/contact` — topic switcher + form
