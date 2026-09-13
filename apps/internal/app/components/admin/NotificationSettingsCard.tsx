import { Loader2, Save } from "lucide-react";
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
  callQueueOptions,
  clockOptions,
  emailReminderOptions,
  feedbackOptions,
  petCheckOptions,
  textReminderOptions,
  type EditableNotificationSettings
} from "./adminNotificationSettings";

type TimingFieldProps = {
  description: string;
  disabled?: boolean;
  label: string;
  name: string;
  onChange(value: number): void;
  options: ReadonlyArray<{ value: number; label: string }>;
  value: number;
};

function TimingField({
  description,
  disabled = false,
  label,
  name,
  onChange,
  options,
  value
}: TimingFieldProps) {
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
        name={name}
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

export function NotificationSettingsCard({
  draft,
  hasChanges,
  onChange,
  onSave,
  saving,
  timeZone
}: {
  draft: EditableNotificationSettings;
  hasChanges: boolean;
  onChange(patch: Partial<EditableNotificationSettings>): void;
  onSave(): void;
  saving: boolean;
  timeZone: string;
}) {
  return (
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
              onCheckedChange={(checked) => onChange({ confirmationEmailEnabled: checked })}
            />
          </Field>
          <Separator />
          <TimingField
            label="Preparation email"
            name="reminder-email-hours"
            description="Detailed visit instructions."
            options={emailReminderOptions}
            value={draft.reminderEmailHours}
            onChange={(value) => onChange({ reminderEmailHours: value })}
          />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Text reminder</FieldTitle>
              <FieldDescription>Only for clients who consented.</FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Text reminder"
              checked={draft.reminderSmsEnabled}
              onCheckedChange={(checked) => onChange({ reminderSmsEnabled: checked })}
            />
          </Field>
          <TimingField
            disabled={!draft.reminderSmsEnabled}
            label="Text timing"
            name="reminder-sms-hours"
            description="Short appointment reminder."
            options={textReminderOptions}
            value={draft.reminderSmsHours}
            onChange={(value) => onChange({ reminderSmsHours: value })}
          />
          <Separator />
          <TimingField
            label="Visit feedback"
            name="feedback-delay-minutes"
            description="Ask how the visit went."
            options={feedbackOptions}
            value={draft.feedbackDelayMinutes}
            onChange={(value) => onChange({ feedbackDelayMinutes: value })}
          />
          <TimingField
            label="Pet check"
            name="pet-check-delay-hours"
            description="Email after positive feedback."
            options={petCheckOptions}
            value={draft.petCheckDelayHours}
            onChange={(value) => onChange({ petCheckDelayHours: value })}
          />
          <TimingField
            label="Call queue"
            name="followup-call-delay-hours"
            description="Flag clients who have not replied."
            options={callQueueOptions}
            value={draft.followupCallDelayHours}
            onChange={(value) => onChange({ followupCallDelayHours: value })}
          />
          <Separator />
          <FieldSet>
            <FieldLegend variant="label">Quiet hours</FieldLegend>
            <FieldDescription>
              No automatic texts during this window. Time zone: {timeZone}.
            </FieldDescription>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldTitle>Start</FieldTitle>
                <NativeSelect
                  aria-label="Quiet hours start"
                  className="w-full"
                  name="quiet-hours-start"
                  value={draft.quietHoursStart}
                  onChange={(event) => onChange({ quietHoursStart: event.target.value })}
                >
                  {clockOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldTitle>End</FieldTitle>
                <NativeSelect
                  aria-label="Quiet hours end"
                  className="w-full"
                  name="quiet-hours-end"
                  value={draft.quietHoursEnd}
                  onChange={(event) => onChange({ quietHoursEnd: event.target.value })}
                >
                  {clockOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
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
        <Button disabled={!hasChanges || saving} onClick={onSave}>
          {saving
            ? <Loader2 className="animate-spin" data-icon="inline-start" />
            : <Save data-icon="inline-start" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
