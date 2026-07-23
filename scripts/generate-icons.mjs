import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../assets/solmicroscope.webp", import.meta.url));
const trimmed = await sharp(source)
  .flatten({ background: "#ffffff" })
  .trim({ background: "#ffffff", threshold: 10 })
  .webp({ quality: 94 })
  .toBuffer();

async function square(size, paddingRatio, destination) {
  const padding = Math.round(size * paddingRatio);
  const mark = await sharp(trimmed)
    .resize(size - padding * 2, size - padding * 2, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(destination);
}

await sharp(source).resize(512, 512, { fit: "contain", background: "#ffffff" }).webp({ quality: 92 }).toFile("public/logo.webp");
await square(96, 0.08, "public/brandmark.png");
await square(192, 0.12, "public/icon192.png");
await square(512, 0.12, "public/icon512.png");
await square(180, 0.12, "public/appleicon.png");
await square(32, 0.08, "public/favicon.png");
