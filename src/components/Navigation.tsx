"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/plan-route", label: "Plan Route", adminOnly: true },
  { href: "/runs", label: "Runs", adminOnly: false },
  { href: "/reports", label: "Reports", adminOnly: false },
];

export default function Navigation() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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
          {/* Left: logo + nav buttons (desktop) */}
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

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-2">
              {navItems.filter((item) => !item.adminOnly || profile?.role === "admin").map(({ href, label }) => (
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
                <>
                  <Link
                    href="/admin/drivers"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive("/admin/drivers")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                        : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                    }`}
                  >
                    Drivers
                  </Link>
                  <Link
                    href="/admin/costs"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive("/admin/costs")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                        : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                    }`}
                  >
                    Costs
                  </Link>
                  <Link
                    href="/admin/emails"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive("/admin/emails")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                        : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                    }`}
                  >
                    Emails
                  </Link>
                  <Link
                    href="/admin/users"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive("/admin/users")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                        : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                    }`}
                  >
                    Users
                  </Link>
                  <Link
                    href="/admin/customers"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive("/admin/customers")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                        : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                    }`}
                  >
                    Customers
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Right: user info (desktop) + hamburger (mobile) */}
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
                  className="hidden md:block px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-red-500/20 hover:text-red-300 border border-white/10 transition-all"
                >
                  Sign out
                </button>
              </>
            )}

            {/* Hamburger button (mobile) */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/10 bg-zinc-900 px-4 pb-4 pt-2 space-y-2">
          {navItems.filter((item) => !item.adminOnly || profile?.role === "admin").map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive(href)
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </Link>
          ))}

          {profile?.role === "admin" && (
            <>
              <Link
                href="/admin/drivers"
                onClick={() => setMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive("/admin/drivers")
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Drivers
              </Link>
              <Link
                href="/admin/costs"
                onClick={() => setMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive("/admin/costs")
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Costs
              </Link>
              <Link
                href="/admin/emails"
                onClick={() => setMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive("/admin/emails")
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Emails
              </Link>
              <Link
                href="/admin/users"
                onClick={() => setMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive("/admin/users")
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Users
              </Link>
              <Link
                href="/admin/customers"
                onClick={() => setMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive("/admin/customers")
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Customers
              </Link>
            </>
          )}

          {user && (
            <div className="pt-2 border-t border-white/10">
              <div className="px-4 py-1 text-xs text-gray-500">{user.email}</div>
              <button
                onClick={() => { setMenuOpen(false); handleLogout(); }}
                className="w-full text-left px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-all"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
