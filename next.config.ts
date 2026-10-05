import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A disposable local verification server must not share the user's dev lock/cache.
  distDir: process.env.TRADE_OS_LOCAL_TEST_APP === "true" ? ".next-integration" : ".next",
};

export default nextConfig;
