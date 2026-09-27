/**
 * Renames and converts marketing media under web/public/media.
 * PNGs → WebP (q≈82, longest side ≤2400). Video kept as-is when ffmpeg is missing.
 *
 * Run: node web/scripts/media/process-media.mjs
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaDir = path.resolve(__dirname, "../../public/media");
// sharp ships with Next; resolve through the workspace pnpm store.
const require = createRequire(
  path.resolve(__dirname, "../../../node_modules/.pnpm/node_modules/sharp/package.json"),
);
const sharp = require("sharp");

const IMAGE_MAP = [
  { from: "location1.png", to: "coast-road.webp" },
  { from: "location2.png", to: "lisbon-tram.webp" },
  { from: "location3.png", to: "beach-cabana.webp" },
  { from: "location4.png", to: "japan-lantern-street.webp" },
  { from: "planning.png", to: "friends-planning.webp" },
  { from: "water_bg.png", to: "water-texture.webp" },
];

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function convertImage(fromName, toName) {
  const input = path.join(mediaDir, fromName);
  const output = path.join(mediaDir, toName);
  if (!existsSync(input)) {
    if (existsSync(output)) {
      console.log(`skip ${fromName} (already have ${toName})`);
      return;
    }
    throw new Error(`Missing ${fromName}`);
  }
  await sharp(input)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output);
  unlinkSync(input);
  const kb = Math.round(statSync(output).size / 1024);
  console.log(`${fromName} → ${toName} (${kb} KB)`);
}

function processVideo() {
  const candidates = ["Hero-loop.mp4", "hero-loop.mp4"];
  const found = candidates.find((name) => existsSync(path.join(mediaDir, name)));
  if (!found) throw new Error("Missing Hero-loop.mp4");

  const src = path.join(mediaDir, found);
  const dest = path.join(mediaDir, "hero-loop.mp4");
  if (found !== "hero-loop.mp4") {
    // Windows is case-insensitive: Hero-loop.mp4 and hero-loop.mp4 collide on rename.
    const tmpName = path.join(mediaDir, `hero-loop-rename-${Date.now()}.mp4`);
    renameSync(src, tmpName);
    renameSync(tmpName, dest);
  }

  const sizeMb = (statSync(dest).size / (1024 * 1024)).toFixed(1);
  if (!hasFfmpeg()) {
    console.log(`ffmpeg not found; keeping hero-loop.mp4 at ${sizeMb} MB (no re-encode)`);
    const posterFromCoast = path.join(mediaDir, "coast-road.webp");
    const poster = path.join(mediaDir, "hero-poster.webp");
    if (existsSync(posterFromCoast) && !existsSync(poster)) {
      copyFileSync(posterFromCoast, poster);
      console.log("hero-poster.webp copied from coast-road.webp");
    }
    return { reencoded: false, sizeMb };
  }

  const tmp = path.join(mediaDir, "hero-loop.tmp.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      dest,
      "-an",
      "-vf",
      "scale='min(1920,iw)':-2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-crf",
      "28",
      tmp,
    ],
    { stdio: "inherit" },
  );
  unlinkSync(dest);
  renameSync(tmp, dest);
  const poster = path.join(mediaDir, "hero-poster.webp");
  const frame = path.join(mediaDir, "hero-frame.png");
  execFileSync("ffmpeg", ["-y", "-i", dest, "-frames:v", "1", frame], { stdio: "inherit" });
  // Convert frame via sharp in the caller — sync path here uses copy if convert fails later.
  console.log(`re-encoded hero-loop.mp4 to ${(statSync(dest).size / (1024 * 1024)).toFixed(1)} MB`);
  return { reencoded: true, sizeMb, frame };
}

mkdirSync(mediaDir, { recursive: true });
for (const { from, to } of IMAGE_MAP) {
  await convertImage(from, to);
}
const video = processVideo();
if (video.frame && existsSync(video.frame)) {
  await sharp(video.frame)
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(mediaDir, "hero-poster.webp"));
  unlinkSync(video.frame);
  console.log("hero-poster.webp from first frame");
}

console.log("Done. Files:", readdirSync(mediaDir).join(", "));
