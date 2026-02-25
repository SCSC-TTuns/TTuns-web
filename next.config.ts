import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1";
const allowedDevOrigins = Array.from(
  new Set(
    ["*.trycloudflare.com", process.env.NEXT_PUBLIC_DEV_ORIGIN ?? process.env.MCP_PUBLIC_BASE_URL]
      .flatMap((value) => (value ?? "").split(","))
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  )
);

const nextConfig: NextConfig = {
  // Cloudflare Tunnel/외부 도메인으로 dev 접속 시 Next 내부 자산(_next/*) 허용
  allowedDevOrigins,

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
