import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button, Card, Empty, Field, Shell, Spinner, Stat, Tabs, errorMessage, fmtDateTime, inputClass, inr } from "../../components/partner/ui"
import { vendorNav } from "../nav"
import { vendorApi } from "../vendorApi"

/*
 * The vendor's money, as vendorWalletController keeps it. Two balances run in
 * opposite directions:
 *   - earnings: what the platform owes the vendor for online-paid jobs; the vendor
 *     withdraws it (POST /vendors/withdraw, approved by an admin);
 *   - dues: the platform's share of cash the vendor collected by hand; the vendor
 *     settles it (POST /vendors/wallet/settlement, also admin-approved).
 */
const PAY_METHODS = [
  ["upi", "UPI"],
  ["bank_transfer", "Bank transfer"],
  ["cash", "Cash"],
  ["other", "Other"],
]

function WithdrawForm({ max, onDone }) {
  const [f, setF] = useState({ amount: "", accountHolderName: "", accountNumber: "", ifscCode: "", bankName: "", upiId: "" })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const amount = Number(f.amount)
    if (!(amount >= 1)) return toast.error("Enter an amount")
    if (amount > max) return toast.error(`You can withdraw up to ${inr(max)}`)
    if (!f.upiId.trim() && !(f.accountNumber.trim() && f.ifscCode.trim())) return toast.error("Add a UPI ID or bank account and IFSC")
    setBusy(true)
    try {
      const { amount: _a, ...bankDetails } = f
      await vendorApi.withdraw({ amount, bankDetails })
      toast.success("Withdrawal requested")
      onDone()
    } catch (error) {
      toast.error(errorMessage(error, "Could not request the withdrawal"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <Field label="Amount" hint={`Available ${inr(max)}`}>
        <input className={inputClass} inputMode="decimal" value={f.amount} onChange={set("amount")} />
      </Field>
      <Field label="UPI ID">
        <input className={inputClass} value={f.upiId} onChange={set("upiId")} placeholder="name@bank" />
      </Field>
      <p className="text-center text-xs text-slate-400">or bank account</p>
      <input className={inputClass} placeholder="Account holder name" value={f.accountHolderName} onChange={set("accountHolderName")} />
      <input className={inputClass} placeholder="Account number" inputMode="numeric" value={f.accountNumber} onChange={set("accountNumber")} />
      <div className="grid grid-cols-2 gap-2">
        <input className={`${inputClass} uppercase`} placeholder="IFSC" value={f.ifscCode} onChange={set("ifscCode")} />
        <input className={inputClass} placeholder="Bank name" value={f.bankName} onChange={set("bankName")} />
      </div>
      <Button className="w-full" loading={busy} onClick={submit}>
        Request withdrawal
      </Button>
    </Card>
  )
}

function SettleForm({ dues, onDone }) {
  const [f, setF] = useState({ amount: dues ? String(dues) : "", paymentMethod: "upi", paymentReference: "", notes: "" })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const amount = Number(f.amount)
    if (!(amount >= 1)) return toast.error("Enter an amount")
    setBusy(true)
    try {
      await vendorApi.requestSettlement({ ...f, amount })
      toast.success("Settlement submitted for approval")
      onDone()
    } catch (error) {
      toast.error(errorMessage(error, "Could not submit the settlement"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <p className="text-sm text-slate-600">Pay the platform's share of cash you collected, then record it here with the payment reference.</p>
      <Field label="Amount paid">
        <input className={inputClass} inputMode="decimal" value={f.amount} onChange={set("amount")} />
      </Field>
      <Field label="Paid by">
        <select className={inputClass} value={f.paymentMethod} onChange={set("paymentMethod")}>
          {PAY_METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reference / UTR">
        <input className={inputClass} value={f.paymentReference} onChange={set("paymentReference")} />
      </Field>
      <Field label="Note">
        <input className={inputClass} value={f.notes} onChange={set("notes")} />
      </Field>
      <Button className="w-full" loading={busy} onClick={submit}>
        Submit settlement
      </Button>
    </Card>
  )
}

const Row = ({ title, sub, amount, status, negative }) => (
  <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{title}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
    <div className="text-right">
      <p className={`text-sm font-bold ${negative ? "text-rose-600" : "text-emerald-700"}`}>{inr(amount)}</p>
      {status && <p className="text-[11px] capitalize text-slate-500">{status}</p>}
    </div>
  </div>
)

const DEBITS = ["debit", "withdrawal", "commission", "tds_deduction", "platform_fee", "penalty", "worker_payment"]

export default function Wallet() {
  const [wallet, setWallet] = useState(null)
  const [tab, setTab] = useState("history")
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)

  const loadWallet = useCallback(() => {
    vendorApi
      .wallet()
      .then((res) => setWallet(res?.data || {}))
      .catch((error) => {
        setWallet({})
        toast.error(errorMessage(error, "Could not load the wallet"))
      })
  }, [])

  const loadList = useCallback(async () => {
    setList(null)
    try {
      const res =
        tab === "history" ? await vendorApi.transactions({ limit: 50 }) : tab === "settlements" ? await vendorApi.settlements() : await vendorApi.withdrawals()
      setList(res?.data || [])
    } catch {
      setList([])
    }
  }, [tab])

  useEffect(() => {
    loadWallet()
  }, [loadWallet])
  useEffect(() => {
    loadList()
  }, [loadList])

  const done = () => {
    setForm(null)
    loadWallet()
    loadList()
  }

  return (
    <Shell title="Wallet" nav={vendorNav()}>
      {!wallet ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Earnings (withdrawable)" value={inr(wallet.earnings)} tone="text-emerald-700" />
            <Stat label="Dues to platform" value={inr(wallet.dues)} tone={wallet.dues > 0 ? "text-rose-600" : "text-slate-900"} />
            <Stat label="Cash collected" value={inr(wallet.totalCashCollected)} />
            <Stat label="Withdrawn" value={inr(wallet.totalWithdrawn)} />
          </div>
          {wallet.cashLimit != null && <p className="text-xs text-slate-500">Cash limit: {typeof wallet.cashLimit === "number" ? inr(wallet.cashLimit) : String(wallet.cashLimit)}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant={form === "withdraw" ? "primary" : "secondary"} onClick={() => setForm(form === "withdraw" ? null : "withdraw")}>
              Withdraw
            </Button>
            <Button variant={form === "settle" ? "primary" : "secondary"} onClick={() => setForm(form === "settle" ? null : "settle")}>
              Settle dues
            </Button>
          </div>
          {form === "withdraw" && <WithdrawForm max={Number(wallet.earnings) || 0} onDone={done} />}
          {form === "settle" && <SettleForm dues={Number(wallet.dues) || 0} onDone={done} />}
        </>
      )}

      <Tabs
        tabs={[
          { value: "history", label: "Transactions" },
          { value: "settlements", label: "Settlements" },
          { value: "withdrawals", label: "Withdrawals" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {!list ? (
        <Spinner />
      ) : !list.length ? (
        <Empty title="Nothing here yet" />
      ) : (
        <Card className="py-1">
          {list.map((t) => (
            <Row
              key={t._id}
              title={tab === "history" ? t.description || String(t.type || "").replace(/_/g, " ") : tab === "settlements" ? `Settlement · ${t.paymentMethod || ""}` : "Withdrawal"}
              sub={fmtDateTime(t.createdAt)}
              amount={t.amount}
              status={t.status}
              negative={tab === "history" ? DEBITS.includes(t.type) : tab === "withdrawals"}
            />
          ))}
        </Card>
      )}
    </Shell>
  )
}
