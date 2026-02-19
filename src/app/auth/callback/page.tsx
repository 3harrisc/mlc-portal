"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * /auth/callback
 *
 * Handles two Supabase auth flows:
 * 1. PKCE flow: ?code=... in query params (password reset)
 * 2. Implicit flow: #access_token=...&type=invite in hash (invite links)
 *
 * After establishing the session, redirects to:
 * - /auth/set-password?type=invite  for new invites
 * - /auth/set-password?type=recovery  for password resets
 * - /  for everything else
 */
export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    async function handleCallback() {
      const supabase = createClient();

      // 1. Check for PKCE code in query params (?code=...)
      const code = searchParams.get("code");
      const queryType = searchParams.get("type");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError("Invalid or expired link. Please request a new one.");
          return;
        }
        router.push(`/auth/set-password?type=${queryType ?? "recovery"}`);
        return;
      }

      // 2. Check for hash fragment (#access_token=...&type=invite)
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            setError("Invalid or expired invite link. Please ask your admin to resend.");
            return;
          }

          if (type === "invite") {
            router.push("/auth/set-password?type=invite");
          } else if (type === "recovery") {
            router.push("/auth/set-password?type=recovery");
          } else {
            router.push("/");
          }
          return;
        }
      }

      // 3. No code or hash — check if already authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/");
        return;
      }

      // Nothing worked
      setError("Invalid or expired link. Please request a new one.");
    }

    handleCallback();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
          <a href="/login" className="text-blue-400 underline text-sm">
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-gray-400">Setting up your account...</p>
    </div>
  );
}
