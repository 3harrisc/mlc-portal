import { describe, it, expect } from "vitest";
import { buildSchedule, type Stop } from "./planning";

const stop = (id: string, extra: Partial<Stop> = {}): Stop => ({
  id,
  input: id,
  postcode: id,
  open: "08:00",
  close: "17:00",
  ...extra,
});

const arrivals = (rows: ReturnType<typeof buildSchedule>) =>
  rows.filter((r) => r.stopId).map((r) => [r.stopId, r.at, r.status]);

describe("buildSchedule", () => {
  it("delays departure so the first drop is reached at opening, not before", () => {
    const rows = buildSchedule("03:00", [stop("A"), stop("B")], [96, 37], 25, true, "BASE");
    expect(rows[0].at).toBe("06:24");
    expect(rows[0].note).toMatch(/Delayed from 03:00/);
    expect(arrivals(rows)).toEqual([
      ["A", "08:00", "ok"],
      ["B", "09:02", "ok"],
    ]);
  });

  it("waits for a booking time mid-route and pushes later drops back", () => {
    const rows = buildSchedule(
      "08:00",
      [stop("A"), stop("B", { time: "11:00" }), stop("C")],
      [30, 30, 30],
      25,
      true,
    );
    // A 08:30, leave 08:55, B arrive 09:25, wait until 11:00, leave 11:25, C 11:55
    expect(arrivals(rows)).toEqual([
      ["A", "08:30", "ok"],
      ["B", "09:25", "wait"],
      ["C", "11:55", "ok"],
    ]);
    const wait = rows.find((r) => r.kind === "wait")!;
    expect(wait.minutes).toBe(95);
    expect(wait.label).toMatch(/counts as break/);
  });

  it("flags a missed booking and an after-close arrival as late", () => {
    const rows = buildSchedule(
      "08:00",
      [stop("A", { time: "08:30" }), stop("B", { close: "09:00" })],
      [60, 60],
      25,
      false,
    );
    expect(arrivals(rows)).toEqual([
      ["A", "09:00", "late"],
      ["B", "10:25", "late"],
    ]);
    expect(rows.find((r) => r.stopId === "A")!.note).toBe("Late 30 min for 08:30 booking");
    expect(rows.find((r) => r.stopId === "B")!.note).toBe("Arrives 1h 25m after 09:00 close");
  });

  it("marks times past midnight with +1d", () => {
    const rows = buildSchedule("23:00", [stop("A", { open: undefined, close: undefined })], [90], 0, false);
    expect(arrivals(rows)).toEqual([["A", "00:30 +1d", "ok"]]);
  });
});
