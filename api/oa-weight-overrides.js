// ════════════════════════════════════════════════════════════════
// CRUD proxy за xgpro_oa_weight_overrides — тук се пазят приетите
// OA/Модел тегла по пазар, за да важат на всяко устройство (не само
// localStorage на конкретния браузър).
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_oa_weight_overrides";

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
      const r = await oraFetch(`/${TABLE}/?limit=200`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      res.status(200).json({ ok: true, items: r.json?.items || [] });
      return;
    }

    if (req.method === "PUT") {
      const { market_key, weight, sample_n, bss, source, meta_json } = req.body || {};
      if (!market_key || weight == null) { res.status(400).json({ ok: false, error: "missing_market_key_or_weight" }); return; }

      const existing = await oraFetch(`/${TABLE}/${encodeURIComponent(market_key)}`, "GET");
      const payload = { market_key, weight, sample_n: sample_n ?? null, bss: bss ?? null, source: source ?? null, meta_json: meta_json ?? null, updated_at: new Date().toISOString() };

      if (existing.ok && existing.json) {
        const full = { ...existing.json, weight, sample_n: payload.sample_n, bss: payload.bss, source: payload.source, meta_json: payload.meta_json, updated_at: payload.updated_at };
        delete full.links; delete full._links;
        const r = await oraFetch(`/${TABLE}/${encodeURIComponent(market_key)}`, "PUT", full);
        if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
        res.status(200).json({ ok: true, action: "updated" });
        return;
      }

      const r = await oraFetch(`/${TABLE}/`, "POST", payload);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true, action: "created" });
      return;
    }

    if (req.method === "DELETE") {
      const market_key = req.query?.market_key;
      if (!market_key) { res.status(400).json({ ok: false, error: "missing_market_key" }); return; }
      const r = await oraFetch(`/${TABLE}/${encodeURIComponent(market_key)}`, "DELETE");
      res.status(200).json({ ok: r.ok });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
