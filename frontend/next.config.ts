import type { NextConfig } from "next";

const isGithubPages = process.env.DEPLOY_TARGET === "github-pages";
const repoBasePath = "/ai_workflow";

const nextConfig: NextConfig = {
  typedRoutes: false,
  output: isGithubPages ? "export" : undefined,
  basePath: isGithubPages ? repoBasePath : undefined,
  assetPrefix: isGithubPages ? `${repoBasePath}/` : undefined,
  trailingSlash: isGithubPages,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
