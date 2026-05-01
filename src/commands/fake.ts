import { Env } from "../types";
import { sendMessage } from "../utils/telegram";

// Map common 2-letter country inputs to FakerAPI.it supported locales
// FakerAPI uses standard language_COUNTRY formats
const localeMap: Record<string, string> = {
  us: 'en_US', uk: 'en_GB', gb: 'en_GB', ca: 'en_CA', au: 'en_AU', 
  de: 'de_DE', fr: 'fr_FR', it: 'it_IT', es: 'es_ES', mx: 'es_MX',
  br: 'pt_BR', ru: 'ru_RU', jp: 'ja_JP', cn: 'zh_CN', in: 'en_IN', 
  bd: 'en_US', // Fallback to en_US for unsupported specific regions
  za: 'en_ZA', ng: 'en_NG', nl: 'nl_NL', se: 'sv_SE',
  ch: 'de_CH', dk: 'da_DK', fi: 'fi_FI', ie: 'en_IE', ir: 'fa_IR',
  no: 'nb_NO', nz: 'en_NZ', rs: 'sr_RS_latin', tr: 'tr_TR', ua: 'uk_UA'
};

// Map inputs to emoji flags for the UI
const flagMap: Record<string, string> = {
  us: '🇺🇸', uk: '🇬🇧', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', 
  de: '🇩🇪', fr: '🇫🇷', it: '🇮🇹', es: '🇪🇸', mx: '🇲🇽',
  br: '🇧🇷', ru: '🇷🇺', jp: '🇯🇵', cn: '🇨🇳', in: '🇮🇳', 
  bd: '🇧🇩', za: '🇿🇦', ng: '🇳🇬', nl: '🇳🇱', se: '🇸🇪',
  ch: '🇨🇭', dk: '🇩🇰', fi: '🇫🇮', ie: '🇮🇪', ir: '🇮🇷',
  no: '🇳🇴', nz: '🇳🇿', rs: '🇷🇸', tr: '🇹🇷', ua: '🇺🇦'
};

export async function handleFake(args: string[], chatId: number, env: Env): Promise<void> {
  // Default to US if no argument is provided
  let inputCode = (args[0] || "us").toLowerCase();
  
  if (inputCode === 'uk') inputCode = 'gb';

  // Resolve the locale or fallback to English (US)
  const locale = localeMap[inputCode] || 'en_US';
  const flag = flagMap[inputCode] || '🏳️';

  try {
    // Fetch data from FakerAPI.it using Cloudflare's native fetch
    const response = await fetch(`https://fakerapi.it/api/v1/persons?_quantity=1&_locale=${locale}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Nexus-Infrastructure-Bot/3.0"
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json<any>();
    const user = data.data[0];

    // Extract and format variables gracefully based on FakerAPI's schema
    const name = `${user.firstname} ${user.lastname}`;
    const gender = user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : 'Unknown';
    const street = user.address?.street || "N/A";
    const city = user.address?.city || "N/A";
    const state = user.address?.state || city; // FakerAPI sometimes omits state, fallback to city
    const zip = String(user.address?.zipcode || "N/A");
    const country = user.address?.country || "N/A";
    const phone = user.phone || "N/A";

    // Exact match to the requested UI, with <code> tags added to values for tap-to-copy
    const output = `📍 <b>Address For ${flag} ${country}</b>
———————————————
• <b>Name</b> : <code>${name}</code>
• <b>Gender</b> : ${gender}
• <b>Street Address</b> : <code>${street}</code>
• <b>City/Town/Village</b> : <code>${city}</code>
• <b>State</b> : <code>${state}</code>
• <b>Postal Code</b> : <code>${zip}</code>
• <b>Country</b> : ${country}
• <b>Phone</b> : <code>${phone}</code>
———————————————`;

    // Add the interactive regenerate button 
    const markup = {
      inline_keyboard: [
        [{ text: `🔄 Regenerate ${inputCode.toUpperCase()}`, callback_data: `fake_${inputCode}` }]
      ]
    };

    await sendMessage(env, chatId, output, markup);

  } catch (error) {
    console.error("Error:", error);
    await sendMessage(env, chatId, "❌ <b>Error:</b> Could not generate data for this region. Please try again later.");
  }
}
