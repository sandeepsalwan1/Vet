import { mockLabVendor, mockLabVendorShape } from "./agentVocabulary";
import type { MockClinicData } from "./contracts";

export const mockClinicData: MockClinicData = {
  clients: [
    {
      id: "client-maya",
      fullName: "Maya Parker",
      phone: "(415) 555-0134",
      email: "maya@example.com",
      notes: "Prefers text updates."
    },
    {
      id: "client-jane",
      fullName: "Jane Doe",
      phone: "(415) 555-0199",
      email: "jane@example.com"
    },
    {
      id: "client-alice",
      fullName: "Alice Johnson",
      phone: "(415) 555-0177",
      email: "alice@example.com"
    },
    {
      id: "client-john",
      fullName: "John Smith",
      phone: "(415) 555-0144",
      email: "john@example.com"
    }
  ],
  pets: [
    {
      id: "pet-biscuit",
      clientId: "client-maya",
      name: "Biscuit",
      species: "dog",
      breed: "Corgi",
      alerts: "Anxious in lobby."
    },
    {
      id: "pet-buddy",
      clientId: "client-jane",
      name: "Buddy",
      species: "dog",
      breed: "Golden Retriever"
    },
    {
      id: "pet-bella",
      clientId: "client-alice",
      name: "Bella",
      species: "dog",
      breed: "Poodle"
    },
    {
      id: "pet-max",
      clientId: "client-john",
      name: "Max",
      species: "cat"
    }
  ],
  appointments: [
    {
      id: "appt-biscuit-today",
      clientId: "client-maya",
      petId: "pet-biscuit",
      appointmentDate: "today",
      appointmentTime: "14:00",
      appointmentType: "Wellness exam",
      doctor: "Dr. Shiv",
      status: "scheduled",
      waitMinutes: 18,
      roomStatus: "waiting",
      notes: "Client is outside for curbside check-in."
    },
    {
      id: "appt-buddy-today",
      clientId: "client-jane",
      petId: "pet-buddy",
      appointmentDate: "today",
      appointmentTime: "14:30",
      appointmentType: "Annual exam",
      doctor: "Dr. Shiv",
      status: "scheduled",
      waitMinutes: 15,
      roomStatus: "waiting"
    },
    {
      id: "appt-bella-tomorrow",
      clientId: "client-alice",
      petId: "pet-bella",
      appointmentDate: "tomorrow",
      appointmentTime: "11:00",
      appointmentType: "Vaccines",
      doctor: "Dr. Raj",
      status: "scheduled",
      waitMinutes: 0,
      roomStatus: "waiting"
    }
  ],
  slots: [
    {
      id: "slot-vaccine-1",
      slotDate: "next Tuesday",
      slotTime: "09:00",
      doctor: "Dr. Shiv",
      appointmentType: "Vaccines",
      available: true
    },
    {
      id: "slot-vaccine-2",
      slotDate: "next Tuesday",
      slotTime: "10:00",
      doctor: "Dr. Shiv",
      appointmentType: "Vaccines",
      available: true
    },
    {
      id: "slot-wellness-1",
      slotDate: "next Wednesday",
      slotTime: "15:00",
      doctor: "Dr. Raj",
      appointmentType: "Wellness exam",
      available: true
    }
  ],
  followups: [
    {
      id: "followup-max-rabies",
      clientId: "client-john",
      petId: "pet-max",
      followupType: "Rabies booster",
      dueDate: "in 7 days",
      recommendedAction: "Offer booster appointment and confirm vaccine record.",
      status: "open"
    },
    {
      id: "followup-buddy-dental",
      clientId: "client-jane",
      petId: "pet-buddy",
      followupType: "Dental recheck",
      dueDate: "in 14 days",
      recommendedAction: "Ask whether Buddy's appetite and gums have improved.",
      status: "open"
    }
  ],
  invoices: [
    {
      id: "invoice-buddy-250",
      clientId: "client-jane",
      petId: "pet-buddy",
      invoiceNumber: "INV-1028",
      status: "review",
      totalCents: 25000,
      flags: [
        {
          reason: "Medication surcharge is higher than service catalog baseline.",
          severity: "medium"
        }
      ]
    },
    {
      id: "invoice-max-clean",
      clientId: "client-john",
      petId: "pet-max",
      invoiceNumber: "INV-1029",
      status: "paid",
      totalCents: 12000,
      flags: []
    }
  ],
  services: [
    {
      id: "service-annual",
      serviceName: "Annual exam",
      category: "consultation",
      currentPriceCents: 8500
    },
    {
      id: "service-rabies",
      serviceName: "Rabies vaccine",
      category: "prevention",
      currentPriceCents: 3500
    },
    {
      id: "service-dental",
      serviceName: "Dental cleaning",
      category: "dental",
      currentPriceCents: 25000
    }
  ],
  pricingObservations: [
    {
      id: "price-vetsrus-annual",
      source: "sample",
      competitorName: "VetsRUs Clinic",
      serviceName: "Annual exam",
      observedPriceCents: 9500
    },
    {
      id: "price-happypaws-rabies",
      source: "sample",
      competitorName: "Happy Paws Center",
      serviceName: "Rabies vaccine",
      observedPriceCents: 3200
    },
    {
      id: "price-vetsrus-dental",
      source: "sample",
      competitorName: "VetsRUs Clinic",
      serviceName: "Dental cleaning",
      observedPriceCents: 29000
    }
  ],
  messages: [
    {
      id: "message-sick-buddy",
      clientId: "client-jane",
      body: "Buddy is vomiting blood and very lethargic.",
      intentHint: "sick_pet",
      urgency: "high"
    }
  ],
  calls: [
    {
      id: "call-arrival-maya",
      callerName: "Maya Parker",
      callerPhone: "(415) 555-0134",
      transcript: "Hi, I just parked outside with Biscuit for our appointment. Can you check us in?",
      intentHint: "checkin"
    }
  ],
  tasks: [],
  approvals: [],
  reports: [],
  labCatalog: [
    {
      id: "labcat-cbc",
      labVendor: mockLabVendor,
      testCode: "CBC",
      testName: "Complete Blood Count",
      specimenType: "whole_blood",
      turnaroundHours: 24,
      active: true,
      raw: { vendorShape: mockLabVendorShape }
    }
  ],
  labOrders: [
    {
      id: "laborder-otis-cbc",
      labVendor: mockLabVendor,
      externalOrderId: "ANT-MOCK-20260531-001",
      clientId: "client-john",
      petId: "pet-max",
      patientName: "Max",
      orderedBy: "Dr. Lee",
      testCode: "CBC",
      testName: "Complete Blood Count",
      specimenType: "whole_blood",
      orderedAt: "2026-05-31T15:00:00.000Z",
      status: "final",
      raw: { vendorShape: mockLabVendorShape }
    }
  ],
  labResults: [
    {
      id: "labresult-otis-cbc",
      labOrderId: "laborder-otis-cbc",
      labVendor: mockLabVendor,
      externalOrderId: "ANT-MOCK-20260531-001",
      status: "final",
      resultSummary: "Mock CBC finalized with elevated white blood cell count flag. Veterinarian review required before client disclosure.",
      abnormalFlags: [{ analyte: "WBC", flag: "high", severity: "review" }],
      reportUrl: "internal://mock-labs/ANT-MOCK-20260531-001/report",
      raw: { vendorShape: mockLabVendorShape },
      resultedAt: "2026-05-31T15:45:00.000Z"
    }
  ]
};
