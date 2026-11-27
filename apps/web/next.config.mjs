/** @type {import('next').NextConfig} */
const nextConfig = {
  // tests build a second variant (e.g. with Reown configured) next to the default one
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};
export default nextConfig;
