import type { PublicAgentWorkflow } from "../lib/agentClient";

export type PublicAgentFlowConfig = {
  title: string;
  prompt: string;
  placeholder: string;
  buttonLabel: string;
  transcript?: boolean;
  destination?: boolean;
};

export const publicAgentFlowConfigs: Record<PublicAgentWorkflow, PublicAgentFlowConfig> = {
  booking: {
    title: "Book Appointment",
    prompt: "Booking request",
    placeholder: "Can I book vaccines next week after 3?",
    buttonLabel: "Find Slots"
  },
  call: {
    title: "Call Intake",
    prompt: "Call transcript",
    placeholder: "Hi, this is Maya. I am outside for Biscuit's appointment and wanted to check in.",
    buttonLabel: "Create Task",
    transcript: true
  },
  followup: {
    title: "Follow-Up",
    prompt: "Follow-up response",
    placeholder: "Yes, I want to book the vaccine appointment.",
    buttonLabel: "Send Response"
  },
  pickup: {
    title: "Pickup Status",
    prompt: "Pickup request",
    placeholder: "Is Luna ready for pickup?",
    buttonLabel: "Check Status"
  },
  records: {
    title: "Records Transfer",
    prompt: "Records request",
    placeholder: "Please send Maple's vaccine records to Bayview Animal Clinic.",
    buttonLabel: "Request Records",
    destination: true
  }
};
