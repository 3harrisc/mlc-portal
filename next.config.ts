import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * Inject build-time git metadata so the portal sidebar can show what's
 * actually deployed (commit sha, subject, timestamp). On Vercel the values
 * arrive via VERCEL_GIT_* env vars; locally we shell out to git so dev
 * builds carry the same info.
 *
 * All variables are NEXT_PUBLIC_* so they're available to client components
 * (the build status badge in Sidebar.tsx).
 */
function gitMeta(): Record<string, string> {
  const fromVercel = {
    sha: process.env.VERCEL_GIT_COMMIT_SHA,
    subject: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
  };
  if (fromVercel.sha) {
    return {
      NEXT_PUBLIC_BUILD_SHA: fromVercel.sha,
      NEXT_PUBLIC_BUILD_SUBJECT: (fromVercel.subject ?? "").split("\n")[0],
      NEXT_PUBLIC_BUILD_BRANCH: fromVercel.branch ?? "",
      NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    };
  }

  // Local dev / non-Vercel build — best effort only. If git isn't on PATH
  // (CI without history, Docker layer without .git) we silently fall back
  // to empty strings; the badge degrades to "v4.2" alone.
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const subject = execSync("git log -1 --pretty=%s", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const time = execSync("git log -1 --pretty=%cI", { encoding: "utf8" }).trim();
    return {
      NEXT_PUBLIC_BUILD_SHA: sha,
      NEXT_PUBLIC_BUILD_SUBJECT: subject,
      NEXT_PUBLIC_BUILD_BRANCH: branch,
      NEXT_PUBLIC_BUILD_TIME: time,
    };
  } catch {
    return {
      NEXT_PUBLIC_BUILD_SHA: "",
      NEXT_PUBLIC_BUILD_SUBJECT: "",
      NEXT_PUBLIC_BUILD_BRANCH: "",
      NEXT_PUBLIC_BUILD_TIME: "",
    };
  }
}

const nextConfig: NextConfig = {
  env: gitMeta(),
};

export default nextConfig;
