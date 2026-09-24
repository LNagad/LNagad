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

// Recompute the 0-4 color levels from the combined counts. GitHub splits the max
// daily count into 4 equal buckets (despite the *_QUARTILE enum names)
const base = calendars[0];
const counts = base.map((d) => totals.get(d.date) ?? 0);
const max = Math.max(0, ...counts);
const level = (n: number) => (n === 0 ? 0 : Math.ceil((4 * n) / max));

const cells = base.map((d, i) => ({ ...d, count: counts[i], level: level(counts[i]) }));
const total = counts.reduce((a, b) => a + b, 0);
console.log(`📊 ${counts.filter((n) => n > 0).length} active days, ${total} contributions total`);

// GitHub-style "N contributions in the last year" caption, drawn in a band added
// above the svg: the snake can wander 2 cells outside the grid, which the original
// viewBox already fills, so the caption can't go inside it
const CAPTION_HEIGHT = 24;
const caption = `${total.toLocaleString("en-US")} contribution${total === 1 ? "" : "s"} in the last year`;

const isDarkColor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
};

const addCaption = (svg: string, textColor: string, dotOffset: number) => {
  const m = svg.match(/viewBox="(\S+) (\S+) (\S+) (\S+)" width="(\S+)" height="(\S+)"/);
  if (!m) throw new Error("Unexpected svg header, can't add the caption");
  const [header, x, y, w, h, width, height] = m;
  const top = +y - CAPTION_HEIGHT;
  const text =
    `<text x="${dotOffset}" y="${top + 17}" fill="${textColor}" font-size="14" ` +
    `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif">${caption}</text>`;
  return svg
    .replace(header, `viewBox="${x} ${top} ${w} ${+h + CAPTION_HEIGHT}" width="${width}" height="${+height + CAPTION_HEIGHT}"`)
    .replace("</svg>", `${text}</svg>`);
};

const grid = cellsToGrid(cells);
const snake = snake4;

console.log("📡 computing best route");
const chain = getBestRoute(grid, snake)!;
chain.push(...getPathToPose(chain.slice(-1)[0], snake)!);

for (const out of outputs) {
  if (!out) continue;
  if (out.format !== "svg") throw new Error("Only .svg outputs are supported");
  console.log(`🖌 writing ${out.filename}`);
  const { drawOptions } = out;
  const textColor = isDarkColor(drawOptions.colorEmpty) ? "#9198a1" : "#59636e";
  const svg = addCaption(
    createSvg(grid, cells, chain, drawOptions, out.animationOptions),
    textColor,
    (drawOptions.sizeCell - drawOptions.sizeDot) / 2,
  );
  fs.mkdirSync(path.dirname(out.filename), { recursive: true });
  fs.writeFileSync(out.filename, svg);
}