import argparse
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageOps


SUPPORTED_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")


@dataclass(frozen=True)
class ImageConversionResult:
    output_path: Path
    page_count: int
    skipped_files: tuple[str, ...]
    duration_seconds: float


def ensure_pdf_suffix(path: str | Path) -> Path:
    output = Path(path).expanduser()
    if output.suffix.lower() != ".pdf":
        output = output.with_suffix(".pdf")
    return output


def normalize_extensions(extensions: Sequence[str] | str | None = None) -> tuple[str, ...]:
    if not extensions:
        return SUPPORTED_IMAGE_EXTENSIONS

    if isinstance(extensions, str):
        raw_extensions = re.split(r"[,;\s]+", extensions)
    else:
        raw_extensions = extensions

    normalized: list[str] = []
    for ext in raw_extensions:
        value = str(ext).strip().lower()
        if not value:
            continue
        if not value.startswith("."):
            value = f".{value}"
        normalized.append(value)

    return tuple(dict.fromkeys(normalized)) or SUPPORTED_IMAGE_EXTENSIONS


def natural_sort_key(path: str | Path) -> list[object]:
    text = str(path)
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def discover_images(
    inputs: Sequence[str | Path] | str | Path | None = None,
    extensions: Sequence[str] | str | None = None,
    recursive: bool = False,
) -> list[Path]:
    if inputs is None or inputs == "":
        candidates: Iterable[str | Path] = [Path.cwd()]
    elif isinstance(inputs, (str, Path)):
        candidates = [inputs]
    else:
        candidates = inputs

    allowed_extensions = normalize_extensions(extensions)
    files: list[Path] = []
    seen: set[Path] = set()

    for item in candidates:
        path = Path(item).expanduser()
        if path.is_file():
            if path.suffix.lower() in allowed_extensions and path.stat().st_size > 0:
                resolved = path.resolve()
                if resolved not in seen:
                    seen.add(resolved)
                    files.append(path)
            continue

        if not path.is_dir():
            continue

        iterator = path.rglob("*") if recursive else path.glob("*")
        for child in iterator:
            if (
                child.is_file()
                and child.suffix.lower() in allowed_extensions
                and child.stat().st_size > 0
            ):
                resolved = child.resolve()
                if resolved not in seen:
                    seen.add(resolved)
                    files.append(child)

    return sorted(files, key=natural_sort_key)


def _open_pdf_image(path: Path) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
            canvas = Image.new("RGB", image.size, "white")
            alpha = image.convert("RGBA").getchannel("A")
            canvas.paste(image.convert("RGBA"), mask=alpha)
            return canvas
        if image.mode != "RGB":
            image = image.convert("RGB")
        return image.copy()


def convert_images_to_pdf(
    image_paths: Sequence[str | Path],
    output_pdf_path: str | Path,
    *,
    resolution: float = 100.0,
    quality: int = 95,
    strict: bool = False,
) -> ImageConversionResult:
    start_time = time.time()
    output_path = ensure_pdf_suffix(output_pdf_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not image_paths:
        raise ValueError("未匹配到任何可用图片文件。")

    images: list[Image.Image] = []
    skipped: list[str] = []

    for raw_path in image_paths:
        path = Path(raw_path).expanduser()
        try:
            images.append(_open_pdf_image(path))
        except Exception as exc:
            message = f"{path}: {exc}"
            if strict:
                raise RuntimeError(f"图片读取失败: {message}") from exc
            skipped.append(message)

    if not images:
        raise RuntimeError("所有图片读取失败，未生成 PDF。")

    try:
        first_image, *other_images = images
        first_image.save(
            output_path,
            "PDF",
            save_all=True,
            append_images=other_images,
            resolution=resolution,
            quality=quality,
        )
    finally:
        for image in images:
            image.close()

    return ImageConversionResult(
        output_path=output_path,
        page_count=len(images),
        skipped_files=tuple(skipped),
        duration_seconds=time.time() - start_time,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="将图片文件或文件夹转换为 PDF。")
    parser.add_argument("inputs", nargs="*", help="图片文件或文件夹，省略时使用当前目录")
    parser.add_argument("-o", "--output", default="result.pdf", help="输出 PDF 路径")
    parser.add_argument("-e", "--ext", default=None, help="限制图片后缀，例如 jpg,png")
    parser.add_argument("-r", "--recursive", action="store_true", help="递归扫描文件夹")
    parser.add_argument("--resolution", type=float, default=100.0, help="PDF 图片分辨率")
    parser.add_argument("--quality", type=int, default=95, help="PDF 图片质量，默认 95")
    parser.add_argument("--strict", action="store_true", help="任一图片读取失败即终止")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    image_paths = discover_images(args.inputs or None, args.ext, args.recursive)
    print(f"待处理图片: {len(image_paths)}")

    result = convert_images_to_pdf(
        image_paths,
        args.output,
        resolution=args.resolution,
        quality=args.quality,
        strict=args.strict,
    )

    print(f"输出文件: {result.output_path}")
    print(f"写入页数: {result.page_count}")
    if result.skipped_files:
        print("跳过文件:")
        for item in result.skipped_files:
            print(f"  - {item}")
    print(f"耗时: {result.duration_seconds:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
