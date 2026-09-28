import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Copy, Gift, Loader2, Share2, Users, Wallet } from "lucide-react"
import { quickAPI, errorMessage } from "../api"
import { cx, focusRing, formatMoney, isSignedIn } from "../helpers"

/**
 * Refer & earn. The invite is the platform sign-in carrying the customer's
 * code (/login?ref=CODE): a friend who signs up through it credits the
 * referrer, whichever service they came from. Numbers are the server's.
 */
const inviteLink = (code) => (code ? `${window.location.origin}/login?ref=${encodeURIComponent(code)}` : "")

const STATUS = {
  credited: { label: "Reward credited", cls: "bg-[#E6F4EA] text-wh-success" },
  pending: { label: "Pending", cls: "bg-wh-brand-50 text-wh-brand-ink" },
  rejected: { label: "Not eligible", cls: "bg-[#F0F2F2] text-wh-muted" },
}

export default function ReferEarn() {
  const signedIn = isSignedIn()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!signedIn) return undefined
    let cancelled = false
    quickAPI
      .referrals()
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errorMessage(err, "Your referral details could not be loaded.")))
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-20 text-center">
        <Gift className="mx-auto h-10 w-10 text-wh-brand-ink" aria-hidden="true" />
        <h1 className="mt-4 text-[20px] font-black text-wh-text">Sign in to invite friends</h1>
        <Link to="/login" state={{ from: { pathname: "/quick/refer" } }} className={cx("mt-6 inline-flex h-11 items-center rounded-[10px] bg-wh-brand-ink px-6 text-[14px] font-bold text-white", focusRing)}>Sign in</Link>
      </div>
    )
  }
  if (error) return <p className="px-4 py-16 text-center text-[14px] text-wh-muted">{error}</p>
  if (!data) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-wh-muted" aria-label="Loading" /></div>

  const stats = data.stats || {}
  const friends = Array.isArray(data.invitedFriends) ? data.invitedFriends : []
  const code = String(stats.referralCode || "")
  const link = inviteLink(code)
  const reward = Number(stats.rewardAmount) || 0
  const limit = Number(stats.referralLimit) || 0
  const pitch = reward > 0 ? `Join me on ZOMAZO — sign up with my link and I get ₹${formatMoney(reward)}.` : "Join me on ZOMAZO for food, rides and groceries in minutes."

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Invite link copied")
    } catch {
      toast.error("Copy did not work — press and hold the link to copy it.")
    }
  }
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on ZOMAZO", text: pitch, url: link })
      } catch {
        // Closing the share sheet is not an error.
      }
      return
    }
    copy()
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-3 py-3 lg:px-6">
      <section className="rounded-[12px] bg-wh-brand-ink p-5 text-white">
        <Gift className="h-8 w-8" aria-hidden="true" />
        <h1 className="mt-3 text-[22px] font-black leading-7 tracking-tight">
          {reward > 0 ? `Invite friends, earn ₹${formatMoney(reward)} each` : "Invite your friends"}
        </h1>
        <p className="mt-1 text-[14px] text-white/85">
          {reward > 0
            ? "When a friend signs up with your link, the reward lands in your wallet — spend it on Quick, Food or Rides."
            : "Rewards for invites are paused right now, but your friends can still join with your link."}
          {reward > 0 && limit > 0 ? ` Up to ${limit} friends.` : ""}
        </p>
      </section>

      <section className="rounded-[10px] bg-wh-surface p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-wh-muted">Your invite link</p>
        <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-dashed border-wh-brand-ink bg-wh-brand-50 p-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-wh-text" title={link}>{link || "Not available"}</span>
          <button type="button" onClick={copy} disabled={!link} aria-label="Copy invite link"
            className={cx("rounded-[6px] p-1.5 text-wh-brand-ink hover:bg-white disabled:opacity-40", focusRing)}>
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={share} disabled={!link}
            className={cx("flex h-11 items-center justify-center gap-2 rounded-[10px] bg-wh-brand-ink text-[14px] font-bold text-white disabled:opacity-50", focusRing)}>
            <Share2 className="h-4 w-4" aria-hidden="true" />Share
          </button>
          <a href={link ? `https://wa.me/?text=${encodeURIComponent(`${pitch} ${link}`)}` : undefined} target="_blank" rel="noreferrer"
            className={cx("flex h-11 items-center justify-center rounded-[10px] border border-wh-border text-[14px] font-bold text-wh-text", !link && "pointer-events-none opacity-50", focusRing)}>
            WhatsApp
          </a>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {[
          { icon: Users, label: "Invited", value: Number(stats.totalInvited ?? friends.length) || 0 },
          { icon: Gift, label: "Rewarded", value: Number(stats.creditedCount ?? stats.referralCount) || 0 },
          { icon: Wallet, label: "Earned", value: `₹${formatMoney(stats.totalReferralEarnings)}` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-[10px] bg-wh-surface p-3 text-center">
            <Icon className="mx-auto h-5 w-5 text-wh-brand-ink" aria-hidden="true" />
            <p className="mt-1 text-[18px] font-black text-wh-text">{value}</p>
            <p className="text-[12px] text-wh-muted">{label}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[10px] bg-wh-surface p-4">
        <h2 className="mb-3 text-[16px] font-bold text-wh-text">Friends you invited</h2>
        {friends.length ? (
          <ul className="divide-y divide-wh-border">
            {friends.map((f) => {
              const s = STATUS[f.status] || STATUS.pending
              return (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wh-brand-50 text-[14px] font-black text-wh-brand-ink">{String(f.name || "F").charAt(0)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-wh-text">{f.name}</span>
                    <span className="block text-[12px] text-wh-muted">{[f.phone, f.invitedAt ? new Date(f.invitedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", s.cls)}>
                    {f.status === "credited" && f.earnedAmount ? `+₹${formatMoney(f.earnedAmount)}` : s.label}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[14px] text-wh-muted">No one has joined with your link yet. Share it and they will show up here.</p>
        )}
      </section>

      <section className="rounded-[10px] bg-wh-surface p-4">
        <h2 className="mb-2 text-[16px] font-bold text-wh-text">How it works</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[14px] text-wh-muted">
          <li>Share your link with a friend who is new to ZOMAZO.</li>
          <li>They sign up with their phone number through your link.</li>
          <li>{reward > 0 ? `₹${formatMoney(reward)} is added to your wallet once their account is created.` : "You will see them here once they join."}</li>
        </ol>
      </section>
    </div>
  )
}
