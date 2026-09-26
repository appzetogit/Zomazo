import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Bot, Save, KeyRound } from "lucide-react"
import { adminAIAPI } from "@store/api"

const errorMessage = (e, fallback) => e?.response?.data?.message || e?.message || fallback

const FIELDS = [
  { key: "dailyUserMessageCap", label: "Daily messages per user", hint: "Per signed-in user (or visitor IP) per UTC day. 0 = unlimited.", min: 0 },
  { key: "monthlyTokenBudget", label: "Monthly token budget", hint: "For the whole platform. Once used up, the assistant switches itself off until next month. 0 = unlimited.", min: 0 },
  { key: "retentionDays", label: "Keep conversations for (days)", hint: "Older conversations are deleted automatically.", min: 1 },
  { key: "inputCostPer1M", label: "Input cost (USD per 1M tokens)", hint: "Only used for the cost estimate on the usage page.", min: 0, step: "0.01" },
  { key: "outputCostPer1M", label: "Output cost (USD per 1M tokens)", hint: "Only used for the cost estimate on the usage page.", min: 0, step: "0.01" },
]

export default function AiSettings() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminAIAPI.getSettings()
      .then((res) => setForm(res?.data?.data || null))
      .catch((e) => toast.error(errorMessage(e, "Failed to load AI settings")))
  }, [])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        enabled: form.enabled,
        searchLlmFallback: form.searchLlmFallback,
        model: form.model || "",
        systemPromptAddendum: form.systemPromptAddendum || "",
        ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key]) || 0])),
      }
      const res = await adminAIAPI.updateSettings(body)
      setForm(res?.data?.data || form)
      toast.success("AI settings saved")
    } catch (err) {
      toast.error(errorMessage(err, "Could not save AI settings"))
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return <div className="p-6 text-sm text-slate-500">Loading AI settings…</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900">Shopping assistant settings</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Controls the customer assistant and smart search. Changes apply within 30 seconds.</p>

      <div className={`mb-5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${form.apiKeyConfigured ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        <KeyRound className="w-4 h-4" />
        {form.apiKeyConfigured
          ? "A Gemini API key is configured on the server (GEMINI_API_KEY)."
          : "No Gemini API key on the server. The assistant answers from built-in rules only. Set GEMINI_API_KEY in the backend environment."}
      </div>

      <form onSubmit={save} className="space-y-5 bg-white rounded-xl border border-slate-200 p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-slate-800">Assistant enabled</span>
            <span className="block text-xs text-slate-500">When off, customers see a short notice instead of answers.</span>
          </span>
          <input type="checkbox" className="h-5 w-5" checked={Boolean(form.enabled)} onChange={(e) => set("enabled", e.target.checked)} />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-slate-800">Smart search uses the model as a fallback</span>
            <span className="block text-xs text-slate-500">Only when the built-in parser recognises nothing in a query. Answers are cached for an hour.</span>
          </span>
          <input type="checkbox" className="h-5 w-5" checked={Boolean(form.searchLlmFallback)} onChange={(e) => set("searchLlmFallback", e.target.checked)} />
        </label>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1" htmlFor="ai-model">Model</label>
          <input
            id="ai-model"
            value={form.model || ""}
            onChange={(e) => set("model", e.target.value)}
            placeholder={form.effectiveModel || "gemini-2.5-flash"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">Leave blank to use the server default ({form.effectiveModel}).</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1" htmlFor="ai-addendum">Extra instructions for the assistant</label>
          <textarea
            id="ai-addendum"
            rows={4}
            maxLength={2000}
            value={form.systemPromptAddendum || ""}
            onChange={(e) => set("systemPromptAddendum", e.target.value)}
            placeholder="e.g. Mention free returns within 7 days on fashion items."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">{(form.systemPromptAddendum || "").length}/2000. Added after the built-in instructions.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-semibold text-slate-800 mb-1" htmlFor={`ai-${f.key}`}>{f.label}</label>
              <input
                id={`ai-${f.key}`}
                type="number"
                min={f.min}
                step={f.step || "1"}
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">{f.hint}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  )
}
