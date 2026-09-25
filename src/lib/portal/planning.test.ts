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

  it("flags a missed booking as late", () => {
    const rows = buildSchedule("08:00", [stop("A", { time: "08:30" })], [60], 25, false);
    expect(arrivals(rows)).toEqual([["A", "09:00", "late"]]);
    expect(rows.find((r) => r.stopId === "A")!.note).toBe("Late 30 min for 08:30 booking");
  });

  it("rolls a drop that misses closing to next day's opening, and later drops follow", () => {
    const rows = buildSchedule(
      "08:00",
      [stop("A"), stop("B"), stop("C")],
      [480, 90, 30],
      25,
      false,
    );
    // A 16:00 ok; leave 16:25, B would arrive 17:55 (shut) → 08:00 +1d; C 08:55 +1d
    expect(arrivals(rows)).toEqual([
      ["A", "16:00", "ok"],
      ["B", "08:00 +1d", "nextday"],
      ["C", "08:55 +1d", "ok"],
    ]);
    const overnight = rows.find((r) => r.kind === "wait")!;
    expect(overnight.at).toBe("17:55");
    expect(overnight.label).toMatch(/Overnight/);
  });

  it("resets the driving clock after an overnight wait", () => {
    const rows = buildSchedule(
      "08:00",
      [stop("A"), stop("B"), stop("C")],
      [240, 300, 200],
      0,
      true,
    );
    // A 12:00, 45 break (240+300>270), B 17:45 → next day 08:00; C 11:20 +1d with no extra break
    expect(arrivals(rows)).toEqual([
      ["A", "12:00", "ok"],
      ["B", "08:00 +1d", "nextday"],
      ["C", "11:20 +1d", "ok"],
    ]);
    expect(rows.filter((r) => r.kind === "break")).toHaveLength(1);
  });

  it("marks times past midnight with +1d", () => {
    const rows = buildSchedule("23:00", [stop("A", { open: undefined, close: undefined })], [90], 0, false);
    expect(arrivals(rows)).toEqual([["A", "00:30 +1d", "ok"]]);
  });
});
