"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createTemplate as createTemplateAction, deleteTemplate as deleteTemplateAction } from "@/app/actions/templates";
import { createRuns as createRunsAction, nextJobNumber } from "@/app/actions/runs";
import type { PlannedRun, RouteTemplate, CustomerKey, Weekdays } from "@/types/runs";
import { rowToTemplate } from "@/types/runs";
import { fetchCustomerNames } from "@/lib/customers";

const DEFAULT_WEEKDAYS: Weekdays = { mon: true, tue: true, wed: true, thu: true, fri: true };

function uid(prefix = "") {
  return `${prefix}${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayKey(iso: string): keyof Weekdays | null {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  if (day === 1) return "mon";
  if (day === 2) return "tue";
  if (day === 3) return "wed";
  if (day === 4) return "thu";
  if (day === 5) return "fri";
  return null;
}

function normalizePostcode(input: string) {
  const s = (input || "").trim().toUpperCase();
  const noSpace = s.replace(/\s+/g, "");
  if (noSpace.length >= 5) {
    const head = noSpace.slice(0, -3);
    const tail = noSpace.slice(-3);
    return `${head} ${tail}`.trim();
  }
  return s;
}

function getWeekdays(t: RouteTemplate): Weekdays {
  return t.activeWeekdays ?? t.days ?? DEFAULT_WEEKDAYS;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [runsCount, setRunsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Create template form
  const [name, setName] = useState("North West Furniture Run");
  const [customer, setCustomer] = useState<CustomerKey>("Montpellier");
  const [fromPostcode, setFromPostcode] = useState("GL2 7ND");
  const [returnToBase, setReturnToBase] = useState(true);
  const [toPostcode, setToPostcode] = useState("");
  const [startTime, setStartTime] = useState("07:00");
  const [serviceMins, setServiceMins] = useState(25);
  const [includeBreaks, setIncludeBreaks] = useState(true);
  const [rawText, setRawText] = useState("");
  const [days, setDays] = useState<Weekdays>(DEFAULT_WEEKDAYS);

  // Repeat
  const [repeatFrom, setRepeatFrom] = useState(todayISO());
  const [weeks, setWeeks] = useState(4);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("templates").select("*").order("created_at", { ascending: false }),
      supabase.from("runs").select("id", { count: "exact", head: true }),
    ]).then(([tRes, rRes]) => {
      setTemplates((tRes.data ?? []).map(rowToTemplate));
      setRunsCount(rRes.count ?? 0);
      setLoading(false);
    });
    fetchCustomerNames().then(setCustomerNames);
  }, []);

  function flash(text: string) {
    setMsg(text);
    window.setTimeout(() => setMsg(""), 1200);
  }

  async function handleCreateTemplate() {
    if (!name.trim()) return flash("Name required");
    if (!fromPostcode.trim()) return flash("From postcode required");

    const tpl: RouteTemplate = {
      id: uid("tpl_"),
      name: name.trim(),
      customer,
      fromPostcode: normalizePostcode(fromPostcode),
      toPostcode: normalizePostcode(toPostcode),
      returnToBase,
      startTime,
      serviceMins: Math.max(0, Number(serviceMins || 0)),
      includeBreaks: !!includeBreaks,
      rawText: rawText || "",
      activeWeekdays: days,
    };

    setTemplates((prev) => [tpl, ...prev]);
    const result = await createTemplateAction(tpl);
    if (result?.error) flash("Error: " + result.error);
    else flash("Template saved");
  }

  async function handleDeleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    const result = await deleteTemplateAction(id);
    if (result?.error) flash("Error: " + result.error);
    else flash("Deleted");
  }

  async function handleCreateRuns(tpl: RouteTemplate) {
    const wk = getWeekdays(tpl);
    const totalDays = Math.max(1, Number(weeks || 1)) * 7;

    const datesToCreate: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDaysISO(repeatFrom, i);
      const key = weekdayKey(date);
      if (!key) continue;
      if (!wk[key]) continue;
      datesToCreate.push(date);
    }

    if (datesToCreate.length === 0) return flash("No runs created (check weekdays / dates)");

    setBusy(true);

    // Get job numbers from server for each run
    const created: PlannedRun[] = [];
    for (const date of datesToCreate) {
      const { jobNumber } = await nextJobNumber(date);
      created.push({
        id: uid("run_"),
        jobNumber,
        loadRef: "",
        date,
        customer: tpl.customer,
        vehicle: "",
        fromPostcode: tpl.fromPostcode,
        toPostcode: tpl.toPostcode,
        returnToBase: tpl.returnToBase,
        startTime: tpl.startTime,
        serviceMins: tpl.serviceMins,
        includeBreaks: tpl.includeBreaks,
        rawText: tpl.rawText,
        runType: "regular",
        runOrder: null,
      });
    }

    const result = await createRunsAction(created);
    setBusy(false);

    if (result?.error) return flash("Error: " + result.error);
    setRunsCount((prev) => prev + created.length);
    flash(`Created ${created.length} runs`);
  }

  const summary = useMemo(() => ({ templates: templates.length, runs: runsCount }), [templates.length, runsCount]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <Link href="/runs" className="text-blue-400 underline">
              ← Back to runs
            </Link>
            <h1 className="text-3xl font-bold mt-4">Templates</h1>
            <div className="text-sm text-gray-400 mt-2">
              Save repeat routes (Mon–Fri) and generate runs for the next X weeks.
            </div>
          </div>

          <div className="flex items-center gap-3">
            {msg ? (
              <div className="text-sm px-3 py-2 rounded-lg border border-white/15 bg-white/5">
                {msg}
              </div>
            ) : null}
            <div className="text-sm text-gray-300">
              Templates: <span className="font-semibold">{summary.templates}</span> • Runs:{" "}
              <span className="font-semibold">{summary.runs}</span>
            </div>
          </div>
        </div>

        <div className="mt-8 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="text-lg font-semibold mb-4">Create template</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Template name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
                placeholder="e.g. North West Artic Run"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Customer</label>
              <select
                value={customer}
                onChange={(e) => setCustomer(e.target.value as CustomerKey)}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
              >
                {customerNames.map((c) => (
                  <option key={c} className="bg-black" value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Start depot (routing)</label>
              <input
                value={fromPostcode}
                onChange={(e) => setFromPostcode(e.target.value)}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
                placeholder="e.g. GL2 7ND"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">End location (routing)</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={returnToBase}
                    onChange={(e) => setReturnToBase(e.target.checked)}
                  />
                  Return to base
                </label>

                <input
                  value={toPostcode}
                  onChange={(e) => setToPostcode(e.target.value)}
                  disabled={returnToBase}
                  className="flex-1 border border-white/15 rounded-lg px-3 py-2 bg-transparent disabled:opacity-50"
                  placeholder="If not returning, end postcode (optional)"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Default service mins</label>
              <input
                type="number"
                min={0}
                value={serviceMins}
                onChange={(e) => setServiceMins(Number(e.target.value || 0))}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
              />
            </div>

            <div className="md:col-span-2 flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={includeBreaks}
                  onChange={(e) => setIncludeBreaks(e.target.checked)}
                />
                Count driving breaks (45m after 4.5h driving)
              </label>

              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-300">Active days:</span>
                {(["mon", "tue", "wed", "thu", "fri"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={days[k]}
                      onChange={(e) => setDays({ ...days, [k]: e.target.checked })}
                    />
                    {k.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-2">Stops (paste list)</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full h-40 border border-white/15 rounded-lg px-3 py-2 bg-transparent"
                placeholder={`Paste one per line (times allowed)\nLS9 0AB 14:00\nM1 1AA 09:00\n...`}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button onClick={handleCreateTemplate} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">
              Save template
            </button>
            <Link href="/plan-route" className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/10">
              Go to Plan Route
            </Link>
          </div>
        </div>

        <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="text-lg font-semibold mb-4">Repeat (Mon–Fri) for X weeks</div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Start date</label>
              <input
                type="date"
                value={repeatFrom}
                onChange={(e) => setRepeatFrom(e.target.value)}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
              />
              <div className="text-xs text-gray-500 mt-2">We generate weekdays only, starting from this date.</div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Weeks</label>
              <input
                type="number"
                min={1}
                value={weeks}
                onChange={(e) => setWeeks(Math.max(1, Number(e.target.value || 1)))}
                className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
              />
              <div className="text-xs text-gray-500 mt-2">Example: 4 weeks = generate Mon–Fri for the next month.</div>
            </div>

            <div className="flex items-end">
              <div className="text-sm text-gray-400">
                Pick a template below and hit <span className="text-white font-semibold">Create runs</span>.
                Runs will be unassigned.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="text-lg font-semibold mb-4">Saved templates</div>

          {loading ? (
            <div className="text-gray-400">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="text-gray-400">No templates yet. Create one above.</div>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => {
                const wk = getWeekdays(t);
                return (
                  <div
                    key={t.id}
                    className="border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-4 flex-wrap"
                  >
                    <div className="min-w-[260px]">
                      <div className="text-lg font-semibold">{t.name}</div>
                      <div className="text-sm text-gray-400 mt-1">
                        {t.customer} • From {t.fromPostcode} •{" "}
                        {t.returnToBase ? "Return to base" : `To ${t.toPostcode || "(last stop)"}`} •{" "}
                        {t.startTime} • Service {t.serviceMins}m • Breaks {t.includeBreaks ? "On" : "Off"}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Active:{" "}
                        {(["mon", "tue", "wed", "thu", "fri"] as const)
                          .filter((k) => wk[k])
                          .map((k) => k.toUpperCase())
                          .join(", ") || "None"}
                      </div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleCreateRuns(t)}
                        disabled={busy}
                        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-50"
                      >
                        {busy ? "Creating..." : "Create runs"}
                      </button>

                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                      >
                        Delete
                      </button>

                      <Link href="/runs" className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm">
                        View runs
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500">
            Next upgrade: preview before creating + duplicate prevention + vehicle pick per day.
          </div>
        </div>
      </div>
    </div>
  );
}
