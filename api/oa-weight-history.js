// ════════════════════════════════════════════════════════════════
// CRUD proxy за xgpro_oa_weight_history — append-only история на
// промените на OA тегло по пазар (за показване в Настройки: кое
// тегло е било, на какво е станало, кога).
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_oa_weight_history";

async function oraFetch(path, method, body) {
  const url = ORACLE_BASE + path;
  const res = await fetch(url, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { ok: res.ok, status: res.status, text, json };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const marketKey = req.query?.market_key;
      const q = marketKey ? `&q=${encodeURIComponent(JSON.stringify({ market_key: marketKey }))}` : "";
      const r = await oraFetch(`/${TABLE}/?limit=200&orderBy=id:desc${q}`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      res.status(200).json({ ok: true, items: r.json?.items || [] });
      return;
    }

    if (req.method === "POST") {
      const { market_key, old_weight, new_weight, sample_n, bss, source, meta_json } = req.body || {};
      if (!market_key || new_weight == null) { res.status(400).json({ ok: false, error: "missing_fields" }); return; }
      const payload = {
        market_key, old_weight: old_weight != null ? old_weight : null, new_weight,
        sample_n: sample_n ?? null, bss: bss ?? null, source: source ?? null, meta_json: meta_json ?? null,
        changed_at: new Date().toISOString(),
      };
      const r = await oraFetch(`/${TABLE}/`, "POST", payload);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
