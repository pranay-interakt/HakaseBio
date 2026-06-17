import { ReactNode } from "react";

export function Section({
  id,
  children,
  className = ""
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`py-20 md:py-28 ${className}`}>
      <div className="container-x">{children}</div>
    </section>
  );
}

export function SectionHeader({
  label,
  title,
  lede,
  align = "left"
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={`max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <div className="accent">{label}</div>
      <h2 className="h2 mt-4">{title}</h2>
      {lede && <p className="lede mt-4">{lede}</p>}
    </div>
  );
}
