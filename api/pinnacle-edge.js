// ════════════════════════════════════════════════════════════════
// CRUD proxy за Pinnacle Edge (xgpro_pinnacle_edge) — GET листва,
// POST добавя (batch — масив от редове наведнъж), PUT обновява
// финалния резултат по id, DELETE трие ред. Server-side, за да
// избегнем директен client→Oracle CORS проблем. Следва ТОЧНО
// същия pattern като /api/value-bet-log.js.
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_pinnacle_edge";

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
      const r = await oraFetch(`/${TABLE}/?limit=500&orderBy=created_at:desc`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      res.status(200).json({ ok: true, items: r.json?.items || [] });
      return;
    }

    if (req.method === "POST") {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) { res.status(400).json({ ok: false, error: "missing_rows" }); return; }

      let count = 0;
      const errors = [];
      for (const row of rows) {
        const payload = {
          setting: row.setting || null,
          home: row.home || null,
          away: row.away || null,
          league: row.league || "",
          market: row.market || null,
          market_side: row.market_side || null,
          market_line: row.market_line != null ? row.market_line : null,
          market_label: row.market_label || null,
          fair_price: row.fair_price != null ? row.fair_price : null,
          bet365_odds: row.bet365_odds != null ? row.bet365_odds : null,
          edge_pct: row.edge_pct != null ? row.edge_pct : null,
          implied_prob: row.implied_prob != null ? row.implied_prob : null,
          kickoff_txt: row.kickoff_txt || null,
          kickoff_date_iso: row.kickoff_date_iso || null,
          final_score_home: null,
          final_score_away: null,
          created_at: new Date().toISOString(),
        };
        const r = await oraFetch(`/${TABLE}/`, "POST", payload);
        if (r.ok) count++;
        else errors.push(`${row.home} vs ${row.away}: HTTP ${r.status} ${r.text.slice(0, 150)}`);
      }
      res.status(200).json({ ok: count > 0, count, total: rows.length, errors });
      return;
    }

    if (req.method === "PUT") {
      const { id, final_score_home, final_score_away } = req.body || {};
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }

      // ✅ ORDS връща HTTP 405 на PATCH за тези таблици — GET + пълен
      // PUT вместо частичен PATCH (същия pattern като value-bet-log).
      const existing = await oraFetch(`/${TABLE}/${id}`, "GET");
      if (!existing.ok || !existing.json) {
        res.status(200).json({ ok: false, error: `Не намерих запис ${id}: HTTP ${existing.status}` });
        return;
      }
      const full = { ...existing.json };
      delete full.links; delete full._links;
      full.final_score_home = final_score_home != null ? final_score_home : null;
      full.final_score_away = final_score_away != null ? final_score_away : null;

      const r = await oraFetch(`/${TABLE}/${id}`, "PUT", full);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      if (!id) { res.status(400).json({ ok: false, error: "missing_id" }); return; }
      const r = await oraFetch(`/${TABLE}/${id}`, "DELETE");
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
