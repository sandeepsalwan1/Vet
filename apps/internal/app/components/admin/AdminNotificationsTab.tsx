"use client";

import type { ClientJourneySettings } from "@central-vet/db";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  MessageSquareText,
  Save,
  ShieldCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import type { AccountSession } from "../../lib/accountStore";
import {
  readStaffClientJourney,
  saveClientJourneySettings
} from "../staffJourneyClient";
import { taskBoardActorQuery } from "../taskBoardClient";
import type { TaskBoardSession } from "../taskBoardTypes";

type AdminSession = AccountSession & { role: "admin" };
type EditableSettings = Pick<
  ClientJourneySettings,
  | "confirmationEmailEnabled"
  | "reminderEmailHours"
  | "reminderSmsHours"
  | "reminderSmsEnabled"
  | "quietHoursStart"
  | "quietHoursEnd"
  | "feedbackDelayMinutes"
  | "petCheckDelayHours"
  | "followupCallDelayHours"
>;

const emailReminderOptions = [
  { value: 168, label: "1 week before" },
  { value: 72, label: "3 days before" },
  { value: 48, label: "2 days before" },
  { value: 24, label: "1 day before" },
  { value: 12, label: "12 hours before" }
];
const textReminderOptions = [
  { value: 48, label: "2 days before" },
  { value: 24, label: "1 day before" },
  { value: 12, label: "12 hours before" },
  { value: 6, label: "6 hours before" },
  { value: 2, label: "2 hours before" }
];
const feedbackOptions = [
  { value: 30, label: "30 minutes after" },
  { value: 60, label: "1 hour after" },
  { value: 75, label: "75 minutes after" },
  { value: 120, label: "2 hours after" },
  { value: 240, label: "4 hours after" }
];
const petCheckOptions = [
  { value: 12, label: "12 hours after" },
  { value: 24, label: "1 day after" },
  { value: 48, label: "2 days after" },
  { value: 72, label: "3 days after" }
];
const callQueueOptions = [
  { value: 24, label: "1 day without a reply" },
  { value: 48, label: "2 days without a reply" },
  { value: 72, label: "3 days without a reply" },
  { value: 96, label: "4 days without a reply" }
];
const clockOptions = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return {
    value,
    label: new Date(2020, 0, 1, hour).toLocaleTimeString("en-US", {
      hour: "numeric"
    })
  };
});

function editableSettings(settings: ClientJourneySettings): EditableSettings {
  return {
    confirmationEmailEnabled: settings.confirmationEmailEnabled,
    reminderEmailHours: settings.reminderEmailHours,
    reminderSmsHours: settings.reminderSmsHours,
    reminderSmsEnabled: settings.reminderSmsEnabled,
    quietHoursStart: settings.quietHoursStart.slice(0, 5),
    quietHoursEnd: settings.quietHoursEnd.slice(0, 5),
    feedbackDelayMinutes: settings.feedbackDelayMinutes,
    petCheckDelayHours: settings.petCheckDelayHours,
    followupCallDelayHours: settings.followupCallDelayHours
  };
}

function channelLabel(channel: string) {
  return channel === "sms" ? "Text" : channel.charAt(0).toUpperCase() + channel.slice(1);
}

function messageLabel(value: string) {
  return value.replaceAll("_", " ");
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function statusVariant(status: string) {
  if (status === "failed") return "destructive" as const;
  if (status === "sent") return "default" as const;
  if (status === "cancelled" || status === "skipped") return "outline" as const;
  return "secondary" as const;
}

function TimingField({
  description,
  disabled = false,
  label,
  onChange,
  options,
  value
}: {
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
  options: Array<{ value: number; label: string }>;
  value: number;
}) {
  return (
    <Field orientation="responsive" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <NativeSelect
        aria-label={label}
        className="w-full @md/field-group:w-44"
        disabled={disabled}
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function AdminNotificationsTab({ session }: { session: AdminSession }) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readStaffClientJourney>> | null>(null);
  const [draft, setDraft] = useState<EditableSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const actor = useMemo<TaskBoardSession>(() => ({
    name: session.name,
    role: "admin",
    passcode: session.passcode
  }), [session.name, session.passcode]);
  const actorQuery = useMemo(() => taskBoardActorQuery(actor), [actor]);

  const load = useCallback(async () => {
    try {
      const nextSnapshot = await readStaffClientJourney(actor, actorQuery);
      setSnapshot(nextSnapshot);
      setDraft(editableSettings(nextSnapshot.settings));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notifications are unavailable.");
    }
  }, [actor, actorQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const hasChanges = Boolean(
    snapshot &&
    draft &&
    JSON.stringify(draft) !== JSON.stringify(editableSettings(snapshot.settings))
  );

  async function save() {
    if (!draft || !hasChanges) return;
    setSaving(true);
    try {
      const result = await saveClientJourneySettings(actor, draft);
      setSnapshot((current) => current ? { ...current, settings: result.settings } : current);
      setDraft(editableSettings(result.settings));
      toast.success("Notification settings saved.");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!snapshot || !draft) {
    return (
      <main className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground">
        <BellRing />
        <p>{error || "Loading notifications…"}</p>
        {error ? <Button variant="outline" onClick={() => void load()}>Try again</Button> : null}
      </main>
    );
  }

  const deliveryLive = snapshot.deliveryMode === "production";
  const preview = [
    {
      title: "Booked",
      detail: draft.confirmationEmailEnabled ? "Confirmation email" : "Confirmation off",
      icon: Mail
    },
    {
      title: "Before the visit",
      detail: draft.reminderSmsEnabled
        ? `Email ${draft.reminderEmailHours}h · text ${draft.reminderSmsHours}h`
        : `Email ${draft.reminderEmailHours}h`,
      icon: Clock3
    },
    {
      title: "After the visit",
      detail: `Feedback ${draft.feedbackDelayMinutes}m · pet check ${draft.petCheckDelayHours}h`,
      icon: MessageSquareText
    }
  ];

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Notifications</h2>
            <p className="text-sm text-muted-foreground">Set timing, channels, and quiet hours.</p>
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
            <AlertDescription>Settings save now. Delivery stays paused until production mode is enabled.</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Message settings</CardTitle>
              <CardDescription>Applies to future client messages.</CardDescription>
              <CardAction>
                <Badge variant={hasChanges ? "secondary" : "outline"}>
                  {hasChanges ? "Unsaved" : "Saved"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Appointment confirmation</FieldTitle>
                    <FieldDescription>Email clients as soon as they book.</FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-label="Appointment confirmation"
                    checked={draft.confirmationEmailEnabled}
                    onCheckedChange={(checked) => setDraft({ ...draft, confirmationEmailEnabled: checked })}
                  />
                </Field>
                <Separator />
                <TimingField
                  label="Preparation email"
                  description="Detailed visit instructions."
                  options={emailReminderOptions}
                  value={draft.reminderEmailHours}
                  onChange={(value) => setDraft({ ...draft, reminderEmailHours: value })}
                />
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Text reminder</FieldTitle>
                    <FieldDescription>Only for clients who consented.</FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-label="Text reminder"
                    checked={draft.reminderSmsEnabled}
                    onCheckedChange={(checked) => setDraft({ ...draft, reminderSmsEnabled: checked })}
                  />
                </Field>
                <TimingField
                  disabled={!draft.reminderSmsEnabled}
                  label="Text timing"
                  description="Short appointment reminder."
                  options={textReminderOptions}
                  value={draft.reminderSmsHours}
                  onChange={(value) => setDraft({ ...draft, reminderSmsHours: value })}
                />
                <Separator />
                <TimingField
                  label="Visit feedback"
                  description="Ask how the visit went."
                  options={feedbackOptions}
                  value={draft.feedbackDelayMinutes}
                  onChange={(value) => setDraft({ ...draft, feedbackDelayMinutes: value })}
                />
                <TimingField
                  label="Pet check"
                  description="Email after positive feedback."
                  options={petCheckOptions}
                  value={draft.petCheckDelayHours}
                  onChange={(value) => setDraft({ ...draft, petCheckDelayHours: value })}
                />
                <TimingField
                  label="Call queue"
                  description="Flag clients who have not replied."
                  options={callQueueOptions}
                  value={draft.followupCallDelayHours}
                  onChange={(value) => setDraft({ ...draft, followupCallDelayHours: value })}
                />
                <Separator />
                <FieldSet>
                  <FieldLegend variant="label">Quiet hours</FieldLegend>
                  <FieldDescription>No automatic texts during this window. Time zone: {snapshot.settings.timeZone}.</FieldDescription>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldTitle>Start</FieldTitle>
                      <NativeSelect
                        aria-label="Quiet hours start"
                        className="w-full"
                        value={draft.quietHoursStart}
                        onChange={(event) => setDraft({ ...draft, quietHoursStart: event.target.value })}
                      >
                        {clockOptions.map((option) => (
                          <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldTitle>End</FieldTitle>
                      <NativeSelect
                        aria-label="Quiet hours end"
                        className="w-full"
                        value={draft.quietHoursEnd}
                        onChange={(event) => setDraft({ ...draft, quietHoursEnd: event.target.value })}
                      >
                        {clockOptions.map((option) => (
                          <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                </FieldSet>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <span aria-live="polite" className="text-xs text-muted-foreground">
                {hasChanges ? "Review and save your changes." : "All changes saved."}
              </span>
              <Button disabled={!hasChanges || saving} onClick={() => void save()}>
                {saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </CardFooter>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Client journey</CardTitle>
                <CardDescription>At a glance.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {preview.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div className="flex flex-col gap-3" key={step.title}>
                      {index ? <Separator /> : null}
                      <div className="flex items-start gap-3">
                        <Icon className="mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{step.title}</p>
                          <p className="text-sm text-muted-foreground">{step.detail}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Safety rules</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>Consent required for texts.</p>
                <p>Changed appointments cancel stale reminders.</p>
                <p>Care updates stay staff-triggered.</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent messages</CardTitle>
            <CardDescription>Latest 6 of {snapshot.items.length}.</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.items.slice(0, 6).map((item, index) => (
                    <TableRow key={`${item.clientId}-${item.messageType}-${item.scheduledFor}-${index}`}>
                      <TableCell className="font-medium">{item.petName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{channelLabel(item.channel)}</Badge>
                          <span className="capitalize">{messageLabel(item.messageType)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{timeLabel(item.scheduledFor)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>
                          {item.status === "sent" ? <CheckCircle2 data-icon="inline-start" /> : null}
                          {item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <Toaster position="top-right" />
    </main>
  );
}
