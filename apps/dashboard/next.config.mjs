/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // sharp is a native addon (used transitively via @college-events/render,
  // pulled in through the worker package's barrel export) — it must be
  // required at runtime, not bundled by webpack. serverExternalPackages
  // alone doesn't reliably catch it in this pnpm workspace layout (webpack
  // still tries to statically resolve sharp's internal conditional
  // platform-detection requires, which fail since only the linux-x64
  // binary is installed) — the explicit webpack externals below is the
  // belt-and-suspenders fix that actually keeps it a real runtime require.
  serverExternalPackages: ["sharp"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "sharp"];
    }
    return config;
  },
};

export default nextConfig;
