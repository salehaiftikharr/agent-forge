/** @type {import('next').NextConfig} */
const nextConfig = {
  // The web app reads the engine's on-disk receipt/eval data from the repo root,
  // which lives one directory up from web/. Allow that during builds.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};

export default nextConfig;
