"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/portal/ToastContext";
import DriverForm from "@/components/hr/drivers/DriverForm";
import LicenceCheckDrop from "@/components/hr/drivers/LicenceCheckDrop";
import LicencePanel from "@/components/hr/drivers/LicencePanel";
import DriverDocsPanel from "@/components/hr/drivers/DriverDocsPanel";
import DriverFilesPanel from "@/components/hr/drivers/DriverFilesPanel";
import {
  addDriverFile,
  getDriverRecord,
  listDriverRecords,
  saveDriverRecord,
  type DriverLogin,
} from "@/app/actions/hr-drivers";
import { listHrOverview, type HrOverview } from "@/app/actions/hr";
import { driverDocumentViews } from "@/lib/hr/status";
import { driverFieldsFromLicence, licenceChanges, type LicenceCheck } from "@/lib/hr/licence";
import { driverName, type DriverFile, type DriverInput, type DriverRecord } from "@/types/hr-drivers";

interface PendingCheck {
  path: string;
  licence: LicenceCheck;
  fileName: string;
}

/** The editable part of a record (everything except id and licence data). */
function toForm(d: DriverRecord): Partial<DriverInput> {
  const form: Partial<DriverRecord> = { ...d };
  delete form.id;
  delete form.licence;
  delete form.licenceCheckedOn;
  return form as Partial<DriverInput>;
}

export default function DriverRecordPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const { profile, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();

  const [driver, setDriver] = useState<DriverRecord | null>(null);
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [form, setForm] = useState<Partial<DriverInput>>({ status: "starter" });
  const [logins, setLogins] = useState<DriverLogin[]>([]);
  const [overview, setOverview] = useState<HrOverview | null>(null);
  const [pending, setPending] = useState<PendingCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && profile?.role !== "admin") router.push("/");
  }, [loading, profile, router]);

  const load = useCallback(async () => {
    const [list, o, rec] = await Promise.all([
      listDriverRecords(),
      listHrOverview(),
      isNew ? Promise.resolve(null) : getDriverRecord(id),
    ]);
    // Logins already linked to another driver can't be chosen again.
    const taken = new Set((list.drivers ?? []).filter((d) => d.id !== id && d.profileId).map((d) => d.profileId));
    setLogins((list.logins ?? []).filter((l) => !taken.has(l.id)));
    setOverview(o.data ?? null);
    if (rec) {
      if (rec.error || !rec.driver) return setError(rec.error ?? "Driver not found");
      setDriver(rec.driver);
      setFiles(rec.files ?? []);
      setForm(toForm(rec.driver));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (profile?.role === "admin") queueMicrotask(() => { load(); });
  }, [profile, load]);

  const views = useMemo(
    () => driver?.profileId && overview
      ? driverDocumentViews(driver.profileId, overview.documents, overview.assignments, overview.signatures, new Date())
      : [],
    [driver, overview],
  );
  const changes = pending && driver ? licenceChanges(driver.licence, pending.licence) : [];

  const onCheckRead = (path: string, licence: LicenceCheck, fileName: string) => {
    setPending({ path, licence, fileName });
    // A new driver's details come straight from the check; existing records keep what's there.
    if (isNew) setForm((f) => ({ ...f, ...driverFieldsFromLicence(licence) }));
  };

  const attachCheck = async (driverId: string, check: PendingCheck) => {
    const res = await addDriverFile({
      driverId,
      path: check.path,
      kind: "licence_check",
      title: check.fileName,
      licence: check.licence,
    });
    if (res.error) throw new Error(res.error);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await saveDriverRecord(isNew ? null : id, form);
      if (res.error || !res.id) throw new Error(res.error ?? "Couldn't save");
      if (isNew && pending) await attachCheck(res.id, pending);
      showToast("Driver saved");
      if (isNew) router.replace(`/admin/hr/drivers/${res.id}`);
      else load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCheck = async () => {
    if (!pending || !driver) return;
    setBusy(true);
    try {
      await attachCheck(driver.id, pending);
      setPending(null);
      showToast("Licence check saved");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shownLicence = pending?.licence ?? driver?.licence ?? null;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="muted" style={{ fontSize: 12 }}><Link href="/admin/hr/drivers">Driver records</Link> /</div>
          <h1 className="page-title">{isNew ? "Add driver" : driver ? driverName(driver) : "Driver"}</h1>
        </div>
        <button className="btn primary" type="button" disabled={busy} onClick={save}>
          {busy ? "Saving…" : isNew ? "Save driver" : "Save changes"}
        </button>
      </div>
      {error && <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}><div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div></div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div className="card-header"><h3>Licence</h3></div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              {pending && (
                <div style={{ fontSize: 12.5, padding: 10, borderRadius: 8, background: "var(--info-bg)" }}>
                  <b>Read from {pending.fileName}.</b>{" "}
                  {isNew
                    ? "Name, date of birth and address have been filled in below. Check them, add the NI number and start date, then Save driver."
                    : changes.length
                      ? <>Changes since the last check:<ul style={{ margin: "4px 0 0 18px" }}>{changes.map((c) => <li key={c}>{c}</li>)}</ul></>
                      : "No changes since the last check."}
                  {!isNew && (
                    <div className="row gap-8" style={{ marginTop: 8 }}>
                      <button className="btn primary sm" type="button" disabled={busy} onClick={saveCheck}>Save this check</button>
                      <button className="btn sm ghost" type="button" onClick={() => setPending(null)}>Discard</button>
                    </div>
                  )}
                </div>
              )}
              {shownLicence ? <LicencePanel licence={shownLicence} /> : null}
              <LicenceCheckDrop
                onRead={onCheckRead}
                label={shownLicence ? "Drop a newer AssetGo licence check to update" : "Drop the driver's AssetGo licence check PDF here"}
              />
            </div>
          </div>

          {!isNew && driver && (
            <>
              <div className="card">
                <div className="card-header"><h3>Documents to sign</h3></div>
                <div className="card-body">
                  {driver.profileId ? <DriverDocsPanel views={views} /> : (
                    <div className="muted" style={{ fontSize: 12.5 }}>Link this driver&apos;s portal login (under Employment) to see their documents.</div>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h3>Files held</h3></div>
                <div className="card-body"><DriverFilesPanel driverId={driver.id} files={files} onChanged={load} /></div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header"><h3>Details</h3></div>
          <div className="card-body"><DriverForm value={form} logins={logins} onChange={setForm} /></div>
        </div>
      </div>
    </>
  );
}
