import { describe, expect, it } from "vitest";
import { hrDigestEmail } from "./hr-digest";

describe("hrDigestEmail", () => {
  it("summarises counts in the subject and escapes content", () => {
    const email = hrDigestEmail(
      [
        { level: "danger", who: "Sam <Driver>", message: "No right-to-work evidence on file", href: "/x" },
        { level: "info", who: null, message: "Minor thing", href: "/y" },
      ],
      ["Get Sam's right-to-work check done"],
      "https://portal.example",
    );
    expect(email.subject).toBe("MLC HR summary: 1 urgent, 1 minor");
    expect(email.html).toContain("Sam &lt;Driver&gt;");
    expect(email.html).toContain("Priorities this fortnight");
    expect(email.text).toContain("- Sam <Driver>: No right-to-work evidence on file");
    expect(email.text).toContain("https://portal.example/admin/hr/drivers");
  });

  it("says when everything is up to date", () => {
    expect(hrDigestEmail([], [], "https://p").subject).toBe("MLC HR summary: everything up to date");
  });
});
