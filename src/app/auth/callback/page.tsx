"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * /auth/callback
 *
 * Handles Supabase auth flows from email links (invite, recovery):
 *  - PKCE flow: ?code=... in query params
 *  - Implicit flow: #access_token=...&type=invite in hash
 *
 * The Supabase browser client (singleton from AuthProvider) may auto-process
 * these tokens before this page mounts. We handle that race condition by:
 *  1. Reading hash from sessionStorage (captured by inline script in layout)
 *  2. Checking for an existing session first (from auto-processing)
 *  3. Falling back to manual code/hash processing
 *  4. Using onAuthStateChange as a final backup
 */
export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}

function CallbackHandler() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      const supabase = createClient();

      // ── Capture the auth "type" from all available sources ──
      // The inline script in layout.tsx saves hash params to sessionStorage
      // before the Supabase client can clear them.
      const savedHash = sessionStorage.getItem("__supabase_auth_hash");
      if (savedHash) sessionStorage.removeItem("__supabase_auth_hash");

      const hashStr =
        savedHash ||
        (window.location.hash ? window.location.hash.substring(1) : "");
      const hashParams = hashStr ? new URLSearchParams(hashStr) : null;

      const type = hashParams?.get("type") || searchParams.get("type");
      const code = searchParams.get("code");
      const accessToken = hashParams?.get("access_token");
      const refreshToken = hashParams?.get("refresh_token");

      // ── 1. Session may already exist (Supabase auto-processed) ──
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing) {
        if (!cancelled) redirect(type);
        return;
      }

      // ── 2. PKCE code exchange ──
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (!codeErr) {
          if (!cancelled) redirect(type);
          return;
        }
        // Code might have been consumed by auto-processing that hasn't
        // synced to getSession yet — fall through to wait below.
      }

      // ── 3. Implicit flow (hash fragment tokens) ──
      if (accessToken && refreshToken) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!sessErr) {
          if (!cancelled) redirect(type);
          return;
        }
      }

      // ── 4. Wait for Supabase auto-processing to finish ──
      // The singleton client's _initialize() may still be exchanging the
      // code in the background. Listen for auth state changes.
      const gotSession = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          sub.unsubscribe();
          resolve(false);
        }, 5000);

        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (session) {
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(true);
            }
          }
        );

        // Also poll once more after a short delay
        setTimeout(async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve(true);
          }
        }, 1000);
      });

      if (gotSession) {
        if (!cancelled) redirect(type);
        return;
      }

      // ── 5. Nothing worked ──
      if (!cancelled) {
        setError("Invalid or expired link. Please request a new one.");
      }
    }

    function redirect(type: string | null | undefined) {
      if (type === "invite") {
        window.location.href = "/auth/set-password?type=invite";
      } else if (type === "recovery") {
        window.location.href = "/auth/set-password?type=recovery";
      } else {
        window.location.href = "/";
      }
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

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
