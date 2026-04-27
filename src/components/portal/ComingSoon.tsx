interface ComingSoonProps {
  title: string;
  subtitle?: string;
  body?: string;
}

export default function ComingSoon({ title, subtitle, body }: ComingSoonProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--ink-500)",
              fontSize: 12.5,
            }}
          >
            {body ?? "This screen is being wired up. Check back shortly."}
          </div>
        </div>
      </div>
    </>
  );
}
