import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import spec from "./openapi";

const swaggerOptions = {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Orqestr API Documentation",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

export const swaggerRouter = Router();

swaggerRouter.get("/openapi.json", (_req, res) => {
  res.json(spec);
});

swaggerRouter.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(spec, swaggerOptions),
);
