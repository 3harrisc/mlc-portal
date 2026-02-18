"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/plan-route", label: "Plan Route" },
  { href: "/runs", label: "Runs" },
];

export default function Navigation() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className="bg-zinc-900 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: logo + nav buttons */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Image
                src="/mlc-logo.jpg"
                alt="MLC Transport Limited"
                width={100}
                height={40}
                className="rounded"
                priority
              />
            </Link>

            <div className="flex items-center gap-2">
              {navItems.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive(href)
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                      : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                  }`}
                >
                  {label}
                </Link>
              ))}

              {profile?.role === "admin" && (
                <Link
                  href="/admin/users"
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive("/admin")
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                      : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                  }`}
                >
                  Admin
                </Link>
              )}
            </div>
          </div>

          {/* Right: user info + sign out */}
          <div className="flex items-center gap-3">
            {user && (
              <>
                <div className="hidden sm:flex items-center gap-2">
                  <span className="text-sm text-gray-400">{user.email}</span>
                  {profile?.role === "admin" && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                      Admin
                    </span>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-red-500/20 hover:text-red-300 border border-white/10 transition-all"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
