import { Env } from "../types";
import { sendMessage } from "../utils/telegram";
import { allFakers, Faker } from "@faker-js/faker"; //

// Map common 2-letter country inputs to the exact FakerJS locale definition
const localeMap: Record<string, keyof typeof allFakers> = {
  us: 'en_US',
  uk: 'en_GB',
  gb: 'en_GB',
  ca: 'en_CA',
  au: 'en_AU',
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
  mx: 'es_MX',
  br: 'pt_BR',
  ru: 'ru',
  jp: 'ja',
  cn: 'zh_CN',
  in: 'en_IN',
  bd: 'bn_BD', // Bengali (Bangladesh)[cite: 5]
  za: 'en_ZA',
  ng: 'en_NG',
  nl: 'nl',
  se: 'sv'
};

// Map inputs to emoji flags for the UI
const flagMap: Record<string, string> = {
  us: '🇺🇸', uk: '🇬🇧', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', 
  de: '🇩🇪', fr: '🇫🇷', it: '🇮🇹', es: '🇪🇸', mx: '🇲🇽',
  br: '🇧🇷', ru: '🇷🇺', jp: '🇯🇵', cn: '🇨🇳', in: '🇮🇳', 
  bd: '🇧🇩', za: '🇿🇦', ng: '🇳🇬', nl: '🇳🇱', se: '🇸🇪'
};

export async function handleFake(args: string[], chatId: number, env: Env): Promise<void> {
  // Default to US if no argument is provided
  const inputCode = (args[0] || "us").toLowerCase();
  
  // Resolve the locale or fallback to English (US)
  const localeKey = localeMap[inputCode] || 'en_US';
  const flag = flagMap[inputCode] || '🏳️';
  
  // Dynamically load the correct Faker instance[cite: 5]
  const localeFaker: Faker = allFakers[localeKey] || allFakers['en_US'];

  try {
    // Generate highly accurate localized data based on the selected region
    const name = localeFaker.person.fullName();
    const gender = localeFaker.person.sex(); 
    
    // Address data[cite: 6]
    const street = localeFaker.location.streetAddress();
    const city = localeFaker.location.city();
    const state = localeFaker.location.state();
    const zip = localeFaker.location.zipCode();
    const country = localeFaker.location.country();
    
    // Localized phone format[cite: 6]
    const phone = localeFaker.phone.number();

    // High-fidelity UI format
    const response = `📍 <b>Address For ${flag} ${country}</b>
———————————————
• <b>Name</b> : ${name}
• <b>Gender</b> : ${gender.charAt(0).toUpperCase() + gender.slice(1)}
• <b>Street Address</b> : ${street}
• <b>City/Town/Village</b> : ${city}
• <b>State/Region</b> : ${state}
• <b>Postal Code</b> : ${zip}
• <b>Country</b> : ${country}
• <b>Phone</b> : <code>${phone}</code>`;

    // Add a quick regenerate button tied to the specific country code
    const markup = {
      inline_keyboard: [[{ text: `🔄 Regenerate ${inputCode.toUpperCase()}`, callback_data: `fake_${inputCode}` }]]
    };

    await sendMessage(env, chatId, response, markup);

  } catch (error) {
    console.error("Faker Generation Error:", error);
    await sendMessage(env, chatId, "❌ <b>Error:</b> Could not generate data for this region.");
  }
}
