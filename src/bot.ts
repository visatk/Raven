import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from './types';
import { users, orders } from './db/schema';
import { adminGuard } from './middleware/admin';
import { CATEGORIES, getProductById } from './catalog';
import { ApironeService } from './services/apirone';
import { desc } from 'drizzle-orm';

export function setupBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // ==========================================
  // 1. GLOBAL MIDDLEWARE
  // ==========================================
  
  // Auto-register users on their first interaction with the bot
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await ctx.db.insert(users).values({
        telegramId: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      }).onConflictDoNothing().run();
    }
    await next();
  });

  // ==========================================
  // 2. UI BUILDERS (Stateless Components)
  // ==========================================
  
  const buildMainMenu = () => {
    const keyboard = new InlineKeyboard();
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      keyboard.text(cat.title, `cat_${key}`).row();
    });
    return keyboard;
  };

  const buildCategoryMenu = (categoryKey: keyof typeof CATEGORIES) => {
    const category = CATEGORIES[categoryKey];
    const keyboard = new InlineKeyboard();
    category.products.forEach(p => {
      keyboard.text(`${p.name} - $${p.price}`, `prod_${p.id}`).row();
    });
    keyboard.text("🔙 Back to Categories", "menu_main");
    return keyboard;
  };

  // ==========================================
  // 3. PUBLIC COMMANDS
  // ==========================================
  
  bot.command(['start', 'shop'], async (ctx) => {
    const welcomeText = 
      `👋 **Welcome to the Premium Digital Store**\n\n` +
      `Browse our high-quality digital assets below.\n` +
      `⚡️ *Limited Stock: First Come & First Get*\n\n` +
      `🌐 Official Community: @drkingbd`;

    await ctx.reply(welcomeText, {
      parse_mode: "Markdown",
      reply_markup: buildMainMenu()
    });
  });

  // ==========================================
  // 4. ROUTING & STATE MACHINE (Callback Queries)
  // ==========================================

  // Handle: Main Menu Navigation
  bot.callbackQuery('menu_main', async (ctx) => {
    await ctx.editMessageText("🛍 **Select a Category:**", {
      parse_mode: "Markdown",
      reply_markup: buildMainMenu()
    });
    await ctx.answerCallbackQuery();
  });

  // Handle: Category View
  bot.callbackQuery(/cat_(.+)/, async (ctx) => {
    const categoryKey = ctx.match[1] as keyof typeof CATEGORIES;
    if (!CATEGORIES[categoryKey]) return ctx.answerCallbackQuery("Category not found.");

    await ctx.editMessageText(`📂 **${CATEGORIES[categoryKey].title}**\nSelect a product to view details:`, {
      parse_mode: "Markdown",
      reply_markup: buildCategoryMenu(categoryKey)
    });
    await ctx.answerCallbackQuery();
  });

  // Handle: Product Details & Payment Selection
  bot.callbackQuery(/prod_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    const product = getProductById(productId);
    
    if (!product) return ctx.answerCallbackQuery("Product not found.");

    let details = `🧾 **Product Details**\n\n`;
    details += `📦 **Item:** ${product.name}\n`;
    details += `💵 **Price:** $${product.price}\n`;
    if (product.bulkPrice) details += `🤝 **Bulk Price:** $${product.bulkPrice} (10+ orders)\n`;
    details += `🛡 **Warranty:** ${product.warranty}\n`;
    if (product.notes) details += `📝 **Note:** ${product.notes}\n\n`;
    details += `Select your preferred payment network below to generate a secure invoice:`;

    // High-conversion crypto selection UI
    const paymentKeyboard = new InlineKeyboard()
      .text("🪙 Pay with Litecoin (LTC)", `pay_ltc_${product.id}`).row()
      .text("💵 Pay with USDT (TRC20)", `pay_usdt@trx_${product.id}`).row()
      .text("🟠 Pay with Bitcoin (BTC)", `pay_btc_${product.id}`).row()
      .text("🔙 Back to Products", `cat_${Object.keys(CATEGORIES).find(k => CATEGORIES[k as keyof typeof CATEGORIES].products.some(p => p.id === product.id))}`);

    await ctx.editMessageText(details, {
      parse_mode: "Markdown",
      reply_markup: paymentKeyboard
    });
    await ctx.answerCallbackQuery();
  });

  // Handle: Live Payment Generation via Apirone
  bot.callbackQuery(/pay_(.+)_(.+)/, async (ctx) => {
    if (!ctx.from) return;
    
    const currency = ctx.match[1];
    const productId = ctx.match[2];
    const product = getProductById(productId);
    
    if (!product) return ctx.answerCallbackQuery("Product error.");
    
    await ctx.editMessageText("⏳ `Establishing secure payment gateway...`", { parse_mode: "Markdown" });

    try {
      // 1. Initialize Apirone Edge Service
      const apirone = new ApironeService(ctx.env.APIRONE_ACCOUNT, ctx.env.RATE_CACHE);
      
      // 2. Fetch edge-cached rates and calculate exact minor units needed
      const rate = await apirone.getExchangeRate(currency);
      const minorUnits = apirone.calculateMinorUnits(product.price, rate, currency);
      
      // 3. Generate secure tracking IDs
      const orderId = crypto.randomUUID().split('-')[0];
      const callbackSecret = crypto.randomUUID().replace(/-/g, ''); // Cryptographic hash for webhook validation
      
      // 4. Construct the webhook URL with the secret
      const webhookUrl = `${ctx.env.PUBLIC_WEBHOOK_URL}/apirone-callback?secret=${callbackSecret}`;

      // 5. Generate the V2 Invoice
      const invoice = await apirone.createInvoice({
        amount: minorUnits,
        currency: currency,
        callbackUrl: webhookUrl,
        orderId: orderId,
        productName: product.name
      });

      // 6. Persist order data to Cloudflare D1
      await ctx.db.insert(orders).values({
        id: orderId,
        telegramId: ctx.from.id,
        productId: product.id,
        productName: product.name,
        usdPrice: product.price,
        cryptoCurrency: currency,
        cryptoAmount: minorUnits,
        invoiceId: invoice.invoice,
        paymentAddress: invoice.address,
        callbackSecret: callbackSecret
      }).run();

      // 7. Format amount for humans (Apirone uses minor units)
      const humanAmount = currency.includes('trx') ? minorUnits / 1e6 : minorUnits / 1e8;
      
      // 8. Render Invoice UI
      const invoiceText = 
        `🧾 **SECURE CHECKOUT**\n\n` +
        `📦 **Product:** ${product.name}\n` +
        `🆔 **Order ID:** \`${orderId}\`\n` +
        `💵 **Total Due:** \`${humanAmount}\` ${currency.toUpperCase()}\n\n` +
        `🏦 **Send exact amount to:**\n` +
        `\`${invoice.address}\`\n\n` +
        `⚡️ *Live monitoring active. You will be notified the moment the network confirms the transaction.*\n\n` +
        `Support: @drkingbd`;

      const cancelKeyboard = new InlineKeyboard().text("❌ Cancel Order", "menu_main");

      await ctx.editMessageText(invoiceText, { 
        parse_mode: "Markdown",
        reply_markup: cancelKeyboard
      });
      await ctx.answerCallbackQuery();

    } catch (e) {
      console.error("Payment Gateway Error:", e);
      const errKeyboard = new InlineKeyboard().text("🔙 Return to Shop", "menu_main");
      await ctx.editMessageText("❌ **Gateway Timeout.**\nCould not fetch live market rates or generate invoice. Please try again.", { 
        parse_mode: "Markdown",
        reply_markup: errKeyboard
      });
    }
  });

  // ==========================================
  // 5. SECURE ADMIN ROUTER
  // ==========================================
  
  const adminBot = bot.filter((ctx) => true); // Create a sub-router
  adminBot.use(adminGuard); // Apply RBAC

  adminBot.command('orders', async (ctx) => {
    // Fetch the 10 most recent orders from D1
    const recentOrders = await ctx.db.select()
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(10)
      .all();
      
    if (recentOrders.length === 0) return ctx.reply("No orders generated yet.");
    
    let msg = "📊 **Recent Orders:**\n\n";
    recentOrders.forEach(o => {
      // e.g., ✅ #a1b2c3 - $45.00 (paid)
      const icon = o.status === 'paid' || o.status === 'completed' ? '✅' : o.status === 'expired' ? '❌' : '⏳';
      msg += `${icon} \`#${o.id}\` - $${o.usdPrice} (${o.status})\n`;
    });
    
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  return bot;
}
