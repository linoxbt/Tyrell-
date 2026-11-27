import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeCopy, Toc } from "@/components/docs/PageAside";
import { REPO } from "@/components/argus/ui";
import { ALL_PAGES, loadDoc } from "@/lib/docs";
import { ORDER, tabOf } from "@/lib/docs-nav";

export const dynamicParams = false;
export function generateStaticParams() {
  return ALL_PAGES.map((p) => ({ slug: p.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const d = await loadDoc((await params).slug.join("/"));
  return d ? { title: d.title, description: d.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  const d = await loadDoc(slug);
  if (!d) notFound();
  const i = ORDER.findIndex((p) => p.slug === slug);
  const prev = i > 0 ? ORDER[i - 1] : undefined;
  const next = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : undefined;
  const tab = tabOf(slug);
  return (
    <div className="flex">
      <article className="min-w-0 flex-1 px-4 pb-24 pt-8 sm:px-8 lg:px-12 xl:pr-8">
        <div className="mx-auto max-w-[760px]">
          <div className="text-[13px] font-medium text-brand">{tab?.label}</div>
          <h1 className="mt-2 text-[32px] font-medium leading-tight tracking-[-0.025em] text-ink sm:text-[38px]">{d.title}</h1>
          {d.description && <p className="mt-3 text-[17px] leading-relaxed text-body">{d.description}</p>}
          {d.toc.length > 2 && (
            <details className="mt-6 rounded-xl border border-line px-4 py-3 text-[14px] xl:hidden">
              <summary className="cursor-pointer text-ink">On this page</summary>
              <ul className="mt-2 space-y-1">
                {d.toc.map((t) => (
                  <li key={t.id} className={t.depth === 3 ? "pl-4" : ""}>
                    <a href={`#${t.id}`} className="text-body hover:text-brand">
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="prose-docs mt-8" dangerouslySetInnerHTML={{ __html: d.html }} />
          <CodeCopy />
          <div className="mt-14 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="rounded-xl border border-line px-4 py-3 transition-colors hover:border-brand/40 hover:bg-paper">
                <div className="text-xs text-muted">Previous</div>
                <div className="mt-0.5 text-[15px] text-ink">← {prev.label}</div>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/docs/${next.slug}`} className="rounded-xl border border-line px-4 py-3 text-right transition-colors hover:border-brand/40 hover:bg-paper">
                <div className="text-xs text-muted">Next</div>
                <div className="mt-0.5 text-[15px] text-ink">{next.label} →</div>
              </Link>
            )}
          </div>
          <div className="mt-6 flex flex-wrap justify-between gap-2 text-[13px] text-muted">
            <a href={`${REPO}/blob/main/apps/web/content/docs/${slug}.md`} className="hover:text-brand">
              Edit this page on GitHub ↗
            </a>
            <a href="/llms.txt" className="hover:text-brand">
              llms.txt
            </a>
          </div>
        </div>
      </article>
      <aside className="sticky top-[101px] hidden h-[calc(100vh-101px)] w-[240px] shrink-0 overflow-y-auto py-8 pr-6 xl:block">
        <Toc items={d.toc} />
      </aside>
    </div>
  );
}
