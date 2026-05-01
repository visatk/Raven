import { Context, InlineKeyboard } from 'grammy';

// RandomUser API supported nationalities
const SUPPORTED_NATS = ['au', 'br', 'ca', 'ch', 'de', 'dk', 'es', 'fi', 'fr', 'gb', 'ie', 'in', 'ir', 'mx', 'nl', 'no', 'nz', 'rs', 'tr', 'ua', 'us'];

// Map common aliases to supported API codes
const NAT_ALIASES: Record<string, string> = {
    'uk': 'gb',
    'en': 'us',
    'za': 'au', // Fallbacks for unsupported regions if needed
};

// Flags mapping for visual enhancement
const FLAGS: Record<string, string> = {
    'au': '🇦🇺', 'br': '🇧🇷', 'ca': '🇨🇦', 'ch': '🇨🇭', 'de': '🇩🇪', 'dk': '🇩🇰', 
    'es': '🇪🇸', 'fi': '🇫🇮', 'fr': '🇫🇷', 'gb': '🇬🇧', 'ie': '🇮🇪', 'in': '🇮🇳', 
    'ir': '🇮🇷', 'mx': '🇲🇽', 'nl': '🇳🇱', 'no': '🇳🇴', 'nz': '🇳🇿', 'rs': '🇷🇸', 
    'tr': '🇹🇷', 'ua': '🇺🇦', 'us': '🇺🇸'
};

export async function fakeCommand(ctx: Context) {
    let requestedCode = 'us'; // Default

    // Extract country code from callback (button click) or command text
    if (ctx.callbackQuery) {
        const parts = ctx.callbackQuery.data.split('_');
        if (parts.length > 1) {
            requestedCode = parts[1].toLowerCase();
        }
        await ctx.answerCallbackQuery();
    } else if (ctx.match) {
        requestedCode = (ctx.match as string).trim().toLowerCase() || 'us';
    }

    // Resolve aliases (e.g., 'uk' -> 'gb')
    const natCode = NAT_ALIASES[requestedCode] || requestedCode;

    if (!SUPPORTED_NATS.includes(natCode)) {
        await ctx.reply(`⚠️ Unsupported country code: \`${requestedCode}\`.\nSupported codes: ${SUPPORTED_NATS.join(', ')}, uk`, { parse_mode: 'Markdown' });
        return;
    }

    try {
        // Fetch from Random User API
        const response = await fetch(`https://randomuser.me/api/?nat=${natCode}&inc=gender,name,location,phone,nat`);
        
        if (!response.ok) {
            throw new Error(`API returned status: ${response.status}`);
        }

        const data = await response.json() as any;
        const user = data.results[0];

        // Format the extracted data
        const flag = FLAGS[user.nat.toLowerCase()] || '🌍';
        const gender = user.gender.charAt(0).toUpperCase() + user.gender.slice(1);
        const fullName = `${user.name.title} ${user.name.first} ${user.name.last}`;
        
        const messageText = 
            `📍 **Address For ${flag} ${user.location.country}**\n` +
            `------------------------\n` +
            `• **Name** : ${fullName}\n` +
            `• **Gender** : ${gender}\n` +
            `• **Street Address** : ${user.location.street.number} ${user.location.street.name}\n` +
            `• **City/Town/Village** : ${user.location.city}\n` +
            `• **State/Region** : ${user.location.state}\n` +
            `• **Postal Code** : ${user.location.postcode}\n` +
            `• **Country** : ${user.location.country}\n` +
            `• **Phone** : \`${user.phone}\``;

        // Build the regeneration button
        const keyboard = new InlineKeyboard()
            .text(`🔄 Regenerate ${requestedCode.toUpperCase()}`, `fake_${requestedCode}`);

        // Send or edit message
        if (ctx.callbackQuery) {
            await ctx.editMessageText(messageText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await ctx.reply(messageText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }

    } catch (error) {
        console.error('Error fetching fake data:', error);
        
        // Ignore "message is not modified" errors from rapid button clicking
        if (error instanceof Error && error.message.includes('message is not modified')) return;

        const errorMsg = "❌ Failed to generate identity from the API. Please try again.";
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: errorMsg, show_alert: true });
        } else {
            await ctx.reply(errorMsg);
        }
    }
}
