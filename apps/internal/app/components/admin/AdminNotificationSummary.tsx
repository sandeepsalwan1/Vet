import type { StaffClientJourneySnapshot } from "@central-vet/db";
import {
  CheckCircle2,
  Clock3,
  Mail,
  MessageSquareText
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { EditableNotificationSettings } from "./adminNotificationSettings";

function channelLabel(channel: string) {
  return channel === "sms"
    ? "Text"
    : channel.charAt(0).toUpperCase() + channel.slice(1);
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

export function AdminNotificationOverview({
  draft
}: {
  draft: EditableNotificationSettings;
}) {
  const preview = [
    {
      title: "Booked",
      detail: draft.confirmationEmailEnabled
        ? "Confirmation email"
        : "Confirmation off",
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
  );
}

export function AdminRecentMessages({
  items
}: {
  items: StaffClientJourneySnapshot["items"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent messages</CardTitle>
        <CardDescription>Latest 6 of {items.length}.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No messages yet.
          </p>
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
              {items.slice(0, 6).map((item, index) => (
                <TableRow
                  key={`${item.clientId}-${item.messageType}-${item.scheduledFor}-${index}`}
                >
                  <TableCell className="font-medium">{item.petName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{channelLabel(item.channel)}</Badge>
                      <span className="capitalize">{messageLabel(item.messageType)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeLabel(item.scheduledFor)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.status)}>
                      {item.status === "sent"
                        ? <CheckCircle2 data-icon="inline-start" />
                        : null}
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
  );
}
