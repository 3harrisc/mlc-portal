"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";

export default function Home() {
  const { profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && profile?.role === "driver") {
      router.replace("/driver");
    }
  }, [loading, profile, router]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />

      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
        <div className="max-w-4xl mx-auto px-8 text-center">
          <div className="flex justify-center mb-6">
            <Image
              src="/mlc-logo.jpg"
              alt="MLC Transport Limited"
              width={300}
              height={120}
              className="rounded-xl"
              priority
            />
          </div>

          <p className="text-xl text-gray-300 mb-12">
            HGV Route Planning & Real-Time Tracking System
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
            <Link
              href="/plan-route"
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-8 hover:bg-white/10 transition-all"
            >
              <div className="text-4xl mb-4">📍</div>
              <h2 className="text-2xl font-semibold mb-3">Plan Route</h2>
              <p className="text-gray-400">
                Create delivery routes, manage stops, and schedule runs with HGV-specific calculations
              </p>
              <div className="mt-6 text-blue-400 group-hover:text-blue-300 font-medium">
                Get started →
              </div>
            </Link>

            <Link
              href="/runs"
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-8 hover:bg-white/10 transition-all"
            >
              <div className="text-4xl mb-4">🚛</div>
              <h2 className="text-2xl font-semibold mb-3">View Runs</h2>
              <p className="text-gray-400">
                Track planned runs, assign vehicles, and monitor live progress with Webfleet integration
              </p>
              <div className="mt-6 text-emerald-400 group-hover:text-emerald-300 font-medium">
                View runs →
              </div>
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-500">
            <div className="border border-white/5 rounded-xl p-4 bg-white/5">
              <div className="font-semibold text-white mb-2">✓ Webfleet Integration</div>
              Real-time vehicle tracking with live ETA calculations
            </div>
            <div className="border border-white/5 rounded-xl p-4 bg-white/5">
              <div className="font-semibold text-white mb-2">✓ HGV Compliance</div>
              Automatic breaks after 4.5 hours driving (WTD)
            </div>
            <div className="border border-white/5 rounded-xl p-4 bg-white/5">
              <div className="font-semibold text-white mb-2">✓ Smart Routing</div>
              Mapbox directions with HGV time adjustments
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
