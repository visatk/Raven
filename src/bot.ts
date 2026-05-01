import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from './types';
import { users, orders } from './db/schema';
import { adminGuard } from './middleware/admin';
import { CATEGORIES, getProductById } from './catalog';
import { ApironeService } from './services/apirone';

export function setupBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // --- STANDARD MIDDLEWARE ---
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

  // --- UI MENUS ---
  const buildMainMenu = () => { /* Same as previous implementation */ };
  const buildCategoryMenu = (catKey: keyof typeof CATEGORIES) => { /* Same as previous */ };

  bot.command(['start', 'shop'], async (ctx) => {
    await ctx.reply("🛍 **RavenHQ Premium Marketplace**", { parse_mode: "Markdown", reply_markup: buildMainMenu() });
  });

  // Handle Product View
  bot.callbackQuery(/prod_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    const product = getProductById(productId);
    if (!product) return ctx.answerCallbackQuery("Product not found.");

    let details = `📦 **${product.name}**\n💵 **Price:** $${product.price}\n🛡 **Warranty:** ${product.warranty}\n\nSelect your payment method below:`;

    // Crypto Selection Keyboard
    const paymentKeyboard = new InlineKeyboard()
      .text("🪙 Pay with Litecoin (LTC)", `pay_ltc_${product.id}`).row()
      .text("💵 Pay with USDT (TRC20)", `pay_usdt@trx_${product.id}`).row()
      .text("🟠 Pay with Bitcoin (BTC)", `pay_btc_${product.id}`).row()
      .text("🔙 Back", "menu_main");

    await ctx.editMessageText(details, { parse_mode: "Markdown", reply_markup: paymentKeyboard });
    await ctx.answerCallbackQuery();
  });

  // Handle Payment Generation
  bot.callbackQuery(/pay_(.+)_(.+)/, async (ctx) => {
    if (!ctx.from) return;
    const currency = ctx.match[1];
    const productId = ctx.match[2];
    const product = getProductById(productId);
    
    if (!product) return ctx.answerCallbackQuery("Product error.");
    
    await ctx.editMessageText("⏳ Generating live secure invoice...");

    try {
      const apirone = new ApironeService(ctx.env.APIRONE_ACCOUNT);
      const rate = await apirone.getExchangeRate(currency);
      const minorUnits = apirone.calculateMinorUnits(product.price, rate, currency);
      
      const orderId = crypto.randomUUID().split('-')[0]; // Edge-native UUID
      const webhookUrl = `${ctx.env.PUBLIC_WEBHOOK_URL}/apirone-callback`;

      const invoice = await apirone.createInvoice({
        amount: minorUnits,
        currency: currency,
        callbackUrl: webhookUrl,
        orderId: orderId,
        productName: product.name
      });

      // Persist to D1 Database
      await ctx.db.insert(orders).values({
        id: orderId,
        telegramId: ctx.from.id,
        productId: product.id,
        productName: product.name,
        usdPrice: product.price,
        cryptoCurrency: currency,
        cryptoAmount: minorUnits,
        invoiceId: invoice.invoice,
        paymentAddress: invoice.address
      }).run();

      // Display Invoice to User
      const humanAmount = currency.includes('trx') ? minorUnits / 1e6 : minorUnits / 1e8;
      
      const invoiceText = `🧾 **ORDER INVOICE #${orderId}**\n\n` +
        `📦 **Item:** ${product.name}\n` +
        `💵 **Amount:** \`${humanAmount}\` ${currency.toUpperCase()}\n` +
        `🏦 **Send exactly to this address:**\n` +
        `\`${invoice.address}\`\n\n` +
        `*⚠️ Address is tap-to-copy. Waiting for network confirmation. You will be notified automatically.*`;

      await ctx.editMessageText(invoiceText, { parse_mode: "Markdown" });
      await ctx.answerCallbackQuery();

    } catch (e) {
      console.error(e);
      await ctx.editMessageText("❌ Error generating payment gateway. Try again later.");
    }
  });

  return bot;
}
