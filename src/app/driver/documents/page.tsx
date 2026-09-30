"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getSignedCopyUrl, listMyDocuments } from "@/app/actions/hr";
import { needsSignature } from "@/lib/hr/status";
import { categoryLabel, type DriverDocumentView, type SignStatus } from "@/types/hr";

const BADGE: Record<SignStatus, { label: string; cls: string }> = {
  expired: { label: "Re-sign needed", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  outstanding: { label: "To sign", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  due_soon: { label: "Re-sign soon", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  signed: { label: "Signed", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
};

function ukDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DriverDocumentsPage() {
  const { profile, loading: authLoading } = useAuth();
  const [views, setViews] = useState<DriverDocumentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== "driver") return;
    listMyDocuments().then((res) => {
      if (res.error) setError(res.error);
      else setViews(res.views ?? []);
    });
  }, [profile]);

  const downloadCopy = async (signatureId: string) => {
    const tab = window.open("", "_blank");
    const res = await getSignedCopyUrl(signatureId);
    if (res.url && tab) tab.location.href = res.url;
    else {
      tab?.close();
      setError(res.error ?? "Couldn't download your copy");
    }
  };

  if (!authLoading && profile?.role !== "driver") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="text-gray-400">This page is for drivers only.</div>
      </div>
    );
  }

  const toSign = (views ?? []).filter((v) => needsSignature(v.status));
  const done = (views ?? []).filter((v) => !needsSignature(v.status));

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <Link href="/driver" className="text-gray-400 hover:text-white text-sm">
          ‹ Back
        </Link>
        <div className="font-semibold">My documents</div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {!views && !error && <div className="text-gray-400">Loading…</div>}

        {views && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 mb-3">To sign ({toSign.length})</h2>
            {toSign.length === 0 ? (
              <div className="rounded-xl border border-white/10 p-4 text-gray-400 text-sm">
                You&apos;re all up to date. Nothing to sign.
              </div>
            ) : (
              <div className="space-y-2">
                {toSign.map((v) => (
                  <Link
                    key={v.document.id}
                    href={`/driver/documents/${v.document.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold">{v.document.title}</div>
                      <div className="text-xs text-gray-400">
                        {categoryLabel(v.document.category)}
                        {v.expiresAt && v.status === "due_soon" && ` · due ${ukDate(v.expiresAt)}`}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${BADGE[v.status].cls}`}>
                      {BADGE[v.status].label}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Signed ({done.length})</h2>
            <div className="space-y-2">
              {done.map((v) => (
                <div key={v.document.id} className="rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{v.document.title}</div>
                      <div className="text-xs text-gray-400">
                        Signed {v.lastSignature && ukDate(v.lastSignature.signedAt)}
                        {v.expiresAt && ` · re-sign by ${ukDate(v.expiresAt)}`}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${BADGE.signed.cls}`}>
                      ✓ Signed
                    </span>
                  </div>
                  {v.lastSignature && (
                    <button
                      type="button"
                      onClick={() => downloadCopy(v.lastSignature!.id)}
                      className="mt-3 text-sm text-blue-300 hover:text-blue-200"
                    >
                      Download my signed copy
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
