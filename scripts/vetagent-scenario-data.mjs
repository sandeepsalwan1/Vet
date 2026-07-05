function publicBody(runSalt, body) {
  return {
    clientName: body.clientName,
    clientPhone: body.clientPhone,
    petName: body.petName,
    message: body.message || body.request || body.transcript || `Scenario ${runSalt}.`,
    ...body
  };
}

function publicDenied(runSalt, path, request) {
  return {
    label: `public denied ${request.label}`,
    path,
    body: publicBody(runSalt, {
      clientName: "External Visitor",
      clientPhone: "(415) 555-0999",
      petName: "Harbor",
      message: `${request.message} Scenario ${runSalt}.`
    }),
    expect: {
      status: 403,
      errorIncludes: "Internal agent routes require actor credentials.",
      noRunId: true,
      noTraceId: true
    }
  };
}

function queryDenied(path, label) {
  return {
    label: `public denied ${label}`,
    method: "GET",
    path: `${path}?role=admin&name=External%20Visitor`,
    expect: {
      status: 403,
      errorIncludes: "Invalid passcode.",
      noRunId: true,
      noTraceId: true
    }
  };
}

export function scenarioDefinitions({ runSalt, managerActor }) {
  return [
    {
      label: "call transcript to check-in",
      path: "/api/agent/call",
      body: publicBody(runSalt, {
        callerName: "Luis Rivera",
        callerPhone: "(415) 555-0199",
        clientName: "Luis Rivera",
        clientPhone: "(415) 555-0199",
        petName: "Luna",
        transcript: `Hi, this is Luis. I am outside for Luna's appointment and want to check in. Scenario ${runSalt}.`
      }),
      expect: { intent: "checkin", minTools: 3, tools: ["triage_call", "mark_arrived", "get_wait_status"], result: { action: "checked_in" } }
    },
    {
      label: "arrival happy path",
      path: "/api/agent/checkin",
      body: publicBody(runSalt, {
        clientName: "Maya Parker",
        clientPhone: "(415) 555-0134",
        petName: "Biscuit",
        message: `I am outside for my appointment. Scenario ${runSalt}.`
      }),
      expect: { intent: "checkin", minTools: 3, tools: ["start_arrival", "mark_arrived", "get_wait_status"], result: { matched: true, action: "checked_in" } }
    },
    {
      label: "arrival already arrived",
      path: "/api/agent/checkin",
      body: publicBody(runSalt, {
        clientName: "Maya Parker",
        clientPhone: "(415) 555-0134",
        petName: "Biscuit",
        message: `I am still outside checking that Biscuit is already checked in. Scenario ${runSalt}.`
      }),
      expect: { intent: "checkin", minTools: 3, tools: ["start_arrival", "mark_arrived", "get_wait_status"], result: { matched: true, alreadyArrived: true }, noTaskRequired: true }
    },
    {
      label: "arrival no appointment",
      path: "/api/agent/checkin",
      body: publicBody(runSalt, {
        clientName: "Tessa Novel",
        clientPhone: "(415) 555-0191",
        petName: "Moose",
        message: `I am here but I am not sure my appointment exists. Scenario ${runSalt}.`
      }),
      expect: {
        intent: "checkin",
        minTools: 2,
        tools: ["start_arrival", "capture_arrival_exception"],
        result: { matched: false, action: "arrival_exception_captured" },
        noTask: true
      }
    },
    {
      label: "wait complaint",
      path: "/api/agent/checkin",
      body: publicBody(runSalt, {
        clientName: "Avery Johnson",
        clientPhone: "(415) 555-0108",
        petName: "Otis",
        message: `I am outside and have been waiting a long time for Otis. Scenario ${runSalt}.`
      }),
      expect: {
        intent: "checkin",
        minTools: 3,
        tools: ["start_arrival", "mark_arrived", "get_wait_status"],
        workflowEvents: ["wait_concern_dispatched"],
        result: { matched: true, action: "checked_in" },
        noTask: true
      }
    },
    {
      label: "booking happy path",
      path: "/api/agent/booking",
      body: publicBody(runSalt, {
        clientName: "Luis Rivera",
        clientPhone: "(415) 555-0199",
        petName: "Luna",
        appointmentType: "Vaccines",
        message: `Can I book vaccines next week after 3 if anything is open? Scenario ${runSalt}.`
      }),
      expect: { intent: "booking", minTools: 3, tools: ["start_arrival", "list_slots", "book_appointment"], result: { booked: true, action: "appointment_booked" }, resultPresent: ["appointment.id", "confirmationId"] }
    },
    {
      label: "booking ambiguous",
      path: "/api/agent/booking",
      body: publicBody(runSalt, {
        clientName: "Unknown Booker",
        clientPhone: "(415) 555-0188",
        petName: "Pebble",
        appointmentType: "Dental",
        message: `Can I schedule a dental appointment? Scenario ${runSalt}.`
      }),
      expect: {
        intent: "booking",
        minTools: 2,
        tools: ["start_arrival", "capture_booking_request"],
        result: { booked: false, action: "booking_request_captured" },
        noTask: true
      }
    },
    {
      label: "pickup status ready",
      path: "/api/agent/pickup",
      body: publicBody(runSalt, {
        clientName: "Luis Rivera",
        clientPhone: "(415) 555-0199",
        petName: "Luna",
        message: `Is Luna ready for pickup yet? Scenario ${runSalt}.`
      }),
      expect: { intent: "pickup", minTools: 3, tools: ["start_arrival", "get_wait_status", "send_status_update"], result: { ready: true, action: "pickup_ready_confirmed", source: "mock/DB data", "statusUpdate.sent": true } }
    },
    {
      label: "pickup status unknown",
      path: "/api/agent/pickup",
      body: publicBody(runSalt, {
        clientName: "Nora Unknown",
        clientPhone: "(415) 555-0149",
        petName: "Comet",
        message: `Is Comet ready for pickup? Scenario ${runSalt}.`
      }),
      expect: {
        intent: "pickup",
        minTools: 2,
        tools: ["start_arrival", "send_clinic_inbox_message"],
        result: { source: "mock/DB data", action: "clinic_message_sent" },
        noTask: true
      }
    },
    {
      label: "records transfer direct",
      path: "/api/agent/records",
      body: publicBody(runSalt, {
        clientName: "Hannah Kim",
        clientPhone: "(415) 555-0172",
        petName: "Maple",
        destination: "Bayview Animal Clinic",
        message: `Please send Maple's vaccine records to Bayview Animal Clinic. Scenario ${runSalt}.`
      }),
      expect: {
        intent: "records",
        minTools: 3,
        tools: ["prepare_records_packet", "audit_records_transfer", "complete_records_transfer"],
        result: { action: "records_transfer_sent", requiresApproval: false, recordsSentAutomatically: true, "audit.audit.source": "local_records_policy", "transfer.transfer.status": "sent" },
        noTask: true,
        noApproval: true
      }
    },
    {
      label: "internal records review",
      path: "/api/agent/internal",
      body: {
        actor: managerActor(),
        clientName: "Hannah Kim",
        clientPhone: "(415) 555-0172",
        petName: "Maple",
        destination: "Bayview Animal Clinic",
        request: `Prepare Maple's records transfer packet for internal review. Scenario ${runSalt}.`
      },
      expect: {
        intent: "records",
        minTools: 3,
        tools: ["prepare_records_packet", "audit_records_transfer", "complete_records_transfer"],
        messageIncludes: "secure transfer",
        messageExcludes: "approval",
        result: { audience: "internal", action: "records_transfer_sent", requiresApproval: false, recordsSentAutomatically: true, "audit.audit.source": "local_records_policy" },
        noTask: true,
        noApproval: true
      }
    },
    {
      label: "sick-pet emergency",
      path: "/api/agent/external",
      body: publicBody(runSalt, {
        clientName: "Avery Johnson",
        clientPhone: "(415) 555-0108",
        petName: "Otis",
        message: `Otis is coughing blood and breathing harder than usual. Scenario ${runSalt}.`
      }),
      expect: { intent: "sick_pet", minTools: 1, tools: ["dispatch_clinical_triage"], safety: { medicalAdviceGiven: false }, workflowEvents: ["clinical_triage_dispatched"], noTask: true }
    },
    {
      label: "sick-pet non-emergency",
      path: "/api/agent/external",
      body: publicBody(runSalt, {
        clientName: "Hannah Kim",
        clientPhone: "(415) 555-0172",
        petName: "Maple",
        message: `Maple vomited once but is alert. Please have someone call me. Scenario ${runSalt}.`
      }),
      expect: { intent: "sick_pet", minTools: 1, tools: ["dispatch_clinical_triage"], safety: { medicalAdviceGiven: false }, workflowEvents: ["clinical_triage_dispatched"], noTask: true }
    },
    queryDenied("/api/reports/pricing", "pricing reports"),
    publicDenied(runSalt, "/api/agent/pricing", {
      label: "pricing route",
      message: "Show me competitor prices and change the vaccine price"
    }),
    publicDenied(runSalt, "/api/agent/invoice", {
      label: "invoice route",
      message: "Open invoice flags and adjust any invoice problems"
    }),
    publicDenied(runSalt, "/api/agent/internal", {
      label: "lab tools",
      message: "Read abnormal lab results and prepare the client update"
    }),
    queryDenied("/api/agent/memory", "agent memory"),
    publicDenied(runSalt, "/api/agent/email", {
      label: "email route",
      message: "Send the monthly campaign email to all clients"
    }),
    {
      label: "call transcript unknown",
      path: "/api/agent/call",
      body: publicBody(runSalt, {
        callerName: "Taylor Client",
        callerPhone: "(415) 555-0111",
        clientName: "Taylor Client",
        clientPhone: "(415) 555-0111",
        petName: "Nova",
        transcript: `I have a complicated question and need someone at the clinic to call me. Scenario ${runSalt}.`
      }),
      expect: { intent: "call", minTools: 2, tools: ["triage_call", "send_clinic_inbox_message"], resultPresent: ["action.message.messageId"], noTask: true }
    },
    {
      label: "follow-up scan",
      path: "/api/agent/followup",
      body: publicBody(runSalt, {
        clientName: "Maya Parker",
        clientPhone: "(415) 555-0134",
        petName: "Biscuit",
        message: `I got a vaccine reminder and want to know what is due. Scenario ${runSalt}.`
      }),
      expect: { intent: "followup", report: true, minTools: 2, tools: ["find_followup_candidates", "send_followup_outreach"], result: { action: "followup_outreach_sent", "outreach.status": "sent" }, resultPresent: ["candidate.id"], noTask: true }
    },
    {
      label: "daily ops",
      path: "/api/agent/daily-ops",
      body: { actor: managerActor(), request: `What needs attention today? Scenario ${runSalt}.` },
      expect: {
        intent: "daily_ops",
        report: true,
        minTools: 4,
        tools: ["list_tasks", "list_approvals", "find_followup_candidates", "list_reports", "create_daily_ops_report"],
        resultPresent: ["summary.openTasks", "rankedWork.0"]
      }
    },
    {
      label: "invoice review",
      path: "/api/agent/invoice",
      body: { actor: managerActor(), request: `Review invoice flags. Scenario ${runSalt}.` },
      expect: { intent: "invoice", report: true, minTools: 1, tools: ["review_invoice_flags"], safety: { changedInvoices: false }, noTask: true }
    },
    {
      label: "pricing sample",
      path: "/api/agent/pricing",
      body: { actor: managerActor(), live: false, request: `Run pricing review. Scenario ${runSalt}.` },
      expect: {
        intent: "pricing",
        report: true,
        minTools: 3,
        tools: ["list_service_catalog", "run_competitor_scan", "compare_service_prices", "create_price_review_report"],
        safety: { changedPrices: false },
        noTask: true
      }
    },
    {
      label: "pricing live fallback",
      path: "/api/agent/pricing",
      body: { actor: managerActor(), live: true, request: `Run live pricing review if configured. Scenario ${runSalt}.` },
      expect: {
        intent: "pricing",
        report: true,
        minTools: 3,
        tools: ["list_service_catalog", "run_competitor_scan", "compare_service_prices", "create_price_review_report"],
        safety: { changedPrices: false },
        noTask: true
      }
    },
    {
      label: "internal lab-result safe update",
      path: "/api/agent/internal",
      body: { actor: managerActor(), request: `Check final abnormal mock lab results and prepare the safe client update. Scenario ${runSalt}.` },
      expect: {
        intent: "labs",
        minTools: 4,
        tools: ["list_lab_catalog", "lookup_lab_orders", "get_lab_result", "summarize_lab_result", "prepare_lab_client_update"],
        safety: { medicalAdviceGiven: false },
        result: { labVendor: "antech_mock", source: "mock lab data", "clientUpdate.status": "held_for_doctor" },
        noTask: true
      }
    }
  ];
}
