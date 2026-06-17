import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getAllPosts, getPost } from "@/lib/posts";

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) return {};
  return { title: `${post.title} · Hakase`, description: post.description };
}

export default function PostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) return notFound();

  return (
    <article>
      <section className="pt-32 md:pt-44">
        <div className="container-narrow">
          <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-cyan-700">
            <ArrowLeft className="h-4 w-4" /> Back to blog
          </Link>
          <div className="mt-8 flex items-center gap-3 font-mono text-[11px] uppercase tracking-mono text-ink-500">
            <span className="text-cyan-700">{post.tag}</span>
            <span className="h-1 w-1 rounded-full bg-ink-300" />
            <time>{new Date(post.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time>
            <span className="h-1 w-1 rounded-full bg-ink-300" />
            <span>{post.readTime}</span>
          </div>
          <h1 className="h2 mt-5">{post.title}</h1>
          <p className="lede mt-5">{post.description}</p>
          <div className="mt-6 text-sm text-ink-600">— {post.author}</div>
        </div>
      </section>

      <section className="py-16">
        <div className="container-narrow">
          <div className="hr-fade mb-10" />
          <div className="prose-content text-[17px] leading-[1.75] text-ink-800
            [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:text-ink-900 [&_h2]:mt-12 [&_h2]:mb-4
            [&_h3]:font-display [&_h3]:text-xl [&_h3]:mt-10 [&_h3]:mb-3
            [&_p]:my-5
            [&_a]:link-cyan
            [&_strong]:text-ink-900
            [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-2
            [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-400 [&_blockquote]:pl-4 [&_blockquote]:text-ink-500
            [&_code]:font-mono [&_code]:text-[14px] [&_code]:rounded [&_code]:bg-ink-50 [&_code]:px-1.5 [&_code]:py-0.5">
            <MDXRemote source={post.content} />
          </div>

          <div className="mt-16 rounded-2xl border border-ink-100 bg-white p-7">
            <div className="grid items-center gap-4 md:grid-cols-2">
              <div>
                <div className="mono-label">Continue</div>
                <div className="mt-2 font-display text-xl">More from the Hakase blog</div>
              </div>
              <div className="md:text-right">
                <Link href="/blog" className="btn-primary">
                  All posts <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </article>
  );
}
