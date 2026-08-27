/**
 * The public-path list decides which requests skip supabase.auth.getUser().
 *
 * That call is a network round-trip inside Vercel's edge middleware budget,
 * and when Supabase Auth is slow it returns 504
 * MIDDLEWARE_INVOCATION_TIMEOUT for whatever path is waiting on it. Customer
 * share links and the Postmark inbound webhook have their own auth and never
 * read `user`, so they must not be behind that call — a regression here takes
 * them down with no trace in the app, since the request never reaches a
 * route handler.
 */

import { describe, it, expect } from "vitest";
import { isPublicPath } from "./middleware";

describe("isPublicPath", () => {
  it("exempts customer share links", () => {
    expect(isPublicPath("/track/abc123")).toBe(true);
  });

  it("exempts the cron endpoints and the inbound email webhook", () => {
    expect(isPublicPath("/api/cron/update-progress")).toBe(true);
    expect(isPublicPath("/api/email-to-run")).toBe(true);
  });

  it("does not exempt authenticated surfaces", () => {
    for (const p of ["/", "/portal/loads", "/runs/1", "/admin/emails", "/login"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("does not exempt other API routes, which still get a 401 not a redirect", () => {
    expect(isPublicPath("/api/eta")).toBe(false);
    expect(isPublicPath("/api/xero/export")).toBe(false);
  });

  it("does not exempt a path that merely mentions a public prefix deeper in", () => {
    expect(isPublicPath("/portal/track/abc")).toBe(false);
    expect(isPublicPath("/api/internal/cron")).toBe(false);
  });
});
