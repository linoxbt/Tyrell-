import { describe, expect, it } from "vitest";
import { renderMarkdown, safeUrl } from "../lib/docs";

describe("docs rendering", () => {
  it("drops javascript:, data: and other script-capable link schemes", async () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) expect(safeUrl(bad), bad).toBe(false);
    for (const ok of ["/docs/x", "#anchor", "https://qie.digital", "http://127.0.0.1:7878", "mailto:a@b.c", "guides/x.md"]) expect(safeUrl(ok), ok).toBe(true);

    const html = await renderMarkdown("[click](javascript:alert(1)) [ok](/docs/faq) ![img](data:image/svg+xml,<svg/onload=alert(1)>) <a href=\"javascript:alert(2)\">raw</a>");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:image/i);
    expect(html).toContain('href="/docs/faq"');
  });
});
