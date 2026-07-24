"use client";

import type {
  AnalyticsRangeDays,
  ClientAnalyticsSnapshot
} from "@central-vet/db";
import {
  Activity,
  CalendarCheck2,
  ChartNoAxesColumnIncreasing,
  Clock3,
  HeartPulse,
  Mail,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Sparkles
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/chart";
import {
  NativeSelect,
  NativeSelectOption
} from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { AccountSession } from "../../lib/accountStore";
import type { TaskBoardSession } from "../taskBoardTypes";
import { readAdminAnalytics } from "./analyticsClient";

type AdminSession = AccountSession & { role: "admin" };

const chartConfig = {
  median: {
    label: "Median minutes",
    color: "var(--chart-1)"
  },
  p90: {
    label: "90th percentile",
    color: "var(--chart-3)"
  }
} satisfies ChartConfig;

function percent(value: number | null) {
  return value === null ? "Collecting" : `${value}%`;
}

function minutes(value: number | null) {
  if (value === null) return "Collecting";
  if (value < 1) return "<1 min";
  return `${Math.round(value)} min`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function freshness(value: string | null) {
  if (!value) return "Waiting for first event";
  return `Data through ${dateTime(value)}`;
}

function AnalyticsLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-36 w-full" key={index} />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function MetricCard(props: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  const Icon = props.icon;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.detail}</CardDescription>
        <CardAction>
          <Badge variant="secondary">
            <Icon data-icon="inline-start" />
            Live
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-3xl font-semibold tracking-tight">{props.value}</p>
      </CardContent>
    </Card>
  );
}

function RateRow(props: {
  label: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-medium">{props.label}</p>
          <p className="text-xs text-muted-foreground">{props.detail}</p>
        </div>
        <strong className="tabular-nums">{percent(props.value)}</strong>
      </div>
      <Progress value={props.value ?? 0} aria-label={`${props.label}: ${percent(props.value)}`} />
    </div>
  );
}

export function AdminAnalyticsTab({ session }: { session: AdminSession }) {
  const [rangeDays, setRangeDays] = useState<AnalyticsRangeDays>(30);
  const [snapshot, setSnapshot] = useState<ClientAnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const actor = useMemo<TaskBoardSession>(() => ({
    name: session.name,
    role: "admin",
    passcode: session.passcode
  }), [session.name, session.passcode]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setSnapshot(await readAdminAnalytics(actor, rangeDays, signal));
      setError("");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Analytics are unavailable.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [actor, rangeDays]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  const waitChart = snapshot?.waitStages
    .filter((stage) => stage.sampleSize > 0)
    .map((stage) => ({
      stage: stage.label,
      median: stage.medianMinutes,
      p90: stage.p90Minutes
    })) ?? [];

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl shrink-0 flex-col gap-4 self-start">
        <Card className="bg-card/95">
          <CardHeader>
            <CardTitle className="text-2xl sm:text-3xl">Client experience analytics</CardTitle>
            <CardDescription>
              Real timestamps from check-in through checkout, followed by satisfaction, recovery, and return behavior.
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <NativeSelect
                aria-label="Analytics date range"
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value) as AnalyticsRangeDays)}
              >
                <NativeSelectOption value={30}>Last 30 days</NativeSelectOption>
                <NativeSelectOption value={90}>Last 90 days</NativeSelectOption>
                <NativeSelectOption value={365}>Last year</NativeSelectOption>
              </NativeSelect>
              <Button
                aria-label="Refresh analytics"
                disabled={loading}
                onClick={() => void load()}
                size="icon"
                type="button"
                variant="outline"
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <Activity data-icon="inline-start" />
              {freshness(snapshot?.dataThrough ?? null)}
            </Badge>
            <Badge variant="secondary">
              <Sparkles data-icon="inline-start" />
              No estimated data
            </Badge>
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Analytics could not load</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !snapshot ? <AnalyticsLoading /> : null}

        {snapshot ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Analytics summary">
              <MetricCard
                title="Completed visits"
                value={String(snapshot.visits.completed)}
                detail={`${snapshot.visits.clients} ${snapshot.visits.clients === 1 ? "client" : "clients"} in this range`}
                icon={CalendarCheck2}
              />
              <MetricCard
                title="Returning clients"
                value={percent(snapshot.visits.returnRate)}
                detail={`${snapshot.visits.returningClients} clients with a prior completed visit`}
                icon={RotateCcw}
              />
              <MetricCard
                title="Visit satisfaction"
                value={percent(snapshot.experience.positiveRate)}
                detail={`${snapshot.experience.responses} client responses`}
                icon={ChartNoAxesColumnIncreasing}
              />
              <MetricCard
                title="Pets doing well"
                value={percent(snapshot.petHealth.doingWellRate)}
                detail={`${snapshot.petHealth.concerns} recovery concerns reported`}
                icon={HeartPulse}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Where clients wait</CardTitle>
                  <CardDescription>
                    Median shows the typical visit. The 90th percentile exposes the longest waits.
                  </CardDescription>
                  <CardAction>
                    <Badge variant="outline">
                      <Clock3 data-icon="inline-start" />
                      Minutes
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {waitChart.length > 0 ? (
                    <ChartContainer className="h-72 w-full" config={chartConfig}>
                      <BarChart accessibilityLayer data={waitChart}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          axisLine={false}
                          dataKey="stage"
                          tickLine={false}
                          tickMargin={8}
                          tickFormatter={(value) => String(value).replace(" to ", " → ")}
                        />
                        <YAxis axisLine={false} tickLine={false} width={30} />
                        <ChartTooltip
                          content={<ChartTooltipContent />}
                          cursor={false}
                        />
                        <Bar dataKey="median" fill="var(--color-median)" radius={4} />
                        <Bar dataKey="p90" fill="var(--color-p90)" radius={4} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <Alert>
                      <Clock3 />
                      <AlertTitle>Wait-time collection has started</AlertTitle>
                      <AlertDescription>
                        Each stage appears after a visit records both its start and end timestamp.
                      </AlertDescription>
                    </Alert>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stage</TableHead>
                        <TableHead>Median</TableHead>
                        <TableHead>90th</TableHead>
                        <TableHead>Visits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.waitStages.map((stage) => (
                        <TableRow key={stage.key}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{stage.label}</span>
                              <span className="text-xs text-muted-foreground">{stage.description}</span>
                            </div>
                          </TableCell>
                          <TableCell>{minutes(stage.medianMinutes)}</TableCell>
                          <TableCell>{minutes(stage.p90Minutes)}</TableCell>
                          <TableCell>{stage.sampleSize}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Return business</CardTitle>
                    <CardDescription>Completed return visits and future appointments.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <RateRow
                      label="Returned after a prior visit"
                      value={snapshot.visits.returnRate}
                      detail={`${snapshot.visits.returningClients} of ${snapshot.visits.clients} clients`}
                    />
                    <RateRow
                      label="Already rebooked"
                      value={snapshot.visits.rebookRate}
                      detail={`${snapshot.visits.rebookedClients} future appointments`}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Feedback quality</CardTitle>
                    <CardDescription>Response rates keep positive scores in context.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <RateRow
                      label="Visit feedback response"
                      value={snapshot.experience.responseRate}
                      detail={`${snapshot.experience.responses} of ${snapshot.experience.promptsSent} sent prompts`}
                    />
                    <RateRow
                      label="Pet health response"
                      value={snapshot.petHealth.responseRate}
                      detail={`${snapshot.petHealth.responses} of ${snapshot.petHealth.promptsSent} sent emails`}
                    />
                  </CardContent>
                </Card>
              </div>
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Recovery follow-up</CardTitle>
                <CardDescription>
                  Email after {snapshot.followup.emailAfterHours} hours. Call after {snapshot.followup.callAfterHours} hours only when the client has not answered.
                </CardDescription>
                <CardAction className="flex gap-2">
                  <Badge variant="secondary">
                    <Mail data-icon="inline-start" />
                    {snapshot.followup.emailsSent} sent
                  </Badge>
                  <Badge variant={snapshot.followup.callsDue > 0 ? "destructive" : "outline"}>
                    <PhoneCall data-icon="inline-start" />
                    {snapshot.followup.callsDue} calls due
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                {snapshot.followup.items.length === 0 ? (
                  <Alert>
                    <HeartPulse />
                    <AlertTitle>No unanswered recovery emails need a call</AlertTitle>
                    <AlertDescription>
                      {snapshot.followup.awaitingResponse} sent emails are still inside the response window.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Pet</TableHead>
                        <TableHead>Email sent</TableHead>
                        <TableHead>Call due</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.followup.items.map((item) => (
                        <TableRow key={`${item.clientId}-${item.appointmentId ?? item.callDueAt}`}>
                          <TableCell className="font-medium">{item.clientName}</TableCell>
                          <TableCell>{item.petName}</TableCell>
                          <TableCell>{dateTime(item.emailSentAt)}</TableCell>
                          <TableCell>{dateTime(item.callDueAt)}</TableCell>
                          <TableCell>
                            {item.phone ? (
                              <Button asChild size="sm" variant="outline">
                                <a href={`tel:${item.phone}`}>
                                  <PhoneCall data-icon="inline-start" />
                                  Call
                                </a>
                              </Button>
                            ) : (
                              <Badge variant="outline">No phone</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </main>
  );
}
