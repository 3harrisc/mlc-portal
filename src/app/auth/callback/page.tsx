"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

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

      // ── Determine auth type from hash + query params ──
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

      // ── 1. PKCE code exchange ──
      if (code) {
        const { error: codeErr } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!codeErr) {
          if (!cancelled) redirect(type);
          return;
        }
        // Code exchange failed — show error
        if (!cancelled)
          setError("Invalid or expired link. Please request a new invite.");
        return;
      }

      // ── 2. Implicit flow (hash fragment tokens) ──
      if (accessToken && refreshToken) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!sessErr) {
          if (!cancelled) redirect(type);
          return;
        }
        if (!cancelled)
          setError("Invalid or expired link. Please request a new invite.");
        return;
      }

      // ── 3. Hash with access_token but no refresh_token ──
      if (accessToken) {
        // Some Supabase flows only include access_token
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (!cancelled) redirect(type);
          return;
        }
      }

      // ── 4. Nothing to process ──
      if (!cancelled) {
        setError("Invalid or expired link. Please request a new invite.");
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
