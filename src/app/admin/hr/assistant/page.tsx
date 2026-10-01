"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import DraftPanel from "@/components/hr/assistant/DraftPanel";
import ReviewPanel from "@/components/hr/assistant/ReviewPanel";

export default function HrAssistantPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"draft" | "review">("draft");

  useEffect(() => {
    if (!loading && profile?.role !== "admin") router.push("/");
  }, [loading, profile, router]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">HR assistant</h1>
          <div className="page-subtitle">
            Drafts and reviews HR and safety documents for your approval. Nothing reaches drivers until you
            press Send on <Link href="/admin/hr" style={{ color: "var(--mlc-blue)" }}>HR documents</Link>.
          </div>
        </div>
        <div className="seg">
          <button type="button" className={tab === "draft" ? "active" : ""} onClick={() => setTab("draft")}>
            Draft
          </button>
          <button type="button" className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>
            Review
          </button>
        </div>
      </div>
      {/* Both stay mounted so switching tabs doesn't lose work in progress. */}
      <div style={{ display: tab === "draft" ? "block" : "none" }}><DraftPanel /></div>
      <div style={{ display: tab === "review" ? "block" : "none" }}><ReviewPanel /></div>
    </>
  );
}
