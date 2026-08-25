---
name: pdf-tool-skill
description: Use the bundled pure-Python PDFToolSkill to convert images to PDF and inspect, merge, insert, delete, replace, rotate, or split PDF pages. Apply when a task requires deterministic local PDF page operations through index.py; do not use it for OCR, text editing, annotations, forms, compression, or visual redesign.
---

# PDFToolSkill

Use the bundled `index.py` entrypoint for deterministic local PDF page operations. Preserve source files and write results to a separate output path.

## Requirements

- Run with Python 3.10 or newer.
- Require `pypdf` for PDF operations.
- Require Pillow (`PIL`) for image-to-PDF conversion.
- Treat all page numbers as **1-based**.
- Resolve all input and output paths explicitly. Quote paths containing spaces.
- Never use an input file itself as the output path. The scripts do not provide transactional in-place editing.
- Do not install missing dependencies or access the network unless the user authorizes it.

The entrypoint is located beside this file:

```bash
python3 /absolute/path/to/PDFToolSkill/index.py --help
```

## Workflow

1. Determine the requested operation and identify every input, output, page selection, and password requirement.
2. If page counts or encryption status are unknown, run `info` before editing.
3. Choose a new output path unless the user already supplied one.
4. Run the corresponding command through `index.py`.
5. Check the exit status and reported output path/page count.
6. Run `info` on the output. When page order or visual fidelity matters, also inspect or render the output with an available PDF viewer or renderer.
7. Report the output path, resulting page count, and any skipped images or limitations.

Do not suppress command errors. Return the actionable error to the user when a file is missing, encrypted, unreadable, or a page selection is invalid.

## Page Selection Syntax

Use these forms wherever a command accepts `--pages` or a source suffix:

| Syntax | Meaning |
| --- | --- |
| `1` | Page 1 |
| `1,3,5` | Pages 1, 3, and 5 in that order |
| `2-5` | Pages 2 through 5 |
| `5-2` | Pages 5 through 2 in reverse order |
| `-3` | Pages 1 through 3 |
| `3-` | Page 3 through the last page |
| `all` | Every page |
| `end` or `last` | The last page |

Page expressions accept ASCII or Chinese commas. Invalid or out-of-range pages fail the operation instead of being ignored.

For PDF source arguments, append a page expression after the path:

```text
/path/source.pdf:1,3-5
```

Quote the entire argument when the path contains spaces:

```bash
"/path/My File.pdf:1,3-5"
```

Use numeric ranges in a source suffix. Standalone `:all`, `:end`, and `:last` are supported; composite suffixes containing words such as `:1-end` are not.

## Operations

### Inspect PDF Information

Use `info` to report page count and encryption status without changing the file.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py info \
  "/path/input.pdf" \
  "/path/other.pdf"
```

For encrypted input:

```bash
python3 /absolute/path/to/PDFToolSkill/index.py info \
  "/path/input.pdf" \
  --password "PASSWORD"
```

### Convert Images to PDF

Use `images` with image files, directories, or both.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py images \
  "/path/images" \
  --output "/path/output.pdf"
```

Options:

- `--ext jpg,png`: restrict extensions.
- `--recursive`: scan subdirectories.
- `--resolution 100`: set PDF image resolution metadata.
- `--quality 95`: set output image quality.
- `--strict`: fail on the first unreadable image. Without it, unreadable images are skipped and reported.

Supported extensions are JPG, JPEG, PNG, BMP, WebP, TIFF, and TIF. EXIF orientation is applied, transparent images are flattened onto white, and page order uses natural sorting by full path. Do not assume command-line input order is preserved when arbitrary manual ordering is required.

### Merge PDFs or Selected Pages

Use `merge` to concatenate sources in the specified source order. Use a source suffix to select or reorder pages.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py merge \
  "/path/A.pdf:1,3-5" \
  "/path/B.pdf" \
  --output "/path/merged.pdf"
```

`--password` supplies one shared password for all encrypted merge sources. The CLI does not support different passwords for different merge inputs.

### Insert a PDF

Use `insert` to place all or selected pages from a source PDF before or after an existing target page.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py insert \
  "/path/target.pdf" \
  "/path/source.pdf:2-4" \
  --page 3 \
  --where after \
  --output "/path/inserted.pdf"
```

- `--page` accepts an existing target page number, `end`, or `last`.
- `--where` is `before` or `after`; it defaults to `after`.
- To insert at the beginning, use `--page 1 --where before`.
- To append, use `--page end --where after`.
- Use `--target-password` and `--source-password` independently when needed.

Expected output page count is target pages plus selected source pages.

### Delete Pages

Use `delete` to remove one or more pages from a PDF.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py delete \
  "/path/input.pdf" \
  --pages "2,4-6" \
  --output "/path/deleted.pdf"
```

Duplicate selected page numbers are deleted once. The command refuses to delete every page; at least one page must remain. Use `--password` for encrypted input.

### Replace Consecutive Pages

Use `replace` to replace a consecutive block in the target with all or selected pages from another PDF.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py replace \
  "/path/target.pdf" \
  "/path/replacement.pdf:1-3" \
  --start-page 5 \
  --output "/path/replaced.pdf"
```

The number of target pages removed equals the number of selected replacement pages. For example, three selected replacement pages starting at target page 5 replace target pages 5, 6, and 7. The operation fails if that block extends past the target's last page. A successful replacement preserves the target's total page count.

Use `--target-password` and `--source-password` independently when needed. `--start-page` accepts a target page number, `end`, or `last`; using the last page is valid only when one replacement page is selected.

### Rotate Pages

Use `rotate` with an angle that is a multiple of 90. Omit `--pages` to rotate every page.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py rotate \
  "/path/input.pdf" \
  --angle 90 \
  --pages "2,4-6" \
  --output "/path/rotated.pdf"
```

Use `--password` for encrypted input. Rotation preserves page count and page order.

### Split Pages into Individual PDFs

Use `split` to create one single-page PDF for each selected page.

```bash
python3 /absolute/path/to/PDFToolSkill/index.py split \
  "/path/input.pdf" \
  --pages "1,3-5" \
  --output-dir "/path/split-pages" \
  --prefix "document"
```

Without `--pages`, every page is split. Files are named `<prefix>_page_NNN.pdf`; the input filename stem is used when `--prefix` is omitted. Use `--password` for encrypted input.

## Python API

Prefer `index.py` for ordinary tasks because its interface is stable and produces consistent status output. When integrating this project into another Python script, import the public helpers from `utils.modifyPDF` and `utils.convertIMG`:

- `merge_pdfs`
- `insert_pdf`
- `delete_pages_from_pdf`
- `replace_pdf`
- `rotate_pdf`
- `split_pdf`
- `get_pdf_info`
- `discover_images`
- `convert_images_to_pdf`

Use named arguments for page positions, selections, passwords, and output paths. Do not call underscore-prefixed helpers directly.

## Boundaries

This skill changes PDF page composition only. It does not provide OCR, text or image extraction, content editing, annotations, watermarks, signatures, form filling, metadata editing, encryption changes, compression, repair, or visual page rendering. Use another suitable PDF tool when the requested task falls outside these capabilities.

