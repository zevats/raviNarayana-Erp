import fs from "fs";
import path from "path";
import zlib from "zlib";

// PNG generator using raw buffers and zlib deflate
function createPng(width, height, drawFn) {
  // RGBA buffer
  const rawData = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[idx] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = a;
    }
  }

  // Prepend filter byte 0 (None) to each scanline
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (1 + width * 4);
    scanlines[scanlineOffset] = 0; // Filter None
    rawData.copy(
      scanlines,
      scanlineOffset + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const deflated = zlib.deflateSync(scanlines);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  function createChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const crcBuf = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crcVal, 0);

    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // Basic CRC32 implementation
  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c;
      }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  const ihdrChunk = createChunk("IHDR", ihdr);
  const idatChunk = createChunk("IDAT", deflated);
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Draw Ravi Narayana emblem
function drawEmblem(x, y, w, h, isMaskable = false) {
  // Brand colors
  const forestR = 0x1A, forestG = 0x2E, forestB = 0x20; // #1A2E20
  const brassR = 0xB5, brassG = 0x8A, brassB = 0x57;   // #B58A57
  const ivoryR = 0xFA, ivoryG = 0xF8, ivoryB = 0xF5;   // #FAF8F5
  const emeraldR = 0x5D, emeraldG = 0x76, emeraldB = 0x56; // #5D7656

  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background: Deep Forest
  let r = forestR;
  let g = forestG;
  let b = forestB;
  let a = 255;

  const outerRadius = isMaskable ? w * 0.40 : w * 0.44;
  const innerRadius = isMaskable ? w * 0.38 : w * 0.42;

  // Outer decorative gold ring
  if (dist >= innerRadius && dist <= outerRadius) {
    return [brassR, brassG, brassB, 255];
  }

  // Inner subtle decorative circle
  const coreRadius = isMaskable ? w * 0.34 : w * 0.37;
  if (dist < coreRadius && dist > coreRadius - (w * 0.008)) {
    return [brassR, brassG, brassB, 180];
  }

  // Stylized Monogram / Botanical Center
  // Draw an elegant symmetrical center emblem
  const nx = (x - cx) / (w * 0.25);
  const ny = (y - cy) / (h * 0.25);

  // Left vertical pillar of "R" / Leaf
  if (nx >= -0.55 && nx <= -0.35 && ny >= -0.55 && ny <= 0.55) {
    return [ivoryR, ivoryG, ivoryB, 255];
  }
  // Upper loop of "R"
  const loopDist = Math.sqrt((nx + 0.2) * (nx + 0.2) + (ny + 0.25) * (ny + 0.25));
  if (loopDist <= 0.35 && loopDist >= 0.18 && nx >= -0.4) {
    return [ivoryR, ivoryG, ivoryB, 255];
  }
  // Right diagonal leg of "R"
  if (nx >= -0.35 && nx <= 0.2 && ny >= 0.0 && ny <= 0.55) {
    const legLine = (ny - 0.0) / 0.55 * 0.45 - 0.35;
    if (Math.abs(nx - legLine) < 0.12) {
      return [ivoryR, ivoryG, ivoryB, 255];
    }
  }

  // Right Pillar / "N" motif
  if (nx >= 0.35 && nx <= 0.55 && ny >= -0.55 && ny <= 0.55) {
    return [brassR, brassG, brassB, 255];
  }
  // Diagonal of "N"
  if (nx >= 0.0 && nx <= 0.45 && ny >= -0.55 && ny <= 0.55) {
    const diagLine = (ny + 0.55) / 1.1 * 0.45;
    if (Math.abs(nx - diagLine) < 0.1) {
      return [brassR, brassG, brassB, 255];
    }
  }

  // Small leaf accent on top
  if (Math.abs(nx) < 0.12 && ny >= -0.8 && ny <= -0.6) {
    return [emeraldR, emeraldG, emeraldB, 255];
  }

  return [r, g, b, a];
}

const outDir = path.resolve(process.cwd(), "apps/erp/public/icons");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Generate 192x192
const png192 = createPng(192, 192, (x, y, w, h) => drawEmblem(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, "icon-192.png"), png192);
console.log("Wrote icon-192.png (" + png192.length + " bytes)");

// Generate 512x512
const png512 = createPng(512, 512, (x, y, w, h) => drawEmblem(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, "icon-512.png"), png512);
console.log("Wrote icon-512.png (" + png512.length + " bytes)");

// Generate Maskable 512x512
const pngMaskable512 = createPng(512, 512, (x, y, w, h) => drawEmblem(x, y, w, h, true));
fs.writeFileSync(path.join(outDir, "maskable-icon-512.png"), pngMaskable512);
console.log("Wrote maskable-icon-512.png (" + pngMaskable512.length + " bytes)");

// Generate Apple Touch Icon 180x180
const pngApple180 = createPng(180, 180, (x, y, w, h) => drawEmblem(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), pngApple180);
console.log("Wrote apple-touch-icon.png (" + pngApple180.length + " bytes)");
