"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/portal/ToastContext";
import { usePortalData } from "@/components/portal/PortalDataContext";
import Icon from "@/components/portal/Icon";
import { todayISO } from "@/lib/time-utils";
import {
  createPortalBooking,
  type PortalBookingInput,
} from "@/app/actions/portal-bookings";

const SERVICES = ["Curtainsider", "Refrigerated", "Box", "Flatbed"] as const;

type FormState = PortalBookingInput;

function defaultForm(customer: string): FormState {
  const today = todayISO();
  return {
    customer,
    service: "Curtainsider",
    customerRef: "",
    pickupPostcode: "",
    pickupSiteName: "",
    pickupDate: today,
    pickupTime: "08:00",
    deliveryPostcode: "",
    deliverySiteName: "",
    deliveryDate: today,
    deliveryTime: "16:00",
    pallets: 12,
    weightTonnes: 14,
    notes: "",
  };
}

export default function BookingsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { runs } = usePortalData();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  // Customer dropdown options come from profile.allowed_customers (customer
  // role) or the union of customers seen in runs (admin).
  const customerOptions = useMemo(() => {
    if (profile?.role === "customer") return profile.allowed_customers ?? [];
    const set = new Set<string>();
    runs.forEach((r) => set.add(r.customer));
    return Array.from(set).filter(Boolean).sort();
  }, [profile, runs]);

  const [form, setForm] = useState<FormState>(() =>
    defaultForm(profile?.allowed_customers?.[0] ?? customerOptions[0] ?? ""),
  );

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  const submit = () => {
    if (!form.customer.trim()) {
      showToast("Pick a customer to book against.", "err");
      return;
    }
    if (!form.pickupPostcode.trim() || !form.deliveryPostcode.trim()) {
      showToast("Pickup and delivery postcodes are required.", "err");
      return;
    }
    startTransition(async () => {
      const result = await createPortalBooking({
        ...form,
        pallets: Number(form.pallets) || 0,
        weightTonnes: Number(form.weightTonnes) || 0,
      });
      if (result.error) {
        showToast(`Booking failed: ${result.error}`, "err");
        return;
      }
      showToast(
        `Booking submitted for ${form.customer} — we'll confirm shortly.`,
      );
      router.push("/portal/loads");
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Book a collection</h1>
          <div className="page-subtitle">
            New consignment for MLC Transport · we&apos;ll confirm by email
            within the hour
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header">
            <h3>Job details</h3>
          </div>
          <div
            className="card-body"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Customer / account</label>
              <select
                className="select"
                value={form.customer}
                onChange={(e) => update("customer", e.target.value)}
              >
                {customerOptions.length === 0 && (
                  <option value="">No customers available</option>
                )}
                {customerOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Your reference</label>
              <input
                className="input"
                placeholder="PO / SO number (optional)"
                value={form.customerRef}
                onChange={(e) => update("customerRef", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Service</label>
              <select
                className="select"
                value={form.service}
                onChange={(e) => update("service", e.target.value)}
              >
                {SERVICES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>

            <SectionDivider iconColor="var(--mlc-blue)" label="Collection" />
            <div className="field">
              <label>Postcode</label>
              <input
                className="input mono"
                value={form.pickupPostcode}
                onChange={(e) =>
                  update("pickupPostcode", e.target.value.toUpperCase())
                }
                placeholder="GL51 9TR"
              />
            </div>
            <div className="field">
              <label>Site name</label>
              <input
                className="input"
                value={form.pickupSiteName}
                onChange={(e) => update("pickupSiteName", e.target.value)}
                placeholder="e.g. Cheltenham DC"
              />
            </div>
            <div className="field">
              <label>Date</label>
              <input
                className="input mono"
                type="date"
                value={form.pickupDate}
                onChange={(e) => update("pickupDate", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Time window</label>
              <input
                className="input mono"
                type="time"
                value={form.pickupTime}
                onChange={(e) => update("pickupTime", e.target.value)}
              />
            </div>

            <SectionDivider iconColor="var(--mlc-red)" label="Delivery" />
            <div className="field">
              <label>Postcode</label>
              <input
                className="input mono"
                value={form.deliveryPostcode}
                onChange={(e) =>
                  update("deliveryPostcode", e.target.value.toUpperCase())
                }
                placeholder="M17 1AB"
              />
            </div>
            <div className="field">
              <label>Site name</label>
              <input
                className="input"
                value={form.deliverySiteName}
                onChange={(e) => update("deliverySiteName", e.target.value)}
                placeholder="e.g. Trafford Park"
              />
            </div>
            <div className="field">
              <label>Date</label>
              <input
                className="input mono"
                type="date"
                value={form.deliveryDate}
                onChange={(e) => update("deliveryDate", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Time window</label>
              <input
                className="input mono"
                type="time"
                value={form.deliveryTime}
                onChange={(e) => update("deliveryTime", e.target.value)}
              />
            </div>

            <GoodsDivider />
            <div className="field">
              <label>Pallets</label>
              <input
                className="input tnum"
                type="number"
                min={0}
                value={form.pallets}
                onChange={(e) => update("pallets", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Weight (tonnes)</label>
              <input
                className="input tnum"
                type="number"
                step={0.1}
                min={0}
                value={form.weightTonnes}
                onChange={(e) =>
                  update("weightTonnes", Number(e.target.value))
                }
              />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Notes for the driver</label>
              <textarea
                className="textarea"
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Access instructions, ref numbers, special handling…"
              />
            </div>
          </div>
          <div
            style={{
              padding: "14px 14px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button className="btn" type="button" disabled={isPending}>
              Save as draft
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={submit}
              disabled={isPending}
            >
              {isPending ? "Submitting…" : "Submit booking"}{" "}
              <Icon name="arrowR" size={12} />
            </button>
          </div>
        </div>

        <div className="col gap-16">
          <div className="card">
            <div className="card-header">
              <h3>Booking summary</h3>
            </div>
            <div className="card-body">
              <dl className="kv-grid">
                <dt>Customer</dt>
                <dd>{form.customer || "—"}</dd>
                <dt>Service</dt>
                <dd>{form.service}</dd>
                <dt>Pallets</dt>
                <dd className="tnum">{form.pallets}</dd>
                <dt>Weight</dt>
                <dd className="tnum">
                  {Number(form.weightTonnes || 0).toFixed(1)} t
                </dd>
                <dt>Pickup</dt>
                <dd className="mono">
                  {form.pickupPostcode || "—"} · {form.pickupTime}
                </dd>
                <dt>Delivery</dt>
                <dd className="mono">
                  {form.deliveryPostcode || "—"} · {form.deliveryTime}
                </dd>
              </dl>
              <div className="divider" />
              <div className="muted" style={{ fontSize: 11 }}>
                A confirmation email will be sent once dispatch reviews this
                booking. You&apos;ll see it appear in <strong>Loads</strong> as
                soon as it&apos;s scheduled.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Need help?</h3>
            </div>
            <div className="card-body">
              <div className="row gap-12">
                <div
                  className="avatar"
                  style={{ width: 36, height: 36, fontSize: 12 }}
                >
                  CH
                </div>
                <div>
                  <div className="bold" style={{ fontSize: 12.5 }}>
                    Callum Harris
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Your account manager
                  </div>
                  <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
                    01452 739 001
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SectionDivider({
  iconColor,
  label,
}: {
  iconColor: string;
  label: string;
}) {
  return (
    <div
      style={{
        gridColumn: "span 2",
        marginTop: 6,
        paddingTop: 14,
        borderTop: "1px solid var(--line)",
      }}
    >
      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <span style={{ color: iconColor, display: "inline-flex" }}>
          <Icon name="pin" size={14} />
        </span>
        <span className="bold" style={{ fontSize: 13 }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function GoodsDivider() {
  return (
    <div
      style={{
        gridColumn: "span 2",
        marginTop: 6,
        paddingTop: 14,
        borderTop: "1px solid var(--line)",
      }}
    >
      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <Icon name="pkg" size={14} />
        <span className="bold" style={{ fontSize: 13 }}>
          Goods
        </span>
      </div>
    </div>
  );
}
