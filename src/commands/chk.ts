import { Env } from "../types";
import { sendMessage } from "../utils/telegram";

export async function handleChk(args: string[], chatId: number, env: Env, isVbv: boolean = false): Promise<void> {
  if (!args[0]) {
    await sendMessage(env, chatId, `❌ <b>Error:</b> Provide card details.\n<i>Example:</i> <code>/${isVbv ? 'vbv' : 'chk'} cc|mm|yy|cvv</code>`);
    return;
  }

  const type = isVbv ? "VBV Lookup" : "Auth Check";
  const status = Math.random() > 0.5 ? "✅ <b>Approved</b>" : "❌ <b>Declined</b>";
  const msg = status.includes("Approved") ? "1000: Approved" : "2001: Insufficient Funds";

  const response = `💳 <b>Mock ${type}</b>
———————————————
<b>Card:</b> <code>${args[0]}</code>
<b>Status:</b> ${status}
<b>Message:</b> ${msg}
<b>Gateway:</b> Nexus Stripe Auth`;

  await sendMessage(env, chatId, response);
}
