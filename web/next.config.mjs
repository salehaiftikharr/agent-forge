/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained production server for the container image. Marketing/demo eval
  // data is vendored in web/engine-data and read at build time; the functional
  // API routes read the shared SQLite database at runtime (see docs/functional).
  output: "standalone",
  // better-sqlite3 is a native module and must not be bundled by the compiler;
  // it is loaded from node_modules at runtime in the Node server.
  serverExternalPackages: ["better-sqlite3"],
  // Keep the dev overlay out of screenshots and off the sidebar footer.
  devIndicators: false,
};

export default nextConfig;
