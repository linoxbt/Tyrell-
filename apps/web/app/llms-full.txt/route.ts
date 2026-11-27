import { SITE_URL } from "@/lib/site";
import { ALL_PAGES, readDoc } from "@/lib/docs";

export const dynamic = "force-static";

/** Every docs page as Markdown, in navigation order, for language models. */
export function GET() {
  const parts = ALL_PAGES.flatMap((p) => {
    const d = readDoc(p.slug);
    return d ? [`# ${d.title}\n\n> ${d.description}\n\nSource: ${SITE_URL}/docs/${p.slug}\n\n${d.body.trim()}\n`] : [];
  });
  return new Response(parts.join("\n---\n\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
