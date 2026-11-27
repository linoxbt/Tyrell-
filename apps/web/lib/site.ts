/** The site's public origin: set at build time, so static routes (llms.txt) carry the real host. */
export const SITE_URL =
  process.env.TYRELL_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://tyrell-mu.vercel.app");
