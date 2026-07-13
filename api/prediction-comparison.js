// ════════════════════════════════════════════════════════════════
// CRUD proxy за xgpro_prediction_comparison — записва OA вероятности
// и вероятностите на собствения модел при всяко изчисление, за да
// може после да се сравнява точността им спрямо реалния резултат.
// ════════════════════════════════════════════════════════════════
const ORACLE_BASE =
  "https://gb975ca8378ff79-home.adb.eu-turin-1.oraclecloudapps.com/ords/admin";
const TABLE = "xgpro_prediction_comparison";

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
  return (row.home || "").trim().toLowerCase() + "|" + (row.away || "").trim().toLowerCase();
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
      const row = req.body?.row;
      if (!row || !row.home || !row.away) { res.status(400).json({ ok: false, error: "missing_row" }); return; }

      // ── Ако вече има запис за този мач → update-ваме вероятностите
      // (нов Calculate презаписва старите стойности) ──
      const q = encodeURIComponent(JSON.stringify({ home: row.home, away: row.away }));
      const existing = await oraFetch(`/${TABLE}/?q=${q}`, "GET");
      const items = existing.json?.items || [];

      if (items.length > 0) {
        const upd = {
          oa_prob_home: row.oa_prob_home, oa_prob_draw: row.oa_prob_draw, oa_prob_away: row.oa_prob_away,
          oa_prob_btts: row.oa_prob_btts, oa_prob_over: row.oa_prob_over, oa_prob_under: row.oa_prob_under,
          model_prob_home: row.model_prob_home, model_prob_draw: row.model_prob_draw, model_prob_away: row.model_prob_away,
          model_prob_btts: row.model_prob_btts, model_prob_over: row.model_prob_over, model_prob_under: row.model_prob_under,
          league: row.league, country: row.country,
          updated_at: new Date().toISOString(),
        };
        const r = await oraFetch(`/${TABLE}/${items[0].id}`, "PATCH", upd);
        res.status(200).json({ ok: r.ok, action: "updated", id: items[0].id });
        return;
      }

      const payload = {
        home: row.home, away: row.away, league: row.league || "", country: row.country || "",
        kickoff_utc: row.kickoff_utc || null,
        oa_prob_home: row.oa_prob_home, oa_prob_draw: row.oa_prob_draw, oa_prob_away: row.oa_prob_away,
        oa_prob_btts: row.oa_prob_btts, oa_prob_over: row.oa_prob_over, oa_prob_under: row.oa_prob_under,
        model_prob_home: row.model_prob_home, model_prob_draw: row.model_prob_draw, model_prob_away: row.model_prob_away,
        model_prob_btts: row.model_prob_btts, model_prob_over: row.model_prob_over, model_prob_under: row.model_prob_under,
        actual_result: null, actual_btts: null, actual_ou25: null,
        created_at: new Date().toISOString(),
      };
      const r = await oraFetch(`/${TABLE}/`, "POST", payload);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true, action: "created" });
      return;
    }

    if (req.method === "PATCH") {
      // ── Попълва реалния резултат — 1X2 (H/D/A), BTTS (Y/N) и/или O/U 2.5 (O/U) ──
      const { id, actual_result, actual_btts, actual_ou25 } = req.body || {};
      if (!id || (!actual_result && !actual_btts && !actual_ou25)) {
        res.status(400).json({ ok: false, error: "missing_id_or_result" }); return;
      }
      const upd = {};
      if (actual_result) upd.actual_result = actual_result;
      if (actual_btts) upd.actual_btts = actual_btts;
      if (actual_ou25) upd.actual_ou25 = actual_ou25;
      const r = await oraFetch(`/${TABLE}/${id}`, "PATCH", upd);
      if (!r.ok) { res.status(200).json({ ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
