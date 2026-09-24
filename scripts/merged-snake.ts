/**
 * Merged snake: sums the contribution calendars of several GitHub accounts
 * and renders a single snake animation with Platane/snk's own engine.
 *
 * Runs inside a checkout of Platane/snk (copied to packages/generate-snake-animation/).
 *
 * Env:
 *   GITHUB_TOKEN  token to query the GraphQL API
 *   SNK_USERS     comma-separated usernames, e.g. "maycolperez-blip,lnagad"
 *   SNK_OUTPUTS   one output per line, same syntax as the snk action
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getGithubUserContribution } from "@snk/github-user-contribution";
import { getBestRoute } from "@snk/solver/getBestRoute";
import { getPathToPose } from "@snk/solver/getPathToPose";
import { createSvg } from "@snk/svg-creator";
import { snake4 } from "@snk/types/__fixtures__/snake";
import { cellsToGrid } from "./cellsToGrid";
import { parseOutputsOption } from "./outputsOptions";

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("Missing GITHUB_TOKEN");

const users = (process.env.SNK_USERS ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
if (users.length === 0) throw new Error("SNK_USERS is empty");

const outputs = parseOutputsOption(
  (process.env.SNK_OUTPUTS ?? "").split("\n").filter((l) => l.trim()),
);

console.log(`🎣 fetching contributions for: ${users.join(", ")}`);
const calendars = await Promise.all(
  users.map((u) => getGithubUserContribution(u, { githubToken: token })),
);

// Sum contributions per day across all accounts
const totals = new Map<string, number>();
for (const calendar of calendars)
  for (const day of calendar)
    totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);

// Recompute the 0-4 color levels from the combined counts (quartiles of active days)
const base = calendars[0];
const counts = base.map((d) => totals.get(d.date) ?? 0);
const active = counts.filter((n) => n > 0).sort((a, b) => a - b);
const quantile = (p: number) => active[Math.floor((active.length - 1) * p)] ?? 0;
const [q1, q2, q3] = [quantile(0.25), quantile(0.5), quantile(0.75)];
const level = (n: number) =>
  n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4;

const cells = base.map((d, i) => ({ ...d, count: counts[i], level: level(counts[i]) }));
console.log(`📊 ${active.length} active days, ${counts.reduce((a, b) => a + b, 0)} contributions total`);

const grid = cellsToGrid(cells);
const snake = snake4;

console.log("📡 computing best route");
const chain = getBestRoute(grid, snake)!;
chain.push(...getPathToPose(chain.slice(-1)[0], snake)!);

for (const out of outputs) {
  if (!out) continue;
  if (out.format !== "svg") throw new Error("Only .svg outputs are supported");
  console.log(`🖌 writing ${out.filename}`);
  const svg = createSvg(grid, cells, chain, out.drawOptions, out.animationOptions);
  fs.mkdirSync(path.dirname(out.filename), { recursive: true });
  fs.writeFileSync(out.filename, svg);
}