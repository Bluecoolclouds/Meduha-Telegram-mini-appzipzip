import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meduhaRouter from "./meduha";
import telegramRouter from "./telegram";
import exampleMediaRouter from "./example-media";
import feedMediaRouter from "./feed-media";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/meduha/example-media', exampleMediaRouter);
router.use('/meduha', feedMediaRouter);
router.use('/meduha',meduhaRouter);
router.use('/telegram',telegramRouter);

export default router;
