"use client";

import { useEffect, useState, useTransition } from "react";
import {
  generatePortalShareToken,
  getPortalShareToken,
  revokePortalShareToken,
} from "@/app/actions/portal-share";
import Icon from "./Icon";
import { useToast } from "./ToastContext";

interface ShareLinkPanelProps {
  runId: string;
}

interface ShareInfo {
  token: string;
  createdAt: string;
  url: string;
}

export default function ShareLinkPanel({ runId }: ShareLinkPanelProps) {
  const { showToast } = useToast();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getPortalShareToken(runId);
      if (cancelled) return;
      setInfo(result.data ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const generate = () => {
    startTransition(async () => {
      const result = await generatePortalShareToken(runId);
      if (result.error) {
        showToast(`Couldn't create share link: ${result.error}`, "err");
        return;
      }
      if (result.data) {
        setInfo(result.data);
        showToast("Share link created. Copy it to send to your customer.");
      }
    });
  };

  const revoke = () => {
    if (!info) return;
    startTransition(async () => {
      const result = await revokePortalShareToken(runId);
      if (result.error) {
        showToast(`Couldn't revoke link: ${result.error}`, "err");
        return;
      }
      setInfo(null);
      showToast("Share link revoked. The public URL will now 404.");
    });
  };

  const copy = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      showToast("Link copied to clipboard.");
    } catch {
      showToast("Couldn't copy automatically — select and copy manually.", "err");
    }
  };

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        background: info ? "var(--mlc-blue-50)" : "var(--surface)",
        borderColor: info ? "var(--mlc-blue-50)" : undefined,
      }}
    >
      <div
        className="card-body"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
          flexWrap: "wrap",
        }}
      >
        <Icon
          name="map"
          size={16}
          style={{ color: info ? "var(--mlc-blue)" : "var(--ink-500)" }}
        />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="bold" style={{ fontSize: 12.5 }}>
            Customer share link
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {loading
              ? "Checking…"
              : info
                ? "Anyone with this link can view live status — no login required."
                : "Generate a public link for customers without portal access."}
          </div>
        </div>
        {info && (
          <input
            readOnly
            value={info.url}
            onClick={(e) => e.currentTarget.select()}
            className="input mono"
            style={{ flex: "2 1 280px", height: 28, fontSize: 11 }}
            aria-label="Public share URL"
          />
        )}
        {info ? (
          <div className="row gap-4">
            <button
              type="button"
              className="btn sm"
              onClick={copy}
              disabled={isPending}
            >
              <Icon name="doc" size={11} /> Copy
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={revoke}
              disabled={isPending}
            >
              <Icon name="x" size={11} /> Revoke
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn sm primary"
            onClick={generate}
            disabled={isPending || loading}
          >
            <Icon name="plus" size={11} /> Generate link
          </button>
        )}
      </div>
    </div>
  );
}
