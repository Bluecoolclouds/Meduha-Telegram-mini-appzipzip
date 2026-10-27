import { Router, type Response, type Request } from 'express';
import { configuredFreeKassaProvider, FreeKassaNotificationError } from '../lib/freekassa';
import {
  findPaymentOrderByProviderPaymentId, markVerifiedPayment, grantNextDueInstallment,
} from '../lib/billing-orders';

// Dependency overrides keep route tests credential-free and away from real accounts.
type Dependencies = {
  provider: typeof configuredFreeKassaProvider;
  findOrder: typeof findPaymentOrderByProviderPaymentId;
  settle: typeof markVerifiedPayment;
  grant: typeof grantNextDueInstallment;
};
const returnCookie = 'meduha_freekassa_return';
const returnCookieOptions = () => ({
  httpOnly: true, sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/meduha/payments/freekassa',
});
export function rememberFreeKassaReturn(res: Response, orderId: string) {
  res.cookie(returnCookie, orderId, { ...returnCookieOptions(), maxAge: 24 * 60 * 60 * 1000 });
}

export function createFreeKassaPaymentsRouter(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    provider: configuredFreeKassaProvider,
    findOrder: findPaymentOrderByProviderPaymentId,
    settle: markVerifiedPayment,
    grant: grantNextDueInstallment,
    ...overrides,
  };
  const router = Router();
  router.post('/freekassa/notify', async (req, res) => {
    const provider = deps.provider();
    if (!provider) {
      res.status(503).send('PAYMENT_PROVIDER_NOT_CONFIGURED');
      return;
    }
    try {
      // Authenticate before querying orders. Browser success redirects, query
      // parameters and unsigned intid never authorize credit grants.
      const verified = provider.verifyNotification(req.body);
      const knownId = await deps.findOrder('freekassa', verified.id);
      if (!knownId || knownId !== verified.orderId) {
        res.status(404).send('PAYMENT_ORDER_NOT_FOUND');
        return;
      }
      const order = await deps.settle('freekassa', verified);
      if (!order) {
        res.status(404).send('PAYMENT_ORDER_NOT_FOUND');
        return;
      }
      if (order.status === 'succeeded') {
        for (let count = 0; count < 12; count++) {
          if (!await deps.grant()) break;
        }
      }
      // FreeKassa retries until YES. Send only after committed settlement/grants.
      res.type('text/plain').send('YES');
    } catch (error) {
      if (error instanceof FreeKassaNotificationError) {
        res.status(error.status).send(error.message);
      } else if (error instanceof Error && error.message === 'PAYMENT_DETAILS_MISMATCH') {
        res.status(409).send('PAYMENT_DETAILS_MISMATCH');
      } else {
        req.log?.error({ errorName: error instanceof Error ? error.name : 'UnknownError' },
          'FreeKassa notification settlement failed');
        res.status(503).send('PAYMENT_SETTLEMENT_UNAVAILABLE');
      }
    }
  });
  const returnToWallet = (req: Request, res: Response) => {
    const id: unknown = req.cookies?.[returnCookie];
    const validId = typeof id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    res.clearCookie(returnCookie, returnCookieOptions());
    // This cookie is only a UI correlation hint. The wallet's order endpoint
    // still authenticates ownership; neither cookie nor return marks it paid.
    res.redirect(303, validId ? `/wallet?payment_order=${encodeURIComponent(id)}` : '/wallet');
  };
  router.get('/freekassa/return', returnToWallet);
  router.post('/freekassa/return', returnToWallet);
  return router;
}
