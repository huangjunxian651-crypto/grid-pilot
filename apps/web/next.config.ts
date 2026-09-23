import type { NextConfig } from "next";
import path from "path";
import * as fs from "fs";
import os from "os";
import { config as dotenvConfig } from "dotenv";

function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      dotenvConfig({ path: envPath });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Root .env file not found. " +
    "Please create it from .env.example: cp .env.example .env"
  );
}

loadRootEnv();

/** Collect all non-internal IPv4 addresses from local network interfaces. */
function getLocalIPs(): string[] {
  const ips: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// Build allowedDevOrigins from:
// 1. WEB_URL hostname
// 2. All local network IPs (auto-detected)
// 3. DEV_EXTRA_ORIGINS env (comma-separated)
function getAllowedDevOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.WEB_URL) {
    try {
      origins.push(new URL(process.env.WEB_URL).hostname);
    } catch {
      // ignore invalid URL
    }
  }

  // Auto-detect all local IPs so HMR works from any network interface
  origins.push(...getLocalIPs());

  if (process.env.DEV_EXTRA_ORIGINS) {
    origins.push(...process.env.DEV_EXTRA_ORIGINS.split(",").map((s) => s.trim()));
  }

  return origins;
}

const apiUrl = process.env.API_URL ?? "http://localhost:3301";

const nextConfig: NextConfig = {
  output: "standalone",
  // Middleware runs in Next's edge bundle and otherwise may inline the fallback
  // localhost URL instead of the Docker-internal API target at build time.
  env: {
    API_URL: apiUrl,
  },
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  turbopack: {
    // pnpm 虚拟包存储在 monorepo 根的 node_modules/.pnpm，需要将 root 指向此处
    // 否则 Turbopack 推断 apps/web 为根，会拒绝解析根目录外的符号链接
    root: path.resolve(__dirname, "../.."),
  },
  allowedDevOrigins: getAllowedDevOrigins(),
  async redirects() {
    return [
      { source: "/bots", destination: "/robots", permanent: false },
      { source: "/bots/new", destination: "/robots/new", permanent: false },
      { source: "/bots/:id", destination: "/robots", permanent: false },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
