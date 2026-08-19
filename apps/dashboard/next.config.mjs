/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // sharp is a native addon (used transitively via @college-events/render,
  // pulled in through the worker package's barrel export that apps/dashboard's
  // server actions import from — so it reaches nearly every route, not just
  // the render action). Three things are all actually needed together here,
  // confirmed by removing each in turn and watching a different failure mode
  // come back:
  //   - serverExternalPackages: without it, sharp isn't a real runtime
  //     require at all.
  //   - the webpack externals override: without it, the LOCAL build fails
  //     ("Could not load the sharp module using the linux-x64 runtime") —
  //     webpack still tries to statically resolve sharp's internal
  //     conditional platform-detection requires, which fail since only the
  //     linux-x64 binary is installed. serverExternalPackages alone doesn't
  //     stop that in this pnpm workspace layout.
  //   - outputFileTracingIncludes: without it, Vercel's DEPLOYED build fails
  //     ("Cannot find module 'sharp'") — the webpack externals override
  //     bypasses the tracing hook serverExternalPackages normally uses to
  //     get a package's actual files copied into the deployed output, so
  //     they have to be force-included explicitly instead.
  serverExternalPackages: ["sharp"],
  // Matched with picomatch({contains:true}) against each route (e.g. "/events",
  // "/posts/[id]") — "/**" matches every route including single-segment ones
  // and "/" itself; "/**/*" (tried first) only matched multi-segment routes
  // and silently included nothing for "/events", "/posts", etc. Verified
  // directly against next/dist/compiled/picomatch before relying on it here.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "sharp"];
    }
    return config;
  },
};

export default nextConfig;
