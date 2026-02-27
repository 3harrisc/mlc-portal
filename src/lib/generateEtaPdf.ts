import { jsPDF } from "jspdf";
import type { PlannedRun } from "@/types/runs";
import type { EtaChainResult } from "@/lib/etaChain";

type PdfOptions = {
  run: PlannedRun;
  etaChain: EtaChainResult;
  stops: string[]; // normalized postcodes
  stopRefs: Map<number, string>;
  stopBookingTimes?: Map<number, string>;
  nicknames: Record<string, string>;
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatMins(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = Math.round(totalMins % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function nick(postcode: string, nicknames: Record<string, string>): string {
  const n = nicknames[postcode];
  return n ? `${postcode} (${n})` : postcode;
}

export function generateEtaPdf({ run, etaChain, stops, stopRefs, stopBookingTimes, nicknames }: PdfOptions) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("MLC TRANSPORT", margin, y);
  y += 7;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("ETA Schedule", margin, y);
  y += 3;

  // Divider
  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Run info ──
  doc.setFontSize(10);
  const infoLeft = margin;
  const infoRight = pageW / 2 + 5;

  const leftInfo = [
    run.jobNumber ? `Job: ${run.jobNumber}` : null,
    `Customer: ${run.customer}`,
    run.loadRef ? `Ref: ${run.loadRef}` : null,
  ].filter(Boolean) as string[];

  const rightInfo = [
    `Date: ${formatDate(run.date)}`,
    run.vehicle ? `Vehicle: ${run.vehicle}` : null,
    `Type: ${run.runType === "backload" ? "Backload" : "Regular"}`,
  ].filter(Boolean) as string[];

  const maxInfoLines = Math.max(leftInfo.length, rightInfo.length);
  for (let i = 0; i < maxInfoLines; i++) {
    if (leftInfo[i]) {
      doc.setFont("helvetica", "bold");
      const [label, ...rest] = leftInfo[i].split(": ");
      doc.text(`${label}:`, infoLeft, y);
      doc.setFont("helvetica", "normal");
      doc.text(rest.join(": "), infoLeft + doc.getTextWidth(`${label}:  `), y);
    }
    if (rightInfo[i]) {
      doc.setFont("helvetica", "bold");
      const [label, ...rest] = rightInfo[i].split(": ");
      doc.text(`${label}:`, infoRight, y);
      doc.setFont("helvetica", "normal");
      doc.text(rest.join(": "), infoRight + doc.getTextWidth(`${label}:  `), y);
    }
    y += 5;
  }

  // Start info
  y += 2;
  doc.setFont("helvetica", "normal");
  const startLabel = run.runType === "backload" ? "Collection" : "Base";
  doc.text(
    `${startLabel}: ${nick(run.fromPostcode, nicknames)}  |  Depart: ${run.startTime}`,
    margin,
    y
  );
  y += 8;

  // ── Stops table ──
  // Column positions
  const colStop = margin;
  const colPostcode = margin + 14;
  const colEta = margin + contentW * 0.55;
  const colRef = margin + contentW * 0.72;

  // Table header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Stop", colStop, y);
  doc.text("Postcode", colPostcode, y);
  doc.text("ETA", colEta, y);
  doc.text("Reference", colRef, y);
  y += 2;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Map stop index to ETA from chain legs
  // etaChain.legs: first leg is vehicle/base to Stop 1, etc.
  const stopEtas: Record<number, string> = {};
  let legStopIdx = 0;
  for (const leg of etaChain.legs) {
    if (leg.toLabel.startsWith("Stop")) {
      stopEtas[legStopIdx] = leg.arriveLabel;
      legStopIdx++;
    }
  }

  // Render stops
  for (let i = 0; i < stops.length; i++) {
    // Check if we need a new page
    if (y > 270) {
      doc.addPage();
      y = margin;
    }

    const postcode = stops[i];
    const booking = stopBookingTimes?.get(i);
    const eta = booking || stopEtas[i] || "";
    const ref = stopRefs.get(i) || "";
    const pcDisplay = nick(postcode, nicknames);

    doc.text(String(i + 1), colStop + 4, y, { align: "center" });
    doc.text(pcDisplay, colPostcode, y);
    doc.text(eta, colEta, y);

    // Truncate long refs to fit
    const maxRefW = pageW - margin - colRef;
    let refText = ref;
    if (doc.getTextWidth(refText) > maxRefW) {
      while (doc.getTextWidth(refText + "...") > maxRefW && refText.length > 0) {
        refText = refText.slice(0, -1);
      }
      refText += "...";
    }
    doc.text(refText, colRef, y);
    y += 6;
  }

  // Return to base row
  if (run.returnToBase) {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    y += 1;
    doc.setDrawColor(220);
    doc.line(margin, y - 3, pageW - margin, y - 3);
    doc.setFont("helvetica", "italic");
    doc.text("Return to base", colPostcode, y);
    doc.text(etaChain.finalArriveLabel || etaChain.finalArriveAtHHMM, colEta, y);
    y += 6;
  }

  // ── Summary ──
  y += 4;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Summary", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const totalKm = Math.round(etaChain.totalKm);
  const summary = `${totalKm} km  |  ${formatMins(etaChain.totalDriveMins)} driving  |  ${formatMins(etaChain.totalBreakMins)} breaks  |  ${formatMins(etaChain.totalServiceMins)} service`;
  doc.text(summary, margin, y);
  y += 5;
  doc.text(`Finish: ${etaChain.finalArriveLabel || etaChain.finalArriveAtHHMM}  |  Total: ${formatMins(etaChain.totalMins)}`, margin, y);

  // ── Footer ──
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(
    `Generated ${new Date().toLocaleString("en-GB")} — ETAs are estimates based on current traffic conditions`,
    margin,
    pageH - 8
  );

  // Download
  const filename = `${run.jobNumber || "run"}-eta.pdf`;
  doc.save(filename);
}
