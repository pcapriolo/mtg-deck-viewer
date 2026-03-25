/**
 * Outbound Telegram notifications. Returns true on success, false on failure.
 * Never crashes the bot — all errors are caught and logged.
 * Retries once after 2s on transient failures.
 */

const MAX_MESSAGE_LENGTH = 4096;
const RETRY_DELAY_MS = 2000;

async function attemptSend(token: string, chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }

  return true;
}

export async function sendTelegramAlert(message: string): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.warn(
        `Telegram not configured: missing ${!token ? "TELEGRAM_BOT_TOKEN" : ""}${!token && !chatId ? " and " : ""}${!chatId ? "TELEGRAM_CHAT_ID" : ""}`
      );
      return false;
    }

    const text =
      message.length > MAX_MESSAGE_LENGTH
        ? message.slice(0, MAX_MESSAGE_LENGTH - 14) + "...(truncated)"
        : message;

    try {
      return await attemptSend(token, chatId, text);
    } catch (firstErr) {
      console.error(`Failed to send Telegram alert (attempt 1): ${firstErr}`);
      // Retry once after a short delay
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return await attemptSend(token, chatId, text);
      } catch (secondErr) {
        console.error(`Failed to send Telegram alert (attempt 2): ${secondErr}`);
        return false;
      }
    }
  } catch (err) {
    console.error("Failed to send Telegram alert:", err);
    return false;
  }
}
