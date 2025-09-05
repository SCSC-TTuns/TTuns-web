import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  // Vercel 빌드에서만 ESLint 에러로 실패하지 않게
  eslint: {
    ignoreDuringBuilds: isVercel,
  },

  // 타입 에러는 기본적으로 막지 않음.
  // 정말 급하면 환경변수로만 임시 우회할 수 있게 처리
  typescript: {
    ignoreBuildErrors: process.env.IGNORE_TS_ERRORS === "1",
  },

  experimental: {
    typedRoutes: true,
  },

  // 필요시 활성화
  // reactStrictMode: true,
};

export default nextConfig;
