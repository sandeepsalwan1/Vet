import type { ClientAnalyticsSnapshot } from "@central-vet/db";
import { HeartPulse, Mail, PhoneCall } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { analyticsDateTime } from "./adminAnalyticsModel";

export function AdminRecoveryFollowup({
  followup
}: {
  followup: ClientAnalyticsSnapshot["followup"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery follow-up</CardTitle>
        <CardDescription>
          Email after {followup.emailAfterHours} hours. Call {followup.callAfterEmailHours} hours later only when the client has not answered.
        </CardDescription>
        <CardAction className="flex gap-2">
          <Badge variant="secondary">
            <Mail data-icon="inline-start" />
            {followup.emailsSent} sent
          </Badge>
          <Badge variant={followup.callsDue > 0 ? "destructive" : "outline"}>
            <PhoneCall data-icon="inline-start" />
            {followup.callsDue} calls due
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {followup.items.length === 0 ? (
          <Alert>
            <HeartPulse />
            <AlertTitle>No unanswered recovery emails need a call</AlertTitle>
            <AlertDescription>
              {followup.awaitingResponse} sent emails are still inside the response window.
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
              {followup.items.map((item) => (
                <TableRow key={`${item.clientId}-${item.appointmentId ?? item.callDueAt}`}>
                  <TableCell className="font-medium">{item.clientName}</TableCell>
                  <TableCell>{item.petName}</TableCell>
                  <TableCell>{analyticsDateTime(item.emailSentAt)}</TableCell>
                  <TableCell>{analyticsDateTime(item.callDueAt)}</TableCell>
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
  );
}
