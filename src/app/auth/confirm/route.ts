import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles Supabase email confirmation links (invites, password resets, magic links).
 * Supabase's default email templates link to /auth/confirm?token_hash=...&type=...
 * This route verifies the token and redirects to the appropriate page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "invite"
    | "recovery"
    | "signup"
    | "email"
    | "magiclink"
    | null;

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL("/login?error=Invalid+confirmation+link", req.url)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Link expired or invalid. Please request a new one.")}`,
        req.url
      )
    );
  }

  // Redirect based on confirmation type
  if (type === "invite") {
    return NextResponse.redirect(
      new URL("/auth/set-password?type=invite", req.url)
    );
  }

  if (type === "recovery") {
    return NextResponse.redirect(
      new URL("/auth/set-password?type=recovery", req.url)
    );
  }

  // Default: signup confirmation or magic link — go to home
  return NextResponse.redirect(new URL("/", req.url));
}
