import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/auth/set-password";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("type", type ?? "recovery");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Failed — redirect to login with error
  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/login";
  errorUrl.search = "";
  errorUrl.searchParams.set("error", "Invalid or expired link. Please request a new one.");
  return NextResponse.redirect(errorUrl);
}
