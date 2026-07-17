#!/usr/bin/env node

/**
 * blogphoto.js
 *
 * Converts a folder of photos (HEIC/HEIF/JPG/PNG straight from Google Photos)
 * into blog-ready, correctly-named, compressed JPG/PNG files.
 *
 * Usage:
 *   node blogphoto.js "My Blog Post Title" ./input-folder [./output-folder]
 *
 * Options:
 *   --quality <1-100>   JPEG quality (default 82, similar visual result to TinyJPG)
 *   --max-width <px>    Resize down if wider than this (default: no resize)
 *   --order <name|date> Sort photos by filename or by file modified date (default: name)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const convert = require('heic-convert');

const SUPPORTED = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png']);

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { quality: 82, maxWidth: null, order: 'name' };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--quality') { opts.quality = parseInt(args[++i], 10); }
    else if (a === '--max-width') { opts.maxWidth = parseInt(args[++i], 10); }
    else if (a === '--order') { opts.order = args[++i]; }
    else { positional.push(a); }
  }

  const [title, inputDir, outputDir] = positional;
  if (!title || !inputDir) {
    console.error(`
Usage:
  node blogphoto.js "My Blog Post Title" ./input-folder [./output-folder]

Options:
  --quality <1-100>    JPEG quality (default: 82)
  --max-width <px>      Resize if wider than this (default: no resize)
  --order <name|date>   Sort order for numbering (default: name)
`);
    process.exit(1);
  }

  opts.title = title;
  opts.inputDir = inputDir;
  opts.customOutputDir = outputDir || null; // resolved after slug is computed
  return opts;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function getFiles(dir, order) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .filter(e => SUPPORTED.has(path.extname(e.name).toLowerCase()))
    .map(e => path.join(dir, e.name));

  if (order === 'date') {
    entries.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  } else {
    entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }
  return entries;
}

function detectRealFormat(buffer) {
  // Sniff the actual file contents rather than trusting the extension.
  // Some exports (e.g. Google Photos) keep a .HEIC filename even after
  // the file has already been converted to JPEG.
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return 'heic';
  }
  return 'unknown';
}

async function loadAsSharp(filePath) {
  const inputBuffer = fs.readFileSync(filePath);
  const realFormat = detectRealFormat(inputBuffer);

  if (realFormat === 'heic') {
    const outputBuffer = await convert({ buffer: inputBuffer, format: 'PNG' }); // PNG preserves quality for the intermediate step
    return sharp(outputBuffer);
  }
  if (realFormat === 'jpeg' || realFormat === 'png') {
    return sharp(inputBuffer);
  }
  // Unknown signature: let sharp try anyway and surface its error if it fails.
  return sharp(inputBuffer);
}

async function processOne(filePath, outPath, opts) {
  const img = await loadAsSharp(filePath);
  const meta = await img.metadata();

  // Orientation values 5-8 mean the stored pixel width/height are swapped
  // relative to how the photo should actually display.
  const swapped = meta.orientation && meta.orientation >= 5 && meta.orientation <= 8;
  const displayWidth = swapped ? meta.height : meta.width;

  // .rotate() with no args bakes the EXIF orientation into the actual pixels.
  // Without this, compressing strips the orientation tag (as we do, since we
  // don't call withMetadata()) while leaving the pixels sideways/upside-down.
  let pipeline = img.rotate();

  if (opts.maxWidth && displayWidth > opts.maxWidth) {
    pipeline = pipeline.resize({ width: opts.maxWidth });
  }

  // Some HEIC photos (notably from iPhone Portrait/Live Photo modes) carry an
  // alpha channel that is fully opaque - a leftover from depth processing,
  // not real transparency. Treating "has a channel" as "needs PNG" wastes a
  // huge amount of space on ordinary photos, since PNG is a poor fit for
  // photographic content. So we check whether the channel is actually used.
  let needsAlpha = false;
  if (meta.hasAlpha) {
    const stats = await img.clone().stats();
    const alphaChannel = stats.channels[stats.channels.length - 1];
    needsAlpha = alphaChannel.min < 255;
  }

  let finalPath = outPath;

  if (needsAlpha) {
    finalPath = outPath.replace(/\.jpg$/i, '.png');
    pipeline = pipeline.png({ quality: opts.quality, compressionLevel: 9, palette: true });
  } else {
    pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: opts.quality, mozjpeg: true });
  }

  await pipeline.toFile(finalPath);
  return finalPath;
}

function moveOriginal(filePath, inputDir) {
  const deleteDir = path.join(inputDir, 'converted-ready-for-delete');
  fs.mkdirSync(deleteDir, { recursive: true });
  const dest = path.join(deleteDir, path.basename(filePath));
  try {
    fs.renameSync(filePath, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Source and destination are on different filesystems (can happen with
      // some network/shared mounts) - fall back to copy + delete.
      fs.copyFileSync(filePath, dest);
      fs.unlinkSync(filePath);
    } else {
      throw err;
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const slug = slugify(opts.title);
  opts.outputDir = opts.customOutputDir || path.join(opts.inputDir, 'converted', slug);

  if (!fs.existsSync(opts.inputDir)) {
    console.error(`Input folder not found: ${opts.inputDir}`);
    process.exit(1);
  }
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const files = await getFiles(opts.inputDir, opts.order);
  if (files.length === 0) {
    console.error(`No supported photos (HEIC/HEIF/JPG/PNG) found in ${opts.inputDir}`);
    process.exit(1);
  }

  console.log(`\nFound ${files.length} photo(s). Converting for post: "${opts.title}" -> slug "${slug}"\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let successCount = 0;
  const failures = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const willBeMultiple = files.length > 1;

    try {
      const before = fs.statSync(file).size;
      const suffix = willBeMultiple ? `-${successCount + 1}` : '';
      const outPath = path.join(opts.outputDir, `${slug}${suffix}.jpg`);

      const finalPath = await processOne(file, outPath, opts);
      const after = fs.statSync(finalPath).size;

      moveOriginal(file, opts.inputDir);

      totalBefore += before;
      totalAfter += after;
      successCount++;

      const savedPct = (((before - after) / before) * 100).toFixed(0);
      console.log(
        `  ${path.basename(file).padEnd(28)} -> ${path.basename(finalPath).padEnd(28)} ` +
        `${humanSize(before).padStart(9)} -> ${humanSize(after).padStart(9)}  (-${savedPct}%)`
      );
    } catch (err) {
      failures.push({ file, message: err.message });
      console.log(`  ${path.basename(file).padEnd(28)} -> SKIPPED (${err.message})`);
    }
  }

  const totalSavedPct = totalBefore > 0 ? (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(0) : 0;
  console.log(`\nDone. ${humanSize(totalBefore)} -> ${humanSize(totalAfter)} total (-${totalSavedPct}%)`);
  if (successCount > 0) {
    console.log(`Originals moved to: ${path.join(opts.inputDir, 'converted-ready-for-delete')}`);
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} file(s) skipped:`);
    failures.forEach(f => console.log(`  - ${path.basename(f.file)}: ${f.message}`));
  }
  console.log(`Output folder: ${path.resolve(opts.outputDir)}\n`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
