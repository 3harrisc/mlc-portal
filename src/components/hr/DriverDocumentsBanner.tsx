"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listMyDocuments } from "@/app/actions/hr";
import { needsSignature } from "@/lib/hr/status";

/** Driver-mode prompt shown when documents are waiting to be signed. */
export default function DriverDocumentsBanner() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listMyDocuments().then((res) => {
      if (!cancelled && res.views) {
        setCount(res.views.filter((v) => needsSignature(v.status)).length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/driver/documents"
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
        count > 0
          ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
          : "border-white/10 bg-white/5 text-gray-300"
      }`}
    >
      <div>
        <div className="font-semibold">
          {count > 0
            ? `${count} document${count === 1 ? "" : "s"} to sign`
            : "My documents"}
        </div>
        <div className="text-xs opacity-70">
          {count > 0 ? "Tap to read and sign" : "Contracts and health & safety"}
        </div>
      </div>
      <span aria-hidden className="text-xl">›</span>
    </Link>
  );
}
