import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ticketsRouter from "./tickets";
import dashboardRouter from "./dashboard";
import notificationsRouter from "./notifications";
import pushTokensRouter from "./pushTokens";
import kbRouter from "./kb";
import teamRouter from "./team";
import customersRouter from "./customers";
import adminRouter from "./admin";
import brandingRouter from "./branding";
import siteSettingsRouter from "./siteSettings";
import filesRouter from "./files";
import deploymentsRouter from "./deployments";
import bootstrapRouter from "./bootstrap";

const router: IRouter = Router();

router.use(bootstrapRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(ticketsRouter);
router.use(dashboardRouter);
router.use(notificationsRouter);
router.use(pushTokensRouter);
router.use(kbRouter);
router.use(teamRouter);
router.use(customersRouter);
router.use(adminRouter);
router.use(brandingRouter);
router.use(siteSettingsRouter);
router.use(filesRouter);
router.use(deploymentsRouter);

export default router;
