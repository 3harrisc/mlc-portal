// ── Completion / proximity rules ─────────────────────────────────────
export const COMPLETION_RADIUS_METERS = 800;
export const MIN_STANDSTILL_MINS = 3;
export const STANDSTILL_SPEED_KPH = 3;

// ── HGV driving rules ───────────────────────────────────────────────
export const HGV_TIME_MULTIPLIER = 1.15;
export const MAX_SPEED_KPH = 88.5; // 55 mph
export const MAX_DRIVE_BEFORE_BREAK_MINS = 270; // 4h30
export const BREAK_MINS = 45;

// ── UI rules ─────────────────────────────────────────────────────────
export const AFTER_HOURS_CUTOFF_MINS = 17 * 60; // 17:00

// ── Default service time ─────────────────────────────────────────────
export const DEFAULT_SERVICE_MINS = 25;
export const DEFAULT_START_TIME = "08:00";
