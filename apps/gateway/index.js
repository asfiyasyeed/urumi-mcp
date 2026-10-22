import express from "express";
import { seedAdmin } from "./db.js";

seedAdmin();

const app = express();
app.use(express.json());

app.get("/healthz", (req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`gateway listening on :${PORT}`));
