"use client";

import { ArrowRight, PawPrint, ShieldCheck, Stethoscope } from "lucide-react";
import { useState } from "react";
import type { AccountSession } from "../../lib/accountStore";
import { useClinicBrand } from "../ClinicContext";
import { CustomerLogin, CustomerSignup } from "./CustomerAuthForms";
import { StaffPortal } from "./StaffAuthForms";

export type Audience = "customer" | "staff";

type Props = {
  audience: Audience;
  onAuth: (session: AccountSession) => void;
  onOpenPasscodeBoard: () => void;
};

type CustomerView = "login" | "signup";

const COPY = {
  customer: {
    Icon: PawPrint,
    sub: "Pet Portal",
    title: ["Care that", "goes further"],
    tagline: "Book visits, refills, and records — one simple place for you and your pet.",
    features: ["Book a visit anytime", "Refills in a tap", "Records always on hand"],
    crossHref: "/staff",
    crossLabel: "Clinic staff sign in"
  },
  staff: {
    Icon: Stethoscope,
    sub: "Team Portal",
    title: ["Your whole", "day, one place"],
    tagline: "Tasks, approvals, and your AI assistant — one calm clinic dashboard.",
    features: ["One shared task board", "AI ops assistant", "Approvals at a glance"],
    crossHref: "/",
    crossLabel: "Pet owner sign in"
  }
} as const;

export function AuthScreen({ audience, onAuth, onOpenPasscodeBoard }: Props) {
  const [customerView, setCustomerView] = useState<CustomerView>("login");
  const clinic = useClinicBrand();
  const copy = COPY[audience];
  const { Icon } = copy;

  return (
    <div className="authShell">
      <div className="authBrandPanel">
        <div className="authBrandContent">
          <div className="authBrandHeader">
            <div className="authBrandLogo">
              <Icon size={24} strokeWidth={2.5} />
            </div>
            <div className="authBrandWordmark">
              <span className="authBrandWordmarkName">{clinic.shortName}</span>
              <span className="authBrandWordmarkSub">{copy.sub}</span>
            </div>
          </div>
          <h1 className="authBrandTitle">
            {copy.title[0]}<br />{copy.title[1]}
          </h1>
          <p className="authBrandTagline">{copy.tagline}</p>
          <div className="authBrandFeatures">
            {copy.features.map((feature) => (
              <div className="authBrandFeature" key={feature}>
                <span className="authBrandFeatureDot" />
                {feature}
              </div>
            ))}
          </div>
        </div>
        <div className="authBrandFooter">
          <span className="authBrandFooterMark">
            <ShieldCheck size={14} strokeWidth={2.2} />
          </span>
          Private and secure. Your information stays protected.
        </div>
      </div>

      <div className="authFormPanel">
        <div className="authCard">
          {audience === "customer" ? (
            customerView === "login" ? (
              <CustomerLogin onAuth={onAuth} onSwitch={() => setCustomerView("signup")} />
            ) : (
              <CustomerSignup onAuth={onAuth} onSwitch={() => setCustomerView("login")} />
            )
          ) : (
            <StaffPortal onAuth={onAuth} onOpenPasscodeBoard={onOpenPasscodeBoard} />
          )}
        </div>
        <a className="authCrossLink" href={copy.crossHref}>
          {copy.crossLabel}
          <ArrowRight size={15} strokeWidth={2.2} />
        </a>
      </div>
    </div>
  );
}
