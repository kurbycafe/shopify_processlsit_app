import compression from "compression";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import * as build from "../build/server/index.js";

const app = express();

app.disable("x-powered-by");
app.use(compression());
app.use(express.static("public", { maxAge: "1h" }));

app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV || "production",
  }),
);

export default app;
