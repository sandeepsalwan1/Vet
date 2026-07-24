import assert from "node:assert/strict";
import test from "node:test";
import {
  planAppointmentMessages,
  planPetCheckMessage,
  planStaffUpdateMessage,
  planWelcomeMessages
} from "./clientJourney";
import type {
  ClientContactPreferences,
  ClientJourneyAppointment,
  ClientJourneyProfile,
  ClientJourneySettings
} from "@central-vet/db";
import { smsDestinationFor } from "./notificationDelivery";

const settings: ClientJourneySettings = {
  clinicId: "clinic",
  timeZone: "America/Los_Angeles",
  publicName: "Tri-City Veterinary Hospital",
  familyStory: "Family-run since 1986, with three generations serving local pets and their people.",
  primaryDomain: "tricityvet.eepish.com",
  pimsProvider: "mock-clinic",
  pimsMode: "adapter",
  confirmationEmailEnabled: true,
  reminderEmailHours: 48,
  reminderSmsHours: 24,
  reminderSmsEnabled: true,
  quietHoursStart: "20:00:00",
  quietHoursEnd: "08:00:00",
  feedbackDelayMinutes: 75,
  petCheckDelayHours: 24,
  followupCallDelayHours: 48,
  roomPressureNumerator: 2,
  roomPressureDenominator: 3
};

const profile: ClientJourneyProfile = {
  clientId: "client",
  clientName: "Maya Parker",
  email: "maya@example.com",
  phone: "5551234567",
  petId: "pet",
  petName: "Biscuit",
  species: "Dog",
  breed: "Mixed"
};

const preferences: ClientContactPreferences = {
  email: profile.email,
  phone: profile.phone,
  emailEnabled: true,
  smsConsent: true,
  preferredChannel: "both"
};

const appointment: ClientJourneyAppointment = {
  id: "appointment",
  appointmentDate: "2030-02-05",
  appointmentTime: "10:30:00",
  appointmentType: "Exam",
  doctor: "Dr. Chen",
  status: "scheduled",
  roomStatus: "waiting"
};

test("welcome includes clinic story, three-step visit flow, and transfer-record preparation", () => {
  const [message] = planWelcomeMessages({ settings, profile });
  assert.match(message.body, /since 1986/);
  assert.match(message.body, /1\. Check in/);
  assert.match(message.body, /2\. A veterinary assistant/);
  assert.match(message.body, /3\. Another assistant/);
  assert.match(message.body, /prior medical and vaccine records/);
});

test("appointment plans detailed email plus consented 24-hour SMS", () => {
  const plans = planAppointmentMessages({ settings, profile, preferences, appointment });
  assert.deepEqual(plans.map((plan) => plan.messageType), [
    "appointment_confirmation",
    "appointment_preparation",
    "appointment_reminder"
  ]);
  assert.equal(plans[2].channel, "sms");
  assert.equal(plans[1].scheduledFor, "2030-02-03T18:30:00.000Z");
  assert.equal(plans[2].scheduledFor, "2030-02-04T18:30:00.000Z");
  assert.match(plans[2].body, /Reply STOP/);
});

test("appointment reminders move out of clinic-local quiet hours", () => {
  const [,, reminder] = planAppointmentMessages({
    settings,
    profile,
    preferences,
    appointment: { ...appointment, appointmentTime: "02:30:00" }
  });
  assert.equal(reminder.scheduledFor, "2030-02-04T03:59:00.000Z");
});

test("appointment SMS requires current consent and cancelled visits schedule nothing", () => {
  const emailOnly = planAppointmentMessages({
    settings,
    profile,
    preferences: { ...preferences, smsConsent: false },
    appointment
  });
  assert.equal(emailOnly.some((plan) => plan.channel === "sms"), false);
  assert.deepEqual(planAppointmentMessages({
    settings,
    profile,
    preferences,
    appointment: { ...appointment, status: "cancelled" }
  }), []);
  assert.deepEqual(planAppointmentMessages({
    settings,
    profile,
    preferences,
    appointment: { ...appointment, status: "completed" }
  }), []);
  assert.deepEqual(planAppointmentMessages({
    settings,
    profile,
    preferences,
    appointment: { ...appointment, appointmentDate: "2020-02-05" }
  }), []);
});

test("checkout separates discharge from delayed experience feedback", () => {
  const discharge = planStaffUpdateMessage({
    settings,
    profile,
    preferences,
    appointmentId: appointment.id,
    updateType: "discharge"
  });
  const feedback = planStaffUpdateMessage({
    settings,
    profile,
    preferences,
    appointmentId: appointment.id,
    updateType: "checkout"
  });
  assert.equal(discharge[0].channel, "email");
  assert.equal(feedback[0].messageType, "visit_experience");
  const delay = new Date(feedback[0].scheduledFor).getTime() - Date.now();
  assert.ok(delay > 74 * 60_000 && delay <= 75 * 60_000);
});

test("next-day pet check contains urgent-care guidance", () => {
  const [message] = planPetCheckMessage({
    settings,
    profile,
    preferences,
    appointmentId: appointment.id
  });
  assert.equal(message.messageType, "pet_health_check");
  assert.equal(message.channel, "email");
  assert.match(message.body, /seek emergency veterinary care now/);
});

test("pet check uses a saved preference email and skips unavailable channels", () => {
  const [emailMessage] = planPetCheckMessage({
    settings,
    profile: { ...profile, email: null },
    preferences: {
      ...preferences,
      email: "updated@example.com",
      phone: null,
      smsConsent: false
    },
    appointmentId: appointment.id
  });
  assert.equal(emailMessage.channel, "email");

  assert.deepEqual(planPetCheckMessage({
    settings,
    profile: { ...profile, email: null, phone: "" },
    preferences: {
      ...preferences,
      email: null,
      phone: null,
      emailEnabled: false,
      smsConsent: false
    },
    appointmentId: appointment.id
  }), []);
});

test("SMS destinations use carrier-independent E.164 numbers", () => {
  assert.equal(smsDestinationFor("(555) 123-4567"), "+15551234567");
  assert.equal(smsDestinationFor("5551234567@attacker.example"), "");
});
