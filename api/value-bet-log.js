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

function normKey(row) {
  return (row.home||'').trim().toLowerCase() + '|' + (row.away||'').trim().toLowerCase() +
    '|' + (row.kickoff_utc||'').slice(0,16) + '|' + (row.side||'').toLowerCase();
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const r = await oraFetch(`/${TABLE}/?limit=500&orderBy=id:desc`, "GET");
      if (!r.ok) { res.status(200).json({ ok: true, items: [] }); return; }
      const items = (r.json?.items || []).map((it) => {
        let obs = [];
        try { obs = it.observations ? JSON.parse(it.observations) : []; } catch (e) {}
        return { ...it, observations: obs };
      });
      res.status(200).json({ ok: true, items });
      return;
    }

    if (req.method === "POST") {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) { res.status(400).json({ ok: false, error: "missing_rows" }); return; }

      // ── Тегли текущия лог веднъж, за да разпознаваме дублирани мачове ──
      const existingResp = await oraFetch(`/${TABLE}/?limit=500`, "GET");
      const existingItems = existingResp.json?.items || [];
      const existingByKey = {};
      existingItems.forEach((it) => { existingByKey[normKey(it)] = it; });

      let created = 0, appended = 0;
      const errors = [];

      for (const row of rows) {
        const key = normKey(row);
        const newObs = {
          odds: row.alert_odds, prob: row.prob, peak_prob: row.peak_prob != null ? row.peak_prob : null,
          value_pct: row.value_pct, timing: row.timing, observed_at: new Date().toISOString(),
        };
        const match = existingByKey[key];

        if (match) {
          // ── Съществуващ мач/пазар → добавяме нова observation точка ──
          let obs = [];
          try { obs = match.observations ? JSON.parse(match.observations) : []; } catch (e) {}
          obs.push(newObs);
          const r = await oraFetch(`/${TABLE}/${match.id}`, "PATCH", { observations: JSON.stringify(obs) });
          if (r.ok) appended++;
          else errors.push(`${row.home} vs ${row.away}: HTTP ${r.status} (append) ${r.text.slice(0, 150)}`);
        } else {
          // ── Нов мач/пазар → нов ред, с първата observation вградена ──
          const payload = {
            home: row.home, away: row.away, league: row.league || "",
            side: row.side, timing: row.timing,
            prob: row.prob, implied_odds: row.implied_odds, peak_prob: row.peak_prob != null ? row.peak_prob : null,
            alert_odds: row.alert_odds, value_pct: row.value_pct,
            kickoff_utc: row.kickoff_utc, bg_date_str: row.bg_date_str, bg_time_str: row.bg_time_str,
            played_odds: row.played_odds != null ? row.played_odds : null,
            played_at: row.played_at || null,
            observations: JSON.stringify([newObs]),
            created_at: new Date().toISOString(),
          };
          const r = await oraFetch(`/${TABLE}/`, "POST", payload);
          if (r.ok) created++;
          else errors.push(`${row.home} vs ${row.away}: HTTP ${r.status} (create) ${r.text.slice(0, 150)}`);
        }
      }
      res.status(200).json({ ok: (created + appended) > 0, created, appended, total: rows.length, errors });
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
