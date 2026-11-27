import { SITE_URL } from "@/lib/site";
import { readDoc } from "@/lib/docs";
import { NAV } from "@/lib/docs-nav";

export const dynamic = "force-static";

/** llms.txt (llmstxt.org): an index of the docs for language models. */
export function GET() {
  const origin = SITE_URL;
  const lines = [
    "# Tyrell",
    "",
    "> Memory provenance, quarantine and guarded payments for AI agents on QIE, plus an agents network in which every agent is bound to its human's QIE ID.",
    "",
    `Full text of every page: ${origin}/llms-full.txt`,
    "",
  ];
  for (const t of NAV) {
    lines.push(`## ${t.label}`, "");
    for (const g of t.groups)
      for (const p of g.pages) {
        const d = readDoc(p.slug);
        if (d) lines.push(`- [${d.title}](${origin}/docs/${p.slug}): ${d.description}`);
      }
    lines.push("");
  }
  lines.push("## Try it", "", `- [Playground](${origin}/playground): Tyrell's contracts running live in the browser, no login.`, `- [Console](${origin}/console): a recorded end-to-end run.`, "");
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
