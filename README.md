# blogphoto

A one-command CLI that converts a folder of photos straight from Google Photos
(HEIC, HEIF, JPG, or PNG) into blog-ready files: converted, compressed
(TinyJPG/TinyPNG-comparable, using mozjpeg/pngquant under the hood), and
correctly named for a specific post.

Runs entirely on your machine (e.g. your Chromebook's Crostini Linux
environment) — nothing is uploaded anywhere.

## Setup (one time)

In your Crostini terminal:

```bash
# Node.js, if you don't already have it
sudo apt update && sudo apt install -y nodejs npm

# unzip this project somewhere, then:
cd blogphoto
npm install
```

## Usage

```bash
node blogphoto.js "My Blog Post Title" ./path/to/downloaded/photos
```

That's it. It will:
1. Read every HEIC/HEIF/JPG/PNG file in the input folder
2. Convert HEIC/HEIF to JPG (or PNG if the image has transparency)
3. Compress it (quality 82 JPEG w/ mozjpeg, or palette PNG w/ pngquant-style compression — visually near-lossless, similar to TinyJPG/TinyPNG)
4. Save into `./path/to/downloaded/photos/converted/<post-slug>/` named after your post title:
   - One photo: `my-blog-post-title.jpg`
   - Multiple photos: `my-blog-post-title-1.jpg`, `my-blog-post-title-2.jpg`, `my-blog-post-title-3.jpg`, in filename order

### Example

```bash
node blogphoto.js "My Amazing Trip to Italy!" ~/Downloads/italy-photos
```

Output:
```
Found 3 photo(s). Converting for post: "My Amazing Trip to Italy!" -> slug "my-amazing-trip-to-italy"

  IMG_4821.HEIC  -> my-amazing-trip-to-italy-1.jpg   4.2 MB ->  680 KB  (-84%)
  IMG_4822.HEIC  -> my-amazing-trip-to-italy-2.jpg   3.9 MB ->  610 KB  (-84%)
  IMG_4823.HEIC  -> my-amazing-trip-to-italy-3.jpg   4.5 MB ->  720 KB  (-84%)

Done. 12.6 MB -> 2.0 MB total (-84%)
Output folder: /home/you/Downloads/italy-photos/converted/my-amazing-trip-to-italy
```

Then just drag the files from that `converted/<post-slug>/` folder into your blog's media uploader.

## Options

```bash
node blogphoto.js "Title" ./input [./output] [options]
```

| Flag | Default | Description |
|---|---|---|
| `--quality <1-100>` | `82` | JPEG/PNG compression quality. Lower = smaller files, more compression artifacts. 80–85 is a good TinyJPG-like sweet spot. |
| `--max-width <px>` | none (keeps original size) | Resize down if the photo is wider than this. Handy if your camera shoots huge originals and you don't need full resolution on the blog (e.g. `--max-width 2000`). |
| `--order <name\|date>` | `name` | Order used for numbering multiple photos. `name` sorts by filename (e.g. IMG_001, IMG_002...), `date` sorts by file modified time — useful if your filenames aren't sequential. |

Example with options:

```bash
node blogphoto.js "Weekend in the Alps" ~/Downloads/alps --quality 85 --max-width 2000 --order date
```

## Notes

- An optional third argument sets a custom output folder: `node blogphoto.js "Title" ./in ./out`
- Photos with transparency (rare for regular photos, common for screenshots/graphics) are kept as PNG automatically; everything else becomes JPG.
- Re-running with the same title overwrites previous output files, so you can tweak `--quality` and re-run until you're happy.
- The script checks each file's actual contents rather than trusting its extension — useful because Google Photos sometimes exports files that are already JPEGs but still named `.HEIC`.
- If a file can't be processed (corrupted, unsupported format, etc.), it's skipped with a message rather than stopping the whole batch. Skipped files are listed again at the end.
- Once a photo is successfully converted, the original is moved into `<input-folder>/converted-ready-for-delete/` — so your input folder ends up containing only the leftovers (anything skipped) plus that folder, which you can review and delete whenever you're happy with the results. Nothing is ever deleted automatically.
