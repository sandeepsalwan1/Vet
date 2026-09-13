"use client";

import type { AnalyticsRangeDays } from "@central-vet/db";
import { Activity, RefreshCw, Sparkles } from "lucide-react";
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
  NativeSelect,
  NativeSelectOption
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdminAnalyticsMetrics,
  AdminAnalyticsRates
} from "./AdminAnalyticsSummary";
import { AdminRecoveryFollowup } from "./AdminRecoveryFollowup";
import { AdminWaitTimeAnalytics } from "./AdminWaitTimeAnalytics";
import { analyticsFreshness } from "./adminAnalyticsModel";
import {
  type AdminAnalyticsSession,
  useAdminAnalytics
} from "./useAdminAnalytics";

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

export function AdminAnalyticsTab({
  session
}: {
  session: AdminAnalyticsSession;
}) {
  const {
    rangeDays,
    setRangeDays,
    snapshot,
    error,
    loading,
    refresh
  } = useAdminAnalytics(session);

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
                name="analytics-date-range"
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
                onClick={refresh}
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
              {analyticsFreshness(snapshot?.dataThrough ?? null)}
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
            <AdminAnalyticsMetrics snapshot={snapshot} />
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <AdminWaitTimeAnalytics stages={snapshot.waitStages} />
              <AdminAnalyticsRates snapshot={snapshot} />
            </section>
            <AdminRecoveryFollowup followup={snapshot.followup} />
          </>
        ) : null}
      </div>
    </main>
  );
}
