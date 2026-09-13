"use client";

import { BellRing, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { AccountSession } from "../../lib/accountStore";
import {
  AdminNotificationOverview,
  AdminRecentMessages
} from "./AdminNotificationSummary";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import { SaveCelebration } from "./SaveCelebration";
import { useAdminNotificationSettings } from "./useAdminNotificationSettings";

type AdminSession = AccountSession & { role: "admin" };

export function AdminNotificationsTab({ session }: { session: AdminSession }) {
  const {
    snapshot,
    draft,
    updateDraft,
    error,
    saving,
    hasChanges,
    load,
    save,
    celebration
  } = useAdminNotificationSettings(session);

  if (!snapshot || !draft) {
    return (
      <main className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground">
        <BellRing />
        <p>{error || "Loading notifications…"}</p>
        {error
          ? <Button variant="outline" onClick={() => void load()}>Try again</Button>
          : null}
      </main>
    );
  }

  const deliveryLive = snapshot.deliveryMode === "production";

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              Notifications
            </h2>
            <p className="text-sm text-muted-foreground">
              Set timing, channels, and quiet hours.
            </p>
          </div>
          <Badge variant={deliveryLive ? "default" : "secondary"}>
            <ShieldCheck data-icon="inline-start" />
            {deliveryLive ? "Delivery on" : "Delivery paused"}
          </Badge>
        </header>

        {!deliveryLive ? (
          <Alert>
            <BellRing />
            <AlertTitle>Messages are not sending</AlertTitle>
            <AlertDescription>
              Settings save now. Delivery stays paused until production mode is enabled.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <NotificationSettingsCard
            draft={draft}
            hasChanges={hasChanges}
            onChange={updateDraft}
            onSave={() => void save()}
            saving={saving}
            timeZone={snapshot.settings.timeZone}
          />
          <AdminNotificationOverview draft={draft} />
        </div>

        <SaveCelebration
          animationKey={celebration.animationKey}
          visible={celebration.visible}
        />

        <AdminRecentMessages items={snapshot.items} />
      </div>
      <Toaster position="top-right" />
    </main>
  );
}
