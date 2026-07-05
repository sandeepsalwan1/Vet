"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function AuthPasswordInput({
  value,
  onChange,
  placeholder,
  name,
  autoComplete
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="authPasswordWrap">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? "Password"}
        name={name}
        autoComplete={autoComplete ?? (name === "new-password" ? "new-password" : "current-password")}
      />
      <button
        type="button"
        className="authPasswordToggle"
        onClick={() => setShow((visible) => !visible)}
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
