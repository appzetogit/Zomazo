import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button, Card, Empty, Field, Shell, Spinner, Stat, errorMessage, fmtDate, fmtDateTime, inputClass, inr } from "../../components/partner/ui"
import { workerNav } from "../nav"
import { workerApi } from "../workerApi"

/*
 * The worker's wallet (workerWalletController): `balance` is what they can
 * withdraw, `dues` what they owe the platform from cash jobs. Completed vendor
 * jobs the vendor has not paid out yet are listed so the worker can nudge the
 * vendor (request-payout notifies them).
 */
const CREDITS = ["credit", "earnings_credit", "worker_payment", "refund", "cash_collected"]

export default function Earnings() {
  const [wallet, setWallet] = useState(null)
  const [txns, setTxns] = useState(null)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [form, setForm] = useState({ amount: "", upiId: "", accountHolderName: "", accountNumber: "", ifscCode: "", bankName: "" })
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    const [w, t] = await Promise.allSettled([workerApi.wallet(), workerApi.transactions({ limit: 50 })])
    setWallet(w.status === "fulfilled" ? w.value?.data || {} : {})
    setTxns(t.status === "fulfilled" ? t.value?.data || [] : [])
    if (w.status === "rejected") toast.error(errorMessage(w.reason, "Could not load your wallet"))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const withdraw = async () => {
    const amount = Number(form.amount)
    if (!(amount > 0)) return toast.error("Enter an amount")
    if (amount > (Number(wallet?.balance) || 0)) return toast.error(`You can withdraw up to ${inr(wallet?.balance)}`)
    setBusy("withdraw")
    try {
      const { amount: _a, ...bank } = form
      const hasBank = Object.values(bank).some((v) => String(v).trim())
      await workerApi.withdraw({ amount, ...(hasBank ? { bankDetails: bank } : {}) })
      toast.success("Withdrawal requested")
      setShowWithdraw(false)
      load()
    } catch (error) {
      toast.error(errorMessage(error, "Could not request the withdrawal"))
    } finally {
      setBusy(null)
    }
  }

  const nudge = async (bookingId) => {
    setBusy(bookingId)
    try {
      await workerApi.requestPayout(bookingId)
      toast.success("Payment request sent to the vendor")
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Shell title="Earnings" nav={workerNav()}>
      {!wallet ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Withdrawable" value={inr(wallet.balance)} tone="text-emerald-700" />
            <Stat label="Dues to platform" value={inr(wallet.dues)} tone={wallet.dues > 0 ? "text-rose-600" : "text-slate-900"} />
          </div>
          {wallet.isBlocked && (
            <Card className="border-rose-200 bg-rose-50 text-sm text-rose-700">
              Your cash dues are over the limit, so new cash jobs are paused. Clear your dues with the platform to continue.
            </Card>
          )}
          <Button variant={showWithdraw ? "primary" : "secondary"} className="w-full" onClick={() => setShowWithdraw((v) => !v)}>
            Withdraw
          </Button>
          {showWithdraw && (
            <Card className="space-y-3">
              <Field label="Amount">
                <input className={inputClass} inputMode="decimal" value={form.amount} onChange={set("amount")} />
              </Field>
              <Field label="UPI ID" hint="Or fill in a bank account below. Leave both empty to use your saved details.">
                <input className={inputClass} value={form.upiId} onChange={set("upiId")} />
              </Field>
              <input className={inputClass} placeholder="Account holder name" value={form.accountHolderName} onChange={set("accountHolderName")} />
              <input className={inputClass} placeholder="Account number" inputMode="numeric" value={form.accountNumber} onChange={set("accountNumber")} />
              <div className="grid grid-cols-2 gap-2">
                <input className={`${inputClass} uppercase`} placeholder="IFSC" value={form.ifscCode} onChange={set("ifscCode")} />
                <input className={inputClass} placeholder="Bank name" value={form.bankName} onChange={set("bankName")} />
              </div>
              <Button className="w-full" loading={busy === "withdraw"} onClick={withdraw}>
                Request withdrawal
              </Button>
            </Card>
          )}

          {wallet.pendingBookings?.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Waiting on the vendor</h2>
              {wallet.pendingBookings.map((b) => (
                <Card key={b._id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{b.serviceName || b.bookingNumber}</p>
                    <p className="text-xs text-slate-500">
                      {b.bookingNumber} · {fmtDate(b.completedAt)}
                    </p>
                  </div>
                  <Button variant="secondary" loading={busy === b._id} onClick={() => nudge(b._id)}>
                    Remind
                  </Button>
                </Card>
              ))}
            </section>
          )}
        </>
      )}

      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Transactions</h2>
      {!txns ? (
        <Spinner />
      ) : txns.length ? (
        <Card className="py-1">
          {txns.map((t) => (
            <div key={t._id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.description || String(t.type || "").replace(/_/g, " ")}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(t.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${CREDITS.includes(t.type) ? "text-emerald-700" : "text-rose-600"}`}>{inr(t.amount)}</p>
                {t.status && <p className="text-[11px] capitalize text-slate-500">{t.status}</p>}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="No transactions yet" />
      )}
    </Shell>
  )
}
