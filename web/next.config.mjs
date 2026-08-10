/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained production server for the container image. Engine eval data is
  // vendored in web/engine-data and read at build time (static generation), so no
  // repo-root access or runtime secret is needed.
  output: "standalone",
  // Keep the dev overlay out of screenshots and off the sidebar footer.
  devIndicators: false,
};

export default nextConfig;
