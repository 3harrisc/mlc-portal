"use client";

import type { DriverLogin } from "@/app/actions/hr-drivers";
import type { DriverInput } from "@/types/hr-drivers";

interface Props {
  value: Partial<DriverInput>;
  logins: DriverLogin[];
  onChange: (v: Partial<DriverInput>) => void;
}

type Field = { key: keyof DriverInput; label: string; type?: string; span?: boolean; placeholder?: string };

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "Personal",
    fields: [
      { key: "firstNames", label: "First names" },
      { key: "surname", label: "Surname" },
      { key: "dateOfBirth", label: "Date of birth", type: "date" },
      { key: "niNumber", label: "National Insurance number", placeholder: "AB123456C" },
      { key: "address", label: "Address", span: true },
      { key: "postcode", label: "Postcode" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "email", label: "Email", type: "email" },
      { key: "emergencyContactName", label: "Emergency contact name" },
      { key: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" },
    ],
  },
  {
    title: "Employment",
    fields: [
      { key: "startDate", label: "Start date", type: "date" },
      { key: "continuousEmploymentDate", label: "Continuous employment from (if earlier)", type: "date" },
      { key: "leaveDate", label: "Leave date", type: "date" },
    ],
  },
];

/** Controlled form for a driver record's editable fields. */
export default function DriverForm({ value, logins, onChange }: Props) {
  const set = (k: keyof DriverInput, v: string) => onChange({ ...value, [k]: v });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="nav-section-label" style={{ padding: 0, marginBottom: 6 }}>{s.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {s.fields.map((f) => (
              <div key={f.key} className="field" style={f.span ? { gridColumn: "1 / -1" } : undefined}>
                <label>{f.label}</label>
                <input
                  className="input"
                  type={f.type ?? "text"}
                  value={(value[f.key] as string | null) ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
            {s.title === "Employment" && (
              <>
                <div className="field">
                  <label>Status</label>
                  <select className="select" value={value.status ?? "starter"} onChange={(e) => set("status", e.target.value)}>
                    <option value="starter">New starter</option>
                    <option value="active">Active</option>
                    <option value="left">Left</option>
                  </select>
                </div>
                <div className="field">
                  <label>Portal login</label>
                  <select className="select" value={value.profileId ?? ""} onChange={(e) => set("profileId", e.target.value)}>
                    <option value="">Not linked yet</option>
                    {logins.map((l) => (
                      <option key={l.id} value={l.id}>{l.fullName ? `${l.fullName} (${l.email})` : l.email}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="field">
        <label>Notes</label>
        <textarea
          className="input"
          rows={3}
          value={value.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          style={{ height: "auto", padding: 8 }}
        />
      </div>
    </div>
  );
}
