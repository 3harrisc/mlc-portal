"use client";

import { Suspense, useState, useEffect } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);

  // Pick up error from redirect (e.g. expired callback link)
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(urlError);
  }, [searchParams]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Auto sign-in after signup
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError("Account created! " + loginError.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/auth/callback` }
    );

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setResetSent(true);
    setLoading(false);
  }

  const subtitle =
    mode === "forgot"
      ? "Enter your email to receive a reset link"
      : "Sign in to continue";

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Image
            src="/mlc-logo.jpg"
            alt="MLC Transport Limited"
            width={200}
            height={80}
            className="rounded-lg"
            priority
          />
        </div>
        <p className="text-gray-400 text-center text-sm mb-8">{subtitle}</p>

        {mode === "forgot" && resetSent ? (
          <div className="text-center space-y-4">
            <div className="text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-4 py-3">
              Check your email for a password reset link.
            </div>
            <button
              onClick={() => { setMode("login"); setResetSent(false); setError(""); }}
              className="text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <form
              onSubmit={
                mode === "login"
                  ? handleLogin
                  : mode === "signup"
                    ? handleSignup
                    : handleForgotPassword
              }
              className="space-y-4"
            >
              <div>
                <label htmlFor="email" className="block text-sm text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              {mode !== "forgot" && (
                <div>
                  <label htmlFor="password" className="block text-sm text-gray-300 mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>
              )}

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); }}
                  className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Forgot password?
                </button>
              )}

              {error && (
                <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {loading
                  ? mode === "login"
                    ? "Signing in..."
                    : mode === "signup"
                      ? "Creating account..."
                      : "Sending..."
                  : mode === "login"
                    ? "Sign in"
                    : mode === "signup"
                      ? "Create account"
                      : "Send reset link"}
              </button>
            </form>

            {mode === "forgot" ? (
              <button
                onClick={() => { setMode("login"); setResetSent(false); setError(""); }}
                className="w-full mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Back to sign in
              </button>
            ) : (
              <button
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
                className="w-full mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                {mode === "login" ? "First time? Create an account" : "Already have an account? Sign in"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
