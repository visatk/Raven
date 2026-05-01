export class ApironeService {
  private readonly baseUrl = 'https://apirone.com/api/v2';

  constructor(private accountId: string) {}

  // 1. Fetch live market rates
  async getExchangeRate(currency: string): Promise<number> {
    const res = await fetch(`${this.baseUrl}/ticker?currency=${currency}&fiat=usd`);
    if (!res.ok) throw new Error('Failed to fetch Apirone ticker');
    
    const data = await res.json() as any;
    // Single currency response format: {"usd": 56716.8657}
    return data.usd;
  }

  // 2. Convert USD to Crypto Minor Units
  calculateMinorUnits(usdAmount: number, rate: number, currency: string): number {
    const cryptoAmount = usdAmount / rate;
    
    // Decimals: BTC/LTC/DOGE = 8, TRON/USDT@TRX = 6
    const multiplier = currency.includes('trx') || currency.includes('eth') ? 1e6 : 1e8; 
    
    // Ethereum/BNB native is 1e18, but typically marketplaces prefer USDT/TRX or BTC/LTC
    // Assuming USDT@TRX (6), BTC (8), LTC (8) for this implementation
    return Math.ceil(cryptoAmount * multiplier);
  }

  // 3. Generate the Invoice
  async createInvoice(params: {
    amount: number;
    currency: string;
    callbackUrl: string;
    orderId: string;
    productName: string;
  }) {
    const payload = {
      amount: params.amount,
      currency: params.currency,
      lifetime: 3600, // 1 hour expiration
      "callback-url": params.callbackUrl,
      "user-data": {
        title: `Order #${params.orderId}`,
        merchant: "RavenHQ Marketplace",
        items: [{ name: params.productName, cost: "0", qty: 1, total: "0" }]
      }
    };

    const res = await fetch(`${this.baseUrl}/accounts/${this.accountId}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Apirone Invoice Error: ${await res.text()}`);
    return (await res.json()) as any;
  }
}
