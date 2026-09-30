import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Copy, Gift, Share2 } from "lucide-react"
import { servicesAPI, errorMessage } from "../api"
import { useLoad } from "../hooks"
import { inviteLink } from "@/shared/superapp/services"
import { EmptyState, Skeleton, cx, focusRing, formatMoney, isSignedIn, useRequireLogin } from "../helpers"

/**
 * Refer and earn (/sp/users/referral). The customer's own code and invite link,
 * what a referral pays right now (Master > Referral decides), and -- for a
 * customer new to Services -- a box to enter the code a friend gave them.
 *
 * The code is the customer's one invite code, the same in every service. The
 * link is the platform sign-in marked for Services (/login?ref=CODE&via=services),
 * which credits Services' programme when it creates the friend's account.
 */
export default function Referral() {
  const requireLogin = useRequireLogin()
  const signedIn = isSignedIn()
  useEffect(() => {
    requireLogin()
  }, [requireLogin])

  const summary = useLoad(() => (signedIn ? servicesAPI.referral() : Promise.resolve(null)), [signedIn])
  const [friendCode, setFriendCode] = useState("")
  const [applying, setApplying] = useState(false)

  if (!signedIn) return null
  if (summary.loading && !summary.data) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (summary.error && !summary.data) {
    return (
      <EmptyState
        title="Could not load your referral code"
        text={summary.error}
        action={
          <button type="button" onClick={() => summary.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            Try again
          </button>
        }
      />
    )
  }

  const d = summary.data || {}
  const code = d.code || ""
  const link = inviteLink(code, "services")
  const message = code
    ? `Book trusted home services with me. Join here: ${link} (or enter my code ${code} under Refer and earn).`
    : ""

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error("Could not copy. Select and copy it instead.")
    }
  }

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Home services", text: message, url: link })
        return
      } catch (err) {
        if (err?.name === "AbortError") return
      }
    }
    copy(message, "Invite")
  }

  const apply = async (e) => {
    e.preventDefault()
    const c = friendCode.trim().toUpperCase()
    if (!c) return toast.error("Enter your friend's code.")
    setApplying(true)
    try {
      const res = await servicesAPI.applyReferral(c)
      toast.success(res?.message || "Code applied.")
      setFriendCode("")
      summary.reload(true)
    } catch (err) {
      toast.error(errorMessage(err, "Could not apply that code."))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 pb-16 pt-4">
      <section className="rounded-2xl bg-gradient-to-br from-violet-600 to-violet-800 p-5 text-white shadow-sm">
        <Gift className="h-8 w-8" aria-hidden="true" />
        <h1 className="mt-2 text-xl font-extrabold">Refer and earn</h1>
        <p className="mt-1 text-sm text-violet-100">
          {d.active
            ? `Get ${formatMoney(d.reward)} in your wallet for each friend who joins Services with your code, for up to ${d.limit} friends.`
            : "Referral rewards are paused right now. You can still share your code with friends."}
        </p>
        {d.active ? (
          <p className="mt-3 text-xs font-bold text-violet-100">
            {d.rewarded} of {d.limit} rewards earned
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-extrabold text-gray-900">Your code</h2>
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 rounded-xl border border-dashed border-violet-300 bg-violet-50 px-4 py-3 text-center font-mono text-xl font-extrabold tracking-[0.2em] text-violet-700">
            {code || "Not available"}
          </p>
          <button
            type="button"
            onClick={() => copy(code, "Code")}
            disabled={!code}
            className={cx("rounded-xl border border-gray-200 p-3 text-gray-700 disabled:opacity-50", focusRing)}
            aria-label="Copy code"
          >
            <Copy className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {link ? (
          <button
            type="button"
            onClick={() => copy(link, "Link")}
            className={cx("mt-2 block w-full truncate rounded text-left text-xs text-gray-500 hover:text-gray-700", focusRing)}
            title="Copy invite link"
          >
            {link}
          </button>
        ) : null}
        <button
          type="button"
          onClick={share}
          disabled={!code}
          className={cx("mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-50", focusRing)}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" /> Invite friends
        </button>
        <ol className="mt-4 space-y-1.5 text-xs text-gray-600">
          <li>1. Your friend signs in with the invite link.</li>
          <li>2. They open Services, then Refer and earn, and enter your code before their first booking.</li>
          <li>3. {d.active ? `You get ${formatMoney(d.reward)} in your wallet.` : "When rewards are on, you are paid for it."}</li>
        </ol>
      </section>

      {d.canApplyCode ? (
        <form onSubmit={apply} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-extrabold text-gray-900">Got a code from a friend?</h2>
          <p className="mt-1 text-xs text-gray-600">Enter it before your first booking. It can be used once.</p>
          <div className="mt-3 flex gap-2">
            <label className="flex-1">
              <span className="sr-only">Friend's referral code</span>
              <input
                value={friendCode}
                onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                placeholder="e.g. SP1A2B3C"
                autoCapitalize="characters"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-violet-500"
              />
            </label>
            <button
              type="submit"
              disabled={applying || !friendCode.trim()}
              className={cx("rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50", focusRing)}
            >
              {applying ? "Applying..." : "Apply"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
