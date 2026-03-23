/**
 * Outbound Telegram notifications — simple fire-and-forget alerts.
 * No polling, no commands. Never crashes the bot.
 */

const MAX_MESSAGE_LENGTH = 4096;

export async function sendTelegramAlert(message: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) return;

    const text =
      message.length > MAX_MESSAGE_LENGTH
        ? message.slice(0, MAX_MESSAGE_LENGTH - 14) + "...(truncated)"
        : message;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("Failed to send Telegram alert:", err);
  }
}
