import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meduhaRouter from "./meduha";
import telegramRouter from "./telegram";
import exampleMediaRouter from "./example-media";
import feedMediaRouter from "./feed-media";
import { createMeduhaPaymentsRouter, createYooKassaWebhookRouter } from "./meduha-payments";
import { createFreeKassaPaymentsRouter } from "./freekassa-payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/meduha/example-media', exampleMediaRouter);
// Keep external provider notifications outside the browser CSRF/session router.
router.use('/meduha/payments', createYooKassaWebhookRouter());
router.use('/meduha/payments', createFreeKassaPaymentsRouter());
router.use('/meduha', createMeduhaPaymentsRouter());
router.use('/meduha', feedMediaRouter);
router.use('/meduha',meduhaRouter);
router.use('/telegram',telegramRouter);

export default router;
