"use client";

import { BellRing, Save } from "lucide-react";
import { useState } from "react";
import {
  SaveCelebration,
  useSaveCelebration
} from "../../components/admin/SaveCelebration";
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
import { Switch } from "@/components/ui/switch";

export function ProofNotificationSaveView() {
  const [confirmationEnabled, setConfirmationEnabled] = useState(true);
  const [saved, setSaved] = useState(true);
  const saveCelebration = useSaveCelebration();

  function changeConfirmation(value: boolean) {
    setConfirmationEnabled(value);
    setSaved(false);
  }

  function saveSettings() {
    if (saved) return;
    setSaved(true);
    saveCelebration.celebrate();
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-background p-6 pt-20">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="text-muted-foreground" />
            Notification settings
          </CardTitle>
          <CardDescription>
            Choose which updates clients receive.
          </CardDescription>
          <CardAction>
            <Badge variant={saved ? "outline" : "secondary"}>
              {saved ? "Saved" : "Unsaved"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div>
              <p className="font-medium">Appointment confirmation</p>
              <p className="text-sm text-muted-foreground">
                Email clients as soon as they book.
              </p>
            </div>
            <Switch
              aria-label="Appointment confirmation"
              checked={confirmationEnabled}
              data-agent-proof="notification-toggle"
              onCheckedChange={changeConfirmation}
            />
          </div>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {saved ? "All changes saved." : "Review and save your changes."}
          </span>
          <Button
            data-agent-proof="save-settings"
            disabled={saved}
            onClick={saveSettings}
          >
            <Save data-icon="inline-start" />
            Save changes
          </Button>
        </CardFooter>
      </Card>
      <SaveCelebration
        animationKey={saveCelebration.animationKey}
        visible={saveCelebration.visible}
      />
    </main>
  );
}
