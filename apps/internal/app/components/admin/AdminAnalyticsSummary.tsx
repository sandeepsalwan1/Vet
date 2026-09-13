import type { ClientAnalyticsSnapshot } from "@central-vet/db";
import {
  Activity,
  CalendarCheck2,
  ChartNoAxesColumnIncreasing,
  HeartPulse,
  RotateCcw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { analyticsPercent } from "./adminAnalyticsModel";

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
        <strong className="tabular-nums">{analyticsPercent(props.value)}</strong>
      </div>
      <Progress
        aria-label={`${props.label}: ${analyticsPercent(props.value)}`}
        value={props.value ?? 0}
      />
    </div>
  );
}

export function AdminAnalyticsMetrics({
  snapshot
}: {
  snapshot: ClientAnalyticsSnapshot;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Analytics summary">
      <MetricCard
        title="Completed visits"
        value={String(snapshot.visits.completed)}
        detail={`${snapshot.visits.clients} ${snapshot.visits.clients === 1 ? "client" : "clients"} in this range`}
        icon={CalendarCheck2}
      />
      <MetricCard
        title="Returning clients"
        value={analyticsPercent(snapshot.visits.returnRate)}
        detail={`${snapshot.visits.returningClients} clients with a prior completed visit`}
        icon={RotateCcw}
      />
      <MetricCard
        title="Visit satisfaction"
        value={analyticsPercent(snapshot.experience.positiveRate)}
        detail={`${snapshot.experience.responses} client responses`}
        icon={ChartNoAxesColumnIncreasing}
      />
      <MetricCard
        title="Pets doing well"
        value={analyticsPercent(snapshot.petHealth.doingWellRate)}
        detail={`${snapshot.petHealth.concerns} recovery concerns reported`}
        icon={HeartPulse}
      />
    </section>
  );
}

export function AdminAnalyticsRates({
  snapshot
}: {
  snapshot: ClientAnalyticsSnapshot;
}) {
  return (
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
  );
}
