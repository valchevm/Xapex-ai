// ════════════════════════════════════════════════════════════════
// CRUD proxy за xgpro_telegram_queue — server-side, за да няма CORS
// проблем (виж publish-fixtures.js за същия pattern).
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_telegram_queue";

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
      const r = await oraFetch(`/${TABLE}/?limit=100&q=` + encodeURIComponent(JSON.stringify({ sent: 0 })));
      const items = r.json?.items || [];
      res.status(200).json({ ok: true, items });
      return;
    }

    if (req.method === "POST") {
      const row = req.body?.row;
      if (!row) { res.status(400).json({ ok: false, error: "missing_row" }); return; }
      const r = await oraFetch(`/${TABLE}/`, "POST", row);
      if (r.ok) res.status(200).json({ ok: true, item: r.json });
      else res.status(r.status).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` });
      return;
    }

    if (req.method === "DELETE") {
      const id = req.query?.id;
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }
      const r = await oraFetch(`/${TABLE}/${id}`, "DELETE");
      res.status(200).json({ ok: r.ok });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
