import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-pen text-white hover:bg-pen-dark",
  secondary: "border border-line bg-white text-ink hover:border-pen",
  quiet: "px-0 text-pen hover:underline",
};

/** Class string so <Link> can look like a button too. */
export const buttonClass = (variant: Variant = "primary") => `${base} ${variants[variant]}`;

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${buttonClass(variant)} ${className}`} {...props} />;
}
