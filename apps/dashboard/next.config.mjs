/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // sharp is a native addon (used transitively via @college-events/render,
  // pulled in through the worker package's barrel export) — it must be
  // required at runtime, not bundled by webpack.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
