"use client";

interface IFrameBrandingProps {
  size?: "sm" | "md";
  showSlogan?: boolean;
}

export default function IFrameBranding({ size = "md", showSlogan = true }: IFrameBrandingProps) {
  return (
    <div>
      <div className="flex gap-3 items-center">
        <img src="/iframe-logo.png" alt="iFrame" className={`${size === "sm" ? "w-9 h-9" : "w-14 h-14"} object-contain`} />
        <div className="flex flex-col justify-center">
          <span className={`font-mono ${size === "sm" ? "text-lg" : "text-xl"} font-bold tracking-tight text-foreground`}>iFrame</span>
          {size !== "sm" && <span className="font-mono text-[0.6875rem] text-text-muted tracking-[0.2em] uppercase -mt-0.5">Studio</span>}
        </div>
      </div>
      {showSlogan && <p className="font-mono text-[0.5rem] text-text-muted text-center mt-2.5">Powered by Lumenx &amp; Uniart</p>}
    </div>
  );
}
