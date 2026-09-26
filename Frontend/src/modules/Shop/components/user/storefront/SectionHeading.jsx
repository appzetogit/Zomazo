/**
 * A section's heading, in the reference's style (MOBILE_UI_SPEC.md): centred
 * serif display type wrapped in em dashes, a one-line subtitle, then a short
 * brand-coloured divider.
 */
export default function SectionHeading({ title, subtitle, align = "center", action = null }) {
  const centred = align === "center"

  return (
    <div className={`mb-4 sm:mb-6 ${centred ? "text-center" : "flex items-end justify-between gap-3"}`}>
      <div className={centred ? "" : "min-w-0"}>
        <h2 className="font-display text-[24px] font-semibold leading-tight text-wh-text sm:text-[30px] lg:text-[34px]">
          {centred ? <>&mdash; {title} &mdash;</> : title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[12px] text-wh-muted sm:text-[14px]">{subtitle}</p>
        ) : null}
        {centred ? (
          <span
            aria-hidden="true"
            className="mx-auto mt-3 block h-[3px] w-14 rounded-full bg-wh-brand"
          />
        ) : null}
      </div>
      {!centred && action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
