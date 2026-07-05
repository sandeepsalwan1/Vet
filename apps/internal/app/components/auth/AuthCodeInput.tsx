"use client";

const authCodeInputStyle = {
  fontFamily: "monospace",
  letterSpacing: "0.1em",
  textTransform: "uppercase"
} as const;

type AuthCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function AuthCodeInput({ value, onChange, placeholder = "A1B2C3D4" }: AuthCodeInputProps) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value.toUpperCase())}
      placeholder={placeholder}
      style={authCodeInputStyle}
      required
    />
  );
}
