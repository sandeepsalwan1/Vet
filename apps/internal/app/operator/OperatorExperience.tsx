"use client";

import {
  BellRing,
  CalendarDays,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { type SubmitEvent, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  clearOperatorSession,
  createOperatorSession,
  operatorErrorMessage,
  operatorErrorStatus,
  readOperatorSnapshot,
  setOperatorUsageAlerts,
  type OperatorSnapshot
} from "./operatorClient";

type View = "loading" | "login" | "dashboard";

function readableDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function metricValue(value: number | null, suffix = "") {
  return value === null ? "Collecting" : `${value.toLocaleString()}${suffix}`;
}

export function OperatorExperience({ configured }: { configured: boolean }) {
  const [view, setView] = useState<View>(configured ? "loading" : "login");
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setError("");
    try {
      const next = await readOperatorSnapshot();
      setSnapshot(next);
      setView("dashboard");
    } catch (loadError) {
      if (operatorErrorStatus(loadError) === 401) {
        setView("login");
        setSnapshot(null);
        return;
      }
      setError(operatorErrorMessage(loadError));
      setView("login");
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    const id = window.setTimeout(() => void loadSnapshot(), 0);
    return () => window.clearTimeout(id);
  }, [configured, loadSnapshot]);

  async function handleLogin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createOperatorSession(passcode);
      setPasscode("");
      await loadSnapshot();
    } catch (loginError) {
      setError(operatorErrorMessage(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await clearOperatorSession();
    } finally {
      setSnapshot(null);
      setView("login");
      setBusy(false);
    }
  }

  async function handleAlertChange(enabled: boolean) {
    if (!snapshot) return;
    setBusy(true);
    setError("");
    try {
      const alert = await setOperatorUsageAlerts(enabled);
      setSnapshot({ ...snapshot, alert });
    } catch (settingsError) {
      setError(operatorErrorMessage(settingsError));
    } finally {
      setBusy(false);
    }
  }

  if (!configured || view === "login") {
    return (
      <main className="min-h-screen px-4 py-10 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[75vh] max-w-md items-center">
          <Card className="w-full">
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-secondary">
                <ShieldCheck aria-hidden="true" className="size-5" />
              </div>
              <CardTitle>Private product pulse</CardTitle>
              <CardDescription>
                Separate from every hospital account and report.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!configured ? (
                <Alert>
                  <ShieldCheck aria-hidden="true" />
                  <AlertTitle>Access setup needed</AlertTitle>
                  <AlertDescription>
                    Add the private operator access code before this page can open.
                  </AlertDescription>
                </Alert>
              ) : (
                <form id="operator-login" onSubmit={handleLogin}>
                  <FieldGroup>
                    <Field data-invalid={Boolean(error)}>
                      <FieldLabel htmlFor="operator-passcode">Private access code</FieldLabel>
                      <Input
                        id="operator-passcode"
                        type="password"
                        autoComplete="current-password"
                        value={passcode}
                        onChange={(event) => setPasscode(event.target.value)}
                        aria-invalid={Boolean(error)}
                        autoFocus
                      />
                      <FieldDescription>
                        Hospital Admin access does not work here.
                      </FieldDescription>
                      {error && <FieldError>{error}</FieldError>}
                    </Field>
                  </FieldGroup>
                </form>
              )}
            </CardContent>
            {configured && (
              <CardFooter>
                <Button form="operator-login" type="submit" disabled={busy || !passcode}>
                  {busy ? "Opening…" : "Open product pulse"}
                </Button>
              </CardFooter>
            )}
          </Card>
        </section>
      </main>
    );
  }

  if (view === "loading" || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-foreground">
        <p className="shimmer">Opening your product pulse…</p>
      </main>
    );
  }

  const returnRate = snapshot.returnRate.percent;
  const collecting = returnRate === null;
  const alertDescription = collecting
    ? `Waiting for ${snapshot.returnRate.minimumCohortSize} people with a complete 30-day return window.`
    : `${snapshot.returnRate.returnedUsers} of ${snapshot.returnRate.eligibleUsers} people returned during days 8–30.`;

  return (
    <main className="min-h-screen px-4 py-8 text-foreground sm:px-6 lg:py-12">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <Badge variant="secondary" className="w-fit">
              <ShieldCheck aria-hidden="true" />
              Private to you
            </Badge>
            <h1 className="font-[var(--font-display)] text-4xl tracking-tight sm:text-5xl">
              Product pulse
            </h1>
            <p className="max-w-xl text-muted-foreground">
              Real clinic-team use across Vet, without patient or client content.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void loadSnapshot()}
              disabled={busy}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button variant="ghost" onClick={() => void handleLogout()} disabled={busy}>
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          </div>
        </header>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not save that</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Daily active users</CardTitle>
              <CardDescription>Meaningful authenticated use today</CardDescription>
              <CardAction>
                <UsersRound aria-hidden="true" className="size-5 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="font-[var(--font-display)] text-4xl">
                {metricValue(snapshot.dailyActiveUsers)}
              </p>
            </CardContent>
            <CardFooter>
              <p className="text-sm text-muted-foreground">
                {snapshot.activeHospitals} active hospital{snapshot.activeHospitals === 1 ? "" : "s"} in 30 days
              </p>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Return rate</CardTitle>
              <CardDescription>Week 2 and later</CardDescription>
              <CardAction>
                <Badge variant={collecting ? "secondary" : "outline"}>
                  {collecting ? "Collecting" : "Days 8–30"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="font-[var(--font-display)] text-4xl">
                {metricValue(returnRate, "%")}
              </p>
            </CardContent>
            <CardFooter>
              <p className="text-sm text-muted-foreground">{alertDescription}</p>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sessions this month</CardTitle>
              <CardDescription>New after 30 minutes away</CardDescription>
              <CardAction>
                <CalendarDays aria-hidden="true" className="size-5 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="font-[var(--font-display)] text-4xl">
                {metricValue(snapshot.sessionsThisMonth)}
              </p>
            </CardContent>
            <CardFooter>
              <p className="text-sm text-muted-foreground">
                Data through {readableDate(snapshot.dataThrough)}
              </p>
            </CardFooter>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Low-return email</CardTitle>
            <CardDescription>
              Quiet protection for the metric most likely to reveal fading adoption.
            </CardDescription>
            <CardAction>
              <Badge variant={snapshot.alert.enabled ? "default" : "secondary"}>
                {snapshot.alert.enabled ? "On" : "Off"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal" data-disabled={busy}>
                <FieldContent>
                  <FieldTitle id="usage-alert-title">
                    Email when return rate is below {snapshot.alert.thresholdPercent}%
                  </FieldTitle>
                  <FieldDescription>
                    Sends once when it drops below the threshold, then at most once every 30 days while it stays low.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={snapshot.alert.enabled}
                  onCheckedChange={(enabled) => void handleAlertChange(enabled)}
                  disabled={busy}
                  aria-labelledby="usage-alert-title"
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-1">
            <p className="text-sm">
              <BellRing aria-hidden="true" className="mr-2 inline size-4" />
              {snapshot.alert.recipientConfigured
                ? `Delivery: ${snapshot.alert.recipient}`
                : "Delivery email still needs secure deployment setup."}
            </p>
            <p className="text-sm text-muted-foreground">
              No email while data is collecting. Last sent: {readableDate(snapshot.alert.lastSentAt)}.
            </p>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}
