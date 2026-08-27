import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

// Serve API routes
app.use("/api", router);

// Serve frontend static files in production
const frontendDistPath = path.join(__dirname, "..", "..", "colab-command-center", "dist");
app.use(express.static(frontendDistPath));

// Serve index.html for all other routes (SPA support)
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

export default app;
