import sharp from 'sharp';

/** Generates fixture images in memory so no binary files live in the repo. */
export async function makeFixtures() {
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
      <defs><linearGradient id="g"><stop offset="0" stop-color="#e63946"/><stop offset="1" stop-color="#1d3557"/></linearGradient></defs>
      <rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="300" r="180" fill="#f1faee"/>
    </svg>`,
  );

  const jpeg = await sharp(gradient).jpeg({ quality: 95 }).toBuffer(); // 800x600
  const png = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 4,
      background: { r: 0, g: 128, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer(); // 400x300 with alpha

  // Stored as 600x800 pixels with EXIF orientation 6 (rotate 90deg CW) -> displays as 800x600.
  const rotatedJpeg = await sharp(jpeg)
    .rotate(-90)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  // Two-frame animated GIF, 100x80 per frame.
  const frame = (color: string) =>
    sharp({ create: { width: 100, height: 80, channels: 3, background: color } })
      .png()
      .toBuffer();
  const animatedGif = await sharp([await frame('#ff0000'), await frame('#0000ff')], {
    join: { animated: true },
  })
    .gif({ loop: 0 })
    .toBuffer();

  return { jpeg, png, rotatedJpeg, animatedGif, svg: gradient };
}
