import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ticketsRouter from "./tickets";
import dashboardRouter from "./dashboard";
import notificationsRouter from "./notifications";
import pushTokensRouter from "./pushTokens";
import kbRouter from "./kb";
import teamRouter from "./team";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ticketsRouter);
router.use(dashboardRouter);
router.use(notificationsRouter);
router.use(pushTokensRouter);
router.use(kbRouter);
router.use(teamRouter);
router.use(adminRouter);

export default router;
