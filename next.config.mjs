/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the sim singleton must not double-init in dev
  experimental: {
    instrumentationHook: true,
    // better-sqlite3 is a native module — keep it external to the server bundle.
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
