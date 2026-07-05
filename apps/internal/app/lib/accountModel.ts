export type AuthRole = "customer" | "veterinarian" | "staff" | "admin";

// Roles an admin can create from the clinic team panel.
export type TeamRole = "veterinarian" | "staff";

export type Account = {
  id: string;
  role: AuthRole;
  name: string;
  email: string;
  phone?: string;
  petName?: string;
  passcode?: string;
  passwordHash: string;
  mustResetPassword?: boolean;
  otp?: string;
  createdAt: string;
};

export type AccountSession = {
  accountId: string;
  role: AuthRole;
  name: string;
  email: string;
  phone?: string;
  petName?: string;
  passcode?: string;
  source: "account"; // discriminator: task-board passcode sessions lack this field
};

export const ACCOUNTS_KEY = "central-vet-accounts";
export const SESSION_KEY = "central-vet-session";

export const DEMO_PASSCODES = {
  admin: "246810",
  veterinarian: "135790"
} as const;

export const DEMO_ACCOUNTS = [
  {
    role: "customer" as const,
    name: "Maya Parker",
    email: "maya@example.com",
    phone: "(415) 555-0134",
    petName: "Biscuit",
    password: "demo1234"
  },
  {
    role: "staff" as const,
    name: "Front Desk",
    email: "staff@centralvet.demo",
    password: "staff1234"
  },
  {
    role: "veterinarian" as const,
    name: "Dr. Shiv",
    email: "vet@centralvet.demo",
    password: "vet1234",
    passcode: DEMO_PASSCODES.veterinarian
  },
  {
    role: "admin" as const,
    name: "Clinic Admin",
    email: "admin@centralvet.demo",
    password: "admin1234",
    passcode: DEMO_PASSCODES.admin
  }
];
