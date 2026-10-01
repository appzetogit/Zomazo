import { useEffect, useState } from "react"

/*
 * Bank payout (RazorpayX) status and actions for one withdrawal row, shared by
 * the Food, Quick, Shop, Taxi and Services admin screens. Each screen passes
 * its own API calls, because each admin panel has its own API client.
 *
 * Shows nothing until payouts are configured on the server, so without
 * RazorpayX the screens look and work exactly as before (manual mark-as-paid).
 *
 * "Retry" on a failed payout: the failed transfer already returned the money
 * and reopened the request as pending, so retrying is approve-then-pay, with
 * the approval's balance check run again.
 */

const configCache = new Map()

/** Asks the server once per panel whether bank payouts are set up. */
export function useBankPayoutsEnabled(fetchConfig, key) {
  const [enabled, setEnabled] = useState(configCache.get(key) ?? false)
  useEffect(() => {
    if (configCache.has(key)) return
    let alive = true
    fetchConfig()
      .then((res) => {
        const on = Boolean(res?.data?.data?.enabled ?? res?.data?.enabled)
        configCache.set(key, on)
        if (alive) setEnabled(on)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [fetchConfig, key])
  return enabled
}

const LABELS = {
  initiating: "Bank payout started",
  processing: "Bank payout processing",
  processed: "Paid via bank",
  failed: "Bank payout failed",
  reversed: "Bank payout reversed",
}
const TONES = {
  initiating: "bg-blue-50 text-blue-700",
  processing: "bg-blue-50 text-blue-700",
  processed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  reversed: "bg-red-50 text-red-700",
}

const errorText = (err) => err?.response?.data?.message || err?.message || "Request failed"

/**
 * @param payout       the row's `payout` object (may be missing)
 * @param isApproved   the row is approved (Taxi: completed) and so payable
 * @param isPending    the row is pending (a failed payout reopens it)
 * @param manualRef    the row's manual bank reference, if an admin typed one
 * @param pay / refresh / approve  () => Promise, the screen's own API calls
 * @param onChanged    reload the list after an action
 */
export default function BankPayoutCell({ enabled, payout, isApproved, isPending, manualRef, pay, refresh, approve, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const state = payout?.state

  if (!enabled && !state) return null

  const run = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
      onChanged?.()
    }
  }

  const canPay = enabled && isApproved && !manualRef && (!state || state === "failed" || state === "reversed")
  const canRetry = enabled && isPending && (state === "failed" || state === "reversed") && approve
  const canRefresh = enabled && (state === "initiating" || state === "processing")
  const btn = "px-2 py-1 rounded-md text-xs font-semibold border disabled:opacity-50"

  return (
    <div className="flex flex-col items-start gap-1 text-xs">
      {state && (
        <span className={`px-2 py-0.5 rounded-full font-semibold ${TONES[state] || "bg-slate-100 text-slate-700"}`}>
          {LABELS[state] || state}
        </span>
      )}
      {payout?.utr && <span className="text-slate-600">UTR {payout.utr}</span>}
      {(state === "failed" || state === "reversed") && payout?.failureReason && (
        <span className="text-red-600 max-w-[16rem] whitespace-normal">{payout.failureReason}. Money returned to the balance.</span>
      )}
      <div className="flex gap-1">
        {canPay && (
          <button type="button" className={`${btn} border-green-300 text-green-700`} disabled={busy}
            onClick={() => run(pay, "Send this amount to the payee's bank account on file now?")}>
            Pay via bank
          </button>
        )}
        {canRetry && (
          <button type="button" className={`${btn} border-orange-300 text-orange-700`} disabled={busy}
            onClick={() => run(async () => { await approve(); await pay() }, "Approve again and retry the bank payout?")}>
            Retry
          </button>
        )}
        {canRefresh && (
          <button type="button" className={`${btn} border-slate-300 text-slate-700`} disabled={busy} onClick={() => run(refresh)}>
            Refresh status
          </button>
        )}
      </div>
      {error && <span className="text-red-600 max-w-[16rem] whitespace-normal">{error}</span>}
    </div>
  )
}
