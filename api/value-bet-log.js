// ════════════════════════════════════════════════════════════════
// CRUD proxy за Value Bet Тракера (xgpro_value_bet_log) — GET листва,
// POST добавя (batch — масив от редове наведнъж), PUT обновява
// played_odds по id. Server-side, за да избегнем директен client→
// Oracle CORS проблем.
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_value_bet_log";

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
      const r = await oraFetch(`/${TABLE}/?limit=500&orderBy=id:desc`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      res.status(200).json({ ok: true, items: r.json?.items || [] });
      return;
    }

    if (req.method === "POST") {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) { res.status(400).json({ ok: false, error: "missing_rows" }); return; }
      let okCount = 0;
      const errors = [];
      for (const row of rows) {
        const payload = {
          home: row.home, away: row.away, league: row.league || "",
          side: row.side, timing: row.timing,
          prob: row.prob, implied_odds: row.implied_odds,
          alert_odds: row.alert_odds, value_pct: row.value_pct,
          kickoff_utc: row.kickoff_utc, bg_date_str: row.bg_date_str, bg_time_str: row.bg_time_str,
          played_odds: row.played_odds != null ? row.played_odds : null,
          played_at: row.played_at || null,
          created_at: new Date().toISOString(),
        };
        const r = await oraFetch(`/${TABLE}/`, "POST", payload);
        if (r.ok) okCount++;
        else errors.push(`${row.home} vs ${row.away}: HTTP ${r.status} ${r.text.slice(0, 150)}`);
      }
      res.status(200).json({ ok: okCount > 0, count: okCount, total: rows.length, errors });
      return;
    }

    if (req.method === "PUT") {
      const { id, played_odds, played_at } = req.body || {};
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }
      const r = await oraFetch(`/${TABLE}/${id}`, "PATCH", { played_odds, played_at });
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
