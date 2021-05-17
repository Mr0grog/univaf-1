import express, { NextFunction, Request, Response } from "express";
import compression from "compression"; // compresses requests
import cors from "cors";
import errorHandler from "errorhandler";
import * as Sentry from "@sentry/node";
import { authorizeRequest } from "./middleware";
import * as apiEdge from "./api/edge";
import * as apiLegacy from "./api/legacy";
import { asyncHandler } from "./utils";
import bodyParser from "body-parser";

Sentry.init();

// TODO: we should use a proper logging library (e.g. Winston) which has
// plugins and extensions for this, and will gather better data.
function logRequest(request: Request, response: Response, next: NextFunction) {
  const start = new Date();
  if (process.env.NODE_ENV != "test") {
    response.on("finish", () => {
      console.error(
        `${start.toISOString()} - ${new Date().toISOString()} ${
          response.statusCode
        } ${request.method} ${request.url}`
      );
    });
  }
  next();
}

// Create Express server
const app = express();

// Express configuration
app.set("port", process.env.PORT || 3000);
app.enable("trust proxy");
app.use(Sentry.Handlers.requestHandler());
app.use(logRequest);
app.use(compression());
app.use(bodyParser.json());
app.use(cors());
app.use(authorizeRequest);

/**
 * Primary app routes.
 */

app.get("/", (_req: Request, res: Response) =>
  res.send("COVID-19 Appointments")
);
app.get("/debugme", (_req: Request, res: Response) => {
  throw new Error("TESTING SENTRY AGAIN");
});
app.get("/health", (req: Request, res: Response) => {
  // TODO: include the db status before declaring ourselves "up"
  res.status(200).send("OK!");
});

// Legacy top-level API ------------------------------------------
// TODO: Remove these when we're confident people aren't using them.
app.get("/locations", asyncHandler(apiLegacy.list));
app.get("/locations/:id", (req: Request, res: Response) => {
  res.redirect(`/api/edge/locations/${req.params.id}`);
});
// Note this one uses the newer edge API to ease our transition.
app.post("/update", asyncHandler(apiEdge.update));

// Current, non-stable API ------------------------------------------
app.get("/api/edge/locations", asyncHandler(apiEdge.list));
app.get("/api/edge/locations.ndjson", asyncHandler(apiEdge.listStream));
app.get("/api/edge/locations/:id", asyncHandler(apiEdge.getById));
app.get("/api/edge/availability", asyncHandler(apiEdge.listAvailability));
// app.get("/api/edge/availability.ndjson", asyncHandler(apiEdge.listAvailabilityStream));
app.post("/api/edge/update", asyncHandler(apiEdge.update));

// FHIR SMART Scheduling Links API ------------------------------------------
// https://github.com/smart-on-fhir/smart-scheduling-links/
import {
  sendFhirError,
  manifest,
  listLocations,
  listSchedules,
  listSlots,
} from "./smart-scheduling-routes";

const smartSchedulingApi = express.Router();
app.use("/smart-scheduling", smartSchedulingApi);

smartSchedulingApi.get("/([$])bulk-publish", asyncHandler(manifest));
smartSchedulingApi.get(
  "/locations/states/:state.ndjson",
  asyncHandler(listLocations)
);
smartSchedulingApi.get(
  "/schedules/states/:state.ndjson",
  asyncHandler(listSchedules)
);
smartSchedulingApi.get("/slots/states/:state.ndjson", asyncHandler(listSlots));
smartSchedulingApi.use((_req: Request, res: Response) =>
  sendFhirError(res, 404, {
    severity: "fatal",
    code: "not-found",
  })
);
smartSchedulingApi.use(Sentry.Handlers.errorHandler());
smartSchedulingApi.use(
  (error: any, req: Request, res: Response, _next: NextFunction) => {
    console.error("ERRROR:", error);
    const diagnostics =
      app.get("env") === "development" ? error.stack : undefined;
    sendFhirError(res, 500, {
      severity: "fatal",
      code: "exception",
      diagnostics,
    });
  }
);

// Send unhandled errors to Sentry.io
app.use(Sentry.Handlers.errorHandler());

// In development mode, provide nice stack traces to users
if (app.get("env") === "development") {
  app.use(errorHandler());
} else {
  app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
    console.error("ERRROR:", error);
    if (error && error.httpStatus) {
      res.status(error.httpStatus).json({
        error: { message: error.message, code: error.code },
      });
    } else {
      res.status(500).json({
        error: { message: "Unknown error" },
      });
    }
  });
}

export default app;