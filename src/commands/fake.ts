import { Env } from "../types";
import { sendMessage } from "../utils/telegram";

// Comprehensive mapping for FakerAPI.it v2 supported locales
// This maps user input to the correct _locale parameter and UI elements
const regionMap: Record<string, { locale: string; name: string; flag: string }> = {
  us: { locale: 'en_US', name: 'United States', flag: '🇺🇸' },
  uk: { locale: 'en_GB', name: 'United Kingdom', flag: '🇬🇧' },
  gb: { locale: 'en_GB', name: 'United Kingdom', flag: '🇬🇧' },
  ca: { locale: 'en_CA', name: 'Canada', flag: '🇨🇦' },
  au: { locale: 'en_AU', name: 'Australia', flag: '🇦🇺' },
  de: { locale: 'de_DE', name: 'Germany', flag: '🇩🇪' },
  fr: { locale: 'fr_FR', name: 'France', flag: '🇫🇷' },
  it: { locale: 'it_IT', name: 'Italy', flag: '🇮🇹' },
  es: { locale: 'es_ES', name: 'Spain', flag: '🇪🇸' },
  mx: { locale: 'es_MX', name: 'Mexico', flag: '🇲🇽' },
  br: { locale: 'pt_BR', name: 'Brazil', flag: '🇧🇷' },
  ru: { locale: 'ru_RU', name: 'Russia', flag: '🇷🇺' },
  jp: { locale: 'ja_JP', name: 'Japan', flag: '🇯🇵' },
  cn: { locale: 'zh_CN', name: 'China', flag: '🇨🇳' },
  in: { locale: 'en_IN', name: 'India', flag: '🇮🇳' },
  bd: { locale: 'bn_BD', name: 'Bangladesh', flag: '🇧🇩' },
  za: { locale: 'en_ZA', name: 'South Africa', flag: '🇿🇦' },
  ng: { locale: 'en_NG', name: 'Nigeria', flag: '🇳🇬' },
  nl: { locale: 'nl_NL', name: 'Netherlands', flag: '🇳🇱' },
  se: { locale: 'sv_SE', name: 'Sweden', flag: '🇸🇪' }
};

export async function handleFake(args: string[], chatId: number, env: Env): Promise<void> {
  // Default to US if no argument or an invalid argument is provided
  const inputCode = (args[0] || "us").toLowerCase();
  const region = regionMap[inputCode] || regionMap["us"];

  try {
    // We use the /persons endpoint because it returns Identity + Nested Address Data
    // Passing _locale guarantees localized names, phones, and addresses.
    const url = `https://fakerapi.it/api/v2/persons?_quantity=1&_locale=${region.locale}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Nexus-Infrastructure-Bot/2.0"
      }
    });

    if (!response.ok) {
      throw new Error(`FakerAPI returned HTTP ${response.status}`);
    }

    const json = await response.json<any>();
    
    if (!json.data || json.data.length === 0) {
      throw new Error("Empty data array returned from API");
    }

    const person = json.data[0];
    const addr = person.address || {};

    // Extract and safely format variables
    const name = `${person.firstname} ${person.lastname}`;
    const gender = person.gender ? (person.gender.charAt(0).toUpperCase() + person.gender.slice(1)) : "Unknown";
    const phone = person.phone || "N/A";
    
    // FakerAPI.it handles addresses dynamically based on region; we map available fields safely
    const street = addr.street || `${addr.buildingNumber || ''} ${addr.streetName || ''}`.trim() || 'N/A';
    const city = addr.city || 'N/A';
    const state = addr.county_code || 'N/A'; // 'county_code' often acts as the State/Province in FakerAPI
    const zip = String(addr.zipcode || 'N/A');

    // Retain exact UI layout from the screenshot with tap-to-copy <code> blocks
    const output = `📍 <b>Address For ${region.flag} ${region.name}</b>
———————————————
• <b>Name</b> : <code>${name}</code>
• <b>Gender</b> : ${gender}
• <b>Street Address</b> : <code>${street}</code>
• <b>City/Town/Village</b> : <code>${city}</code>
• <b>State</b> : <code>${state}</code>
• <b>Postal Code</b> : <code>${zip}</code>
• <b>Country</b> : ${region.name}
• <b>Phone</b> : <code>${phone}</code>
———————————————`;

    // Interactive Regenerate button tied to the specific country code
    const markup = {
      inline_keyboard: [
        [{ text: `🔄 Regenerate ${inputCode.toUpperCase()}`, callback_data: `fake_${inputCode}` }]
      ]
    };

    await sendMessage(env, chatId, output, markup);

  } catch (error) {
    console.error("FakerAPI.it Error:", error);
    await sendMessage(env, chatId, "❌ <b>Error:</b> Could not generate data for this region right now. Please try again.");
  }
}
