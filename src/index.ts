import { ExecutionContext } from '@cloudflare/workers-types';

// ==========================================
// ENVIRONMENT & TYPE DEFINITIONS
// ==========================================

export interface Env {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    APIRONE_ACCOUNT_ID: string;
    WEBHOOK_SECRET: string;
}

// Supported Crypto Currencies & their minor unit multipliers
const SUPPORTED_CRYPTO = {
    'btc': 100000000,
    'ltc': 100000000,
    'trx': 1000000
} as const;

type CryptoCurrency = keyof typeof SUPPORTED_CRYPTO;

// Telegram Type Contracts
interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
}

interface TelegramMessage {
    message_id: number;
    from: TelegramUser;
    chat: { id: number; type: string };
    date: number;
    text?: string;
}

interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data: string;
}

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
}

interface ApironeCallback {
    invoice: string;
    status: 'created' | 'partpaid' | 'paid' | 'completed' | 'expired';
    [key: string]: unknown;
}

// ==========================================
// WORKER ENTRY POINT
// ==========================================

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        try {
            // 1. Telegram Webhook Router
            if (url.pathname === '/webhook/telegram' && request.method === 'POST') {
                if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
                    return new Response('Unauthorized', { status: 403 });
                }
                
                // Process in background to prevent Telegram timeout retries
                ctx.waitUntil(handleTelegramUpdate(request, env, ctx, url.origin));
                return new Response('OK', { status: 200 });
            }

            // 2. Apirone Webhook Router (Top-Up Confirmations)
            if (url.pathname === '/webhook/apirone' && request.method === 'POST') {
                if (url.searchParams.get('secret') !== env.WEBHOOK_SECRET) {
                    return new Response('Unauthorized', { status: 403 });
                }
                
                ctx.waitUntil(handleApironeCallback(request, env));
                // Apirone expects exactly "*ok*" as plain text
                return new Response('*ok*', { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }

            return new Response(JSON.stringify({ status: "online", service: "Premium Store Edge" }), { 
                status: 200, 
                headers: { 'Content-Type': 'application/json' } 
            });

        } catch (error) {
            console.error('Unhandled Edge Error:', error);
            // Fail open slightly, returning 200 to webhooks so they don't get stuck in dead-letter queues endlessly unless intended
            return new Response('Internal Edge Error', { status: 500 });
        }
    }
} satisfies ExportedHandler<Env>;

// ==========================================
// TELEGRAM UX & ROUTING
// ==========================================

async function handleTelegramUpdate(request: Request, env: Env, ctx: ExecutionContext, baseUrl: string): Promise<void> {
    const update = (await request.json()) as TelegramUpdate;

    try {
        if (update.message) {
            await processMessage(update.message, env);
        } else if (update.callback_query) {
            await processCallbackQuery(update.callback_query, env, ctx, baseUrl);
        }
    } catch (error) {
        console.error('Telegram Update Processing Error:', error);
        // If a chat ID is available, gracefully inform the user
        const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
        if (chatId) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ An unexpected server error occurred. Please try again.");
        }
    }
}

async function processMessage(message: TelegramMessage, env: Env): Promise<void> {
    const chatId = message.chat.id;
    const text = message.text || '';
    const userId = message.from.id;
    const username = message.from.username || '';
    const firstName = message.from.first_name || '';

    // Register User (or Ignore if exists)
    await env.DB.prepare(
        `INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`
    ).bind(userId, username, firstName).run();

    if (text === '/start') {
        await sendMainMenu(chatId, env);
    }
}

async function sendMainMenu(chatId: number, env: Env): Promise<void> {
    const welcomeText = `🏛 <b>Welcome to the Premium Store</b>\n\nTop up your balance using Crypto and buy digital products instantly. Select an option:`;
    const keyboard = {
        inline_keyboard: [
            [{ text: "🛍️ Browse Products", callback_data: "menu_products" }],
            [{ text: "👤 My Profile & Balance", callback_data: "menu_profile" }],
            [{ text: "📦 My Purchases", callback_data: "menu_purchases" }]
        ]
    };
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, welcomeText, keyboard);
}

async function processCallbackQuery(query: TelegramCallbackQuery, env: Env, ctx: ExecutionContext, baseUrl: string): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;
    const userId = query.from.id;

    if (!chatId) return; // Cannot process without a valid chat context

    // --- NAVIGATION ---
    if (data === 'menu_main') {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);
        await sendMainMenu(chatId, env);
    }

    else if (data === 'menu_profile') {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);
        
        const user = await env.DB.prepare(`SELECT balance_usd FROM users WHERE telegram_id = ?`).bind(userId).first<{ balance_usd: number }>();
        const balance = user?.balance_usd || 0;
        
        const text = `👤 <b>Your Profile</b>\n\nID: <code>${userId}</code>\n💰 <b>Balance:</b> $${balance.toFixed(2)}\n\n<i>To buy products, you need to top up your balance.</i>`;
        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Top Up Balance", callback_data: "menu_topup" }],
                [{ text: "🔙 Main Menu", callback_data: "menu_main" }]
            ]
        };
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    }

    else if (data === 'menu_purchases') {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);

        const { results } = await env.DB.prepare(`
            SELECT p.title, d.payload, d.sold_at 
            FROM digital_assets d 
            JOIN products p ON d.product_id = p.id 
            WHERE d.sold_to = ? ORDER BY d.sold_at DESC LIMIT 10
        `).bind(userId).all<{ title: string, payload: string, sold_at: string }>();

        if (!results || results.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "📭 You haven't purchased anything yet.", { inline_keyboard: [[{ text: "🔙 Back", callback_data: "menu_main" }]] });
            return;
        }

        let text = "📦 <b>Your Recent Purchases:</b>\n\n";
        results.forEach(r => {
            text += `🔹 <b>${escapeHTML(r.title)}</b>\n🔑 <code>${escapeHTML(r.payload)}</code>\n🕒 <i>${new Date(r.sold_at).toLocaleString()}</i>\n\n`;
        });
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, { inline_keyboard: [[{ text: "🔙 Back", callback_data: "menu_main" }]] });
    }

    // --- TOP UP FLOW ---
    else if (data === 'menu_topup') {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);
        
        const text = `💳 <b>Top Up Balance</b>\n\nSelect the amount you want to add to your account (USD):`;
        const keyboard = {
            inline_keyboard: [
                [{ text: "$10", callback_data: "topup_select_10" }, { text: "$25", callback_data: "topup_select_25" }],
                [{ text: "$50", callback_data: "topup_select_50" }, { text: "$100", callback_data: "topup_select_100" }],
                [{ text: "🔙 Back to Profile", callback_data: "menu_profile" }]
            ]
        };
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    }

    else if (data.startsWith('topup_select_')) {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);
        
        const amount = data.split('_')[2];
        const text = `💎 You chose to top up <b>$${amount}</b>.\n\nSelect a cryptocurrency for payment:`;
        const keyboard = {
            inline_keyboard: [
                [{ text: "🟠 Bitcoin (BTC)", callback_data: `topup_gen_${amount}_btc` }],
                [{ text: "⚪ Litecoin (LTC)", callback_data: `topup_gen_${amount}_ltc` }],
                [{ text: "🔴 TRON (TRX)", callback_data: `topup_gen_${amount}_trx` }],
                [{ text: "🔙 Back", callback_data: "menu_topup" }]
            ]
        };
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    }

    // --- GENERATE INVOICE ---
    else if (data.startsWith('topup_gen_')) {
        // UX: Show a toast notification that the gateway is generating
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id, "⏳ Generating secure payment gateway...", false);
        
        const parts = data.split('_');
        const amountUsd = parseFloat(parts[2]);
        const cryptoCurrency = parts[3] as CryptoCurrency;

        try {
            // 1. Fetch real-time exchange rate with EDGE CACHING
            const rateUsd = await getCachedCryptoRate(cryptoCurrency, ctx);
            if (!rateUsd) throw new Error("Could not fetch exchange rates.");

            // 2. Calculate minor units
            const cryptoAmount = amountUsd / rateUsd;
            const minorUnits = Math.floor(cryptoAmount * SUPPORTED_CRYPTO[cryptoCurrency]);

            // 3. Create Apirone Invoice
            const invoiceReqBody = {
                amount: minorUnits,
                currency: cryptoCurrency,
                lifetime: 3600, // 1 hour expiry
                "callback-url": `${baseUrl}/webhook/apirone?secret=${env.WEBHOOK_SECRET}`,
                "user-data": {
                    title: `Account Top-Up ($${amountUsd})`,
                    merchant: "Premium Store",
                    price: `$${amountUsd.toFixed(2)}`
                }
            };

            const apironeRes = await fetch(`https://apirone.com/api/v2/accounts/${env.APIRONE_ACCOUNT_ID}/invoices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invoiceReqBody)
            });

            const invoiceData = await apironeRes.json() as any;
            if (!invoiceData.invoice || !invoiceData["invoice-url"]) throw new Error("Apirone API Error");

            // 4. Save Invoice to Database
            await env.DB.prepare(`
                INSERT INTO invoices (invoice_id, telegram_id, usd_amount, crypto_currency, invoice_url) 
                VALUES (?, ?, ?, ?, ?)
            `).bind(invoiceData.invoice, userId, amountUsd, cryptoCurrency, invoiceData["invoice-url"]).run();

            // 5. Present Invoice to User
            const text = `🧾 <b>Top-Up Invoice Created</b>\n\n` +
                         `💵 Amount: $${amountUsd.toFixed(2)}\n` +
                         `🪙 Pay With: ${cryptoCurrency.toUpperCase()}\n\n` +
                         `<i>Please pay using the secure link below. Your balance will update automatically upon network confirmation.</i>`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "🔗 Pay Securely via Apirone", url: invoiceData["invoice-url"] }],
                    [{ text: "👤 Return to Profile", callback_data: "menu_profile" }]
                ]
            };
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);

        } catch (e: any) {
            console.error('Invoice Generation Error:', e);
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Error creating invoice. The payment gateway might be temporarily unavailable. Please try again later.`);
        }
    }

    // --- STORE FLOW (Purchase with Balance) ---
    else if (data === 'menu_products') {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);

        const { results } = await env.DB.prepare(`
            SELECT p.id, p.title, p.price_usd, p.description, COUNT(d.id) as stock
            FROM products p
            LEFT JOIN digital_assets d ON p.id = d.product_id AND d.is_sold = 0
            WHERE p.is_active = 1
            GROUP BY p.id
        `).all<{ id: number, title: string, price_usd: number, description: string, stock: number }>();

        if (!results || results.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "😔 Store is currently empty.", { inline_keyboard: [[{ text: "🔙 Back", callback_data: "menu_main" }]] });
            return;
        }

        const user = await env.DB.prepare(`SELECT balance_usd FROM users WHERE telegram_id = ?`).bind(userId).first<{ balance_usd: number }>();
        const balance = user?.balance_usd || 0;
        
        let text = `🛒 <b>Store Catalog</b>\n💰 Your Balance: <b>$${balance.toFixed(2)}</b>\n\n`;
        const keyboard: { inline_keyboard: any[][] } = { inline_keyboard: [] };

        results.forEach((p) => {
            text += `🔹 <b>${escapeHTML(p.title)}</b>\n💵 $${p.price_usd.toFixed(2)} | 📦 Stock: ${p.stock}\n<i>${escapeHTML(p.description)}</i>\n\n`;
            if (p.stock > 0) {
                keyboard.inline_keyboard.push([{ text: `💳 Buy: ${p.title} ($${p.price_usd})`, callback_data: `buy_item_${p.id}` }]);
            }
        });
        
        keyboard.inline_keyboard.push([{ text: "🔙 Main Menu", callback_data: "menu_main" }]);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    }

    else if (data.startsWith('buy_item_')) {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id, "🔄 Processing Transaction...", false);
        const productId = data.split('_')[2];
        await processPurchase(userId, chatId, productId, env);
    }
    
    // Default fallback to clear loading state
    else {
        await answerCallback(env.TELEGRAM_BOT_TOKEN, query.id);
    }
}

// ==========================================
// CORE BUSINESS LOGIC (ATOMIC TRANSACTIONS)
// ==========================================

async function processPurchase(userId: number, chatId: number, productId: string, env: Env): Promise<void> {
    // 1. Fetch Product Price
    const product = await env.DB.prepare('SELECT title, price_usd FROM products WHERE id = ?').bind(productId).first<{ title: string, price_usd: number }>();
    if (!product) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Product not found.");
        return;
    }

    // 2. Atomic Balance Deduction (D1 returning clause)
    const deduction = await env.DB.prepare(`
        UPDATE users 
        SET balance_usd = balance_usd - ? 
        WHERE telegram_id = ? AND balance_usd >= ? 
        RETURNING balance_usd
    `).bind(product.price_usd, userId, product.price_usd).first<{ balance_usd: number }>();

    if (!deduction) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Insufficient Balance!</b>\n\nProduct costs $${product.price_usd.toFixed(2)}. Please top up your account.`, {
            inline_keyboard: [[{ text: "💳 Top Up Balance", callback_data: "menu_topup" }]]
        });
        return;
    }

    // 3. Atomic Asset Claiming
    const asset = await env.DB.prepare(`
        UPDATE digital_assets 
        SET is_sold = 1, sold_to = ?, sold_at = CURRENT_TIMESTAMP 
        WHERE id = (SELECT id FROM digital_assets WHERE product_id = ? AND is_sold = 0 LIMIT 1) 
        RETURNING payload
    `).bind(userId, productId).first<{ payload: string }>();

    if (!asset) {
        // RACE CONDITION: Stock ran out exactly when user clicked buy.
        // Action: Refund the balance automatically.
        await env.DB.prepare(`UPDATE users SET balance_usd = balance_usd + ? WHERE telegram_id = ?`).bind(product.price_usd, userId).run();
        
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ <b>Out of Stock!</b>\n\nSomeone bought the last item right before you. Your $${product.price_usd.toFixed(2)} has been instantly refunded to your balance.`, {
            inline_keyboard: [[{ text: "🔙 Browse Store", callback_data: "menu_products" }]]
        });
        return;
    }

    // 4. Delivery
    const deliveryText = `🎉 <b>Purchase Successful!</b>\n\nYou bought: <b>${escapeHTML(product.title)}</b>\nRemaining Balance: $${deduction.balance_usd.toFixed(2)}\n\nHere is your product:\n\n<code>${escapeHTML(asset.payload)}</code>\n\nThank you for your purchase!`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, deliveryText, { inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "menu_main" }]] });
}

// ==========================================
// APIRONE WEBHOOK PROCESSING (IDEMPOTENT)
// ==========================================

async function handleApironeCallback(request: Request, env: Env): Promise<void> {
    let update: ApironeCallback;
    try {
        update = await request.clone().json() as ApironeCallback;
    } catch (e) {
        console.error("Failed to parse Apirone Webhook:", e);
        return;
    }

    const { invoice: invoiceId, status } = update;
    if (!invoiceId || !status) return;

    // Atomic update to ensure credit is only applied ONCE
    const updateInvoice = await env.DB.prepare(`
        UPDATE invoices 
        SET status = ? 
        WHERE invoice_id = ? AND status NOT IN ('paid', 'completed') 
        RETURNING telegram_id, usd_amount
    `).bind(status, invoiceId).first<{ telegram_id: number, usd_amount: number }>();

    if (updateInvoice && (status === 'paid' || status === 'completed')) {
        // Add funds to user's internal balance
        await env.DB.prepare(`
            UPDATE users SET balance_usd = balance_usd + ? WHERE telegram_id = ?
        `).bind(updateInvoice.usd_amount, updateInvoice.telegram_id).run();

        // Notify User
        const text = `💰 <b>Top-Up Successful!</b>\n\n$${updateInvoice.usd_amount.toFixed(2)} has been added to your account balance.\n\nYou can now use this to buy products in the store!`;
        
        // Fire and forget telegram notification
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, updateInvoice.telegram_id, text, {
            inline_keyboard: [[{ text: "🛍️ Browse Store", callback_data: "menu_products" }]]
        });
    } else if (status !== 'paid' && status !== 'completed') {
         // Just a status update (e.g. partpaid, expired), log the status without crediting
         await env.DB.prepare(`UPDATE invoices SET status = ? WHERE invoice_id = ?`).bind(status, invoiceId).run();
    }
}

// ==========================================
// UTILITIES & SERVICES
// ==========================================

/**
 * Fetches crypto rates from Apirone, utilizing the Cloudflare Cache API
 * to prevent rate limits and speed up invoice generation to <10ms.
 */
async function getCachedCryptoRate(cryptoCurrency: string, ctx: ExecutionContext): Promise<number | null> {
    const cacheUrl = new URL(`https://apirone.com/api/v2/ticker?currency=${cryptoCurrency}&fiat=usd`);
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;
    
    let response = await cache.match(cacheKey);

    if (!response) {
        response = await fetch(cacheUrl);
        if (response.ok) {
            // Clone response to put it in cache while still returning it
            const clonedResponse = new Response(response.clone().body, response);
            // Cache for 300 seconds (5 minutes)
            clonedResponse.headers.append('Cache-Control', 's-maxage=300'); 
            ctx.waitUntil(cache.put(cacheKey, clonedResponse));
        } else {
            return null;
        }
    }

    const data = await response.json() as any;
    return data[cryptoCurrency]?.usd || null;
}

/**
 * Send a message via Telegram API
 */
async function sendTelegramMessage(token: string, chatId: number, text: string, replyMarkup: any = null): Promise<void> {
    const payload: any = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errBody = await response.text();
            console.error(`Telegram SendMessage Error (${response.status}):`, errBody);
        }
    } catch (e) {
        console.error("Failed to execute sendTelegramMessage fetch:", e);
    }
}

/**
 * Acknowledge a Telegram callback query to clear the loading state on the user's client.
 */
async function answerCallback(token: string, callbackQueryId: string, text?: string, showAlert: boolean = false): Promise<void> {
    const payload: any = { callback_query_id: callbackQueryId };
    if (text) {
        payload.text = text;
        payload.show_alert = showAlert;
    }

    try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("Failed to answer callback query:", e);
    }
}

/**
 * Escapes characters for Telegram's HTML parse mode to prevent layout breaks or injection.
 */
function escapeHTML(str: string): string {
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}
