"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad, { type SignaturePadHandle } from "@/components/hr/SignaturePad";
import { getDocumentUrl, getSignedCopyUrl, listMyDocuments, signDocument } from "@/app/actions/hr";
import { getMyDriverDetails } from "@/app/actions/hr-drivers";
import { needsSignature } from "@/lib/hr/status";
import { ukDate } from "@/lib/hr/format";
import { AGREEMENT_TEXT, categoryLabel, type DriverDocumentView } from "@/types/hr";

export default function SignDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const padRef = useRef<SignaturePadHandle>(null);

  const [view, setView] = useState<DriverDocumentView | null | undefined>(undefined);
  const [opened, setOpened] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedId, setSignedId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== "driver") return;
    listMyDocuments().then((res) => {
      if (res.error) setError(res.error);
      const found = res.views?.find((v) => v.document.id === id) ?? null;
      setView(found);
      // Particulars documents: pre-fill from the driver's HR record (the driver
      // confirms or corrects), falling back to the account name.
      if (found?.document.collectsParticulars) {
        getMyDriverDetails().then((me) => {
          setName((n) => n || me.legalName || profile.full_name || "");
          setAddress((a) => a || me.address || "");
        });
      }
    });
  }, [profile, id]);

  const openInTab = async (fetchUrl: () => Promise<{ url?: string; error?: string }>) => {
    setError(null);
    // Open synchronously so mobile pop-up blockers allow it.
    const tab = window.open("", "_blank");
    const res = await fetchUrl();
    if (res.url && tab) {
      tab.location.href = res.url;
      return true;
    }
    tab?.close();
    setError(res.error ?? "Couldn't open the document");
    return false;
  };

  const submit = async () => {
    setError(null);
    const dataUrl = padRef.current?.toDataUrl();
    if (!dataUrl) return setError("Please draw your signature in the box.");
    setBusy(true);
    const res = await signDocument({
      documentId: id,
      signedName: name,
      agreed,
      signatureDataUrl: dataUrl,
      legalName: name,
      address,
    });
    setBusy(false);
    if (res.error) setError(res.error);
    else setSignedId(res.signatureId ?? null);
  };

  const header = (
    <div className="flex items-center gap-3 p-4 border-b border-white/10">
      <Link href="/driver/documents" className="text-gray-400 hover:text-white text-sm">
        ‹ My documents
      </Link>
    </div>
  );

  if (view === undefined && !error) {
    return (
      <div className="min-h-screen bg-black text-white">
        {header}
        <div className="p-6 text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="min-h-screen bg-black text-white">
        {header}
        <div className="p-6 text-gray-400">{error ?? "This document isn't available to you."}</div>
      </div>
    );
  }

  if (signedId) {
    return (
      <div className="min-h-screen bg-black text-white">
        {header}
        <div className="max-w-lg mx-auto p-6 text-center space-y-4">
          <div className="text-5xl">✓</div>
          <div className="text-xl font-semibold">Signed — thank you</div>
          <div className="text-gray-400 text-sm">
            A signed copy of &ldquo;{view.document.title}&rdquo; has been saved for you and the office.
          </div>
          <button
            type="button"
            onClick={() => openInTab(() => getSignedCopyUrl(signedId))}
            className="w-full rounded-xl border border-white/20 py-3 font-semibold"
          >
            Download my copy
          </button>
          <Link href="/driver/documents" className="block w-full rounded-xl bg-emerald-600 py-3 font-semibold">
            Back to my documents
          </Link>
        </div>
      </div>
    );
  }

  const canSign = needsSignature(view.status);
  const needsDetails = view.document.collectsParticulars;
  const ready =
    opened && agreed && name.trim().length >= 2 && hasInk && !busy &&
    (!needsDetails || (address.trim().length >= 8 && !!view.assignment?.startDate));

  return (
    <div className="min-h-screen bg-black text-white">
      {header}
      <div className="max-w-lg mx-auto p-4 space-y-4 pb-10">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">
            {categoryLabel(view.document.category)}
          </div>
          <h1 className="text-2xl font-bold mt-1">{view.document.title}</h1>
          {view.document.description && (
            <p className="text-gray-300 text-sm mt-2">{view.document.description}</p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Step 1 — Read the document</div>
          <div className="text-xs text-gray-400 mt-1">It opens in a new tab. Come back here when you&apos;ve read it.</div>
          <button
            type="button"
            onClick={async () => {
              if (await openInTab(() => getDocumentUrl(view.document.id))) setOpened(true);
            }}
            className="mt-3 w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-semibold"
          >
            {opened ? "Open document again" : "Open document"}
          </button>
        </div>

        {!canSign ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            You&apos;ve already signed this document.
          </div>
        ) : (
          <div className={`rounded-xl border border-white/10 bg-white/5 p-4 space-y-4 ${opened ? "" : "opacity-50"}`}>
            <div className="text-sm font-semibold">Step 2 — Sign</div>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                disabled={!opened}
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{AGREEMENT_TEXT}</span>
            </label>

            {needsDetails && (
              <div className="rounded-xl border border-white/10 p-3 space-y-1 text-sm">
                <div className="text-xs text-gray-400">Set by MLC</div>
                <div>
                  Start date:{" "}
                  <b>{view.assignment?.startDate ? ukDate(view.assignment.startDate) : "not set yet"}</b>
                </div>
                {view.assignment?.continuousDate &&
                  view.assignment.continuousDate !== view.assignment.startDate && (
                    <div>
                      Continuous employment from: <b>{ukDate(view.assignment.continuousDate)}</b>
                    </div>
                  )}
                <div className="text-xs text-gray-500">If this is wrong, contact the office before signing.</div>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-400" htmlFor="signed-name">
                {needsDetails ? "Your full legal name (as on your passport or driving licence)" : "Type your full name"}
              </label>
              <input
                id="signed-name"
                className="mt-1 w-full rounded-xl border border-white/20 bg-black px-3 py-3 text-base"
                value={name}
                disabled={!opened}
                maxLength={100}
                autoComplete="name"
                placeholder={profile?.full_name ?? "Full name"}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {needsDetails && (
              <div>
                <label className="text-xs text-gray-400" htmlFor="home-address">
                  Your home address, including postcode (correct it if it has changed)
                </label>
                <textarea
                  id="home-address"
                  className="mt-1 w-full rounded-xl border border-white/20 bg-black px-3 py-3 text-base"
                  rows={3}
                  value={address}
                  disabled={!opened}
                  maxLength={300}
                  autoComplete="street-address"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Draw your signature</span>
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-white"
                  onClick={() => padRef.current?.clear()}
                >
                  Clear
                </button>
              </div>
              <div className={`mt-1 ${opened ? "" : "pointer-events-none"}`}>
                <SignaturePad ref={padRef} onChange={setHasInk} />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={!ready}
              onClick={submit}
              className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold disabled:opacity-40"
            >
              {busy ? "Signing…" : "Sign document"}
            </button>
            {!opened && (
              <div className="text-xs text-gray-400 text-center">Open the document first to unlock signing.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
