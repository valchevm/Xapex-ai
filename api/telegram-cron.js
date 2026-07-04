// ════════════════════════════════════════════════════════════════
// Извиква се периодично (виж README долу за настройка на тригера).
// Проверява xgpro_telegram_queue за неизпратени известия, чийто
// kickoff_utc вече е настъпил, и ги праща през Telegram Bot API.
//
// НЕОБХОДИМИ Vercel Environment Variables (Project Settings → Env):
//   TELEGRAM_BOT_TOKEN — токенът от @BotFather
//   TELEGRAM_CHAT_ID   — твоя chat_id (виж @userinfobot или Bot API getUpdates)
//
// Тригер: Vercel Hobby plan позволява cron само 1×/ден — недостатъчно
// за точност "в началото на мача". Препоръка: използвай безплатна
// услуга като cron-job.org да удря този endpoint на всеки 1-2 минути:
//   GET https://xapex-ai.vercel.app/api/telegram-cron
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

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    res.status(500).json({ ok: false, error: "missing_telegram_env_vars" });
    return;
  }

  try {
    // ✅ ORDS $lte филтърът върху VARCHAR2 kickoff_utc не връщаше редове
    // (тихо 0, без грешка) — вместо да разчитаме на Oracle да сравнява
    // датите, тегли всички неизпратени и сравняваме тук, в JS.
    const q = encodeURIComponent(JSON.stringify({ sent: 0 }));
    const due = await oraFetch(`/${TABLE}/?q=${q}&limit=200`);
    const now = Date.now();
    const items = (due.json?.items || []).filter((it) => {
      const t = Date.parse(it.kickoff_utc);
      return !isNaN(t) && t <= now;
    });

    let sentCount = 0;
    const errors = [];
    for (const it of items) {
      const msg =
        `🚨 <b>${it.home} vs ${it.away}</b>\n` +
        `🏆 ${it.league || ""}\n` +
        `⚙️ ${it.side} ${it.timing}\n` +
        (it.prob != null ? `✨ Вероятност: ${it.prob}%\n` : "") +
        (it.odds != null ? `📉 Коефициент: ${it.odds}\n` : "") +
        (it.value_pct != null ? `📈 Value: +${it.value_pct}%\n` : "") +
        `⏰ Начало: ${it.bg_date_str} ${it.bg_time_str} (българско време)`;

      try {
        const ok = await sendTelegram(token, chatId, msg);
        if (ok) {
          await oraFetch(`/${TABLE}/${it.id}`, "PUT", { sent: 1 });
          sentCount++;
        } else {
          errors.push(`${it.home} vs ${it.away}: telegram send failed`);
        }
      } catch (e) {
        errors.push(`${it.home} vs ${it.away}: ${e.message}`);
      }
    }

    res.status(200).json({ ok: true, checked: items.length, sent: sentCount, errors });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
}
