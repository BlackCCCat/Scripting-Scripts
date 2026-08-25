import argparse
from pathlib import Path
from typing import Sequence

from utils.convertIMG import convert_images_to_pdf, discover_images
from utils.modifyPDF import (
    delete_pages_from_pdf,
    get_pdf_info,
    insert_pdf,
    merge_pdfs,
    parse_source_argument,
    replace_pdf,
    rotate_pdf,
    split_pdf,
)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="PDFToolSkill",
        description="纯 Python PDF 工具：图片转 PDF、PDF 合并选页、插入、删除、替换、旋转、拆分和信息查看。",
    )
    subparsers = parser.add_subparsers(dest="command")

    image_parser = subparsers.add_parser("images", help="将图片转换为 PDF")
    image_parser.add_argument("inputs", nargs="*", help="图片文件或文件夹，省略时使用当前目录")
    image_parser.add_argument("-o", "--output", default="result.pdf", help="输出 PDF 路径")
    image_parser.add_argument("-e", "--ext", default=None, help="限制图片后缀，例如 jpg,png")
    image_parser.add_argument("-r", "--recursive", action="store_true", help="递归扫描文件夹")
    image_parser.add_argument("--resolution", type=float, default=100.0, help="PDF 图片分辨率")
    image_parser.add_argument("--quality", type=int, default=95, help="PDF 图片质量，默认 95")
    image_parser.add_argument("--strict", action="store_true", help="任一图片读取失败即终止")

    merge_parser = subparsers.add_parser("merge", help="合并 PDF，支持 path.pdf:1,3-5 选页")
    merge_parser.add_argument("sources", nargs="+", help="PDF 路径，可追加 :页码表达式")
    merge_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    merge_parser.add_argument("--password", default=None, help="加密 PDF 密码")

    insert_parser = subparsers.add_parser("insert", help="将一个 PDF 插入到另一个 PDF 的指定页前后")
    insert_parser.add_argument("target", help="目标 PDF 路径")
    insert_parser.add_argument("source", help="待插入 PDF 路径，可追加 :页码表达式")
    insert_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    insert_parser.add_argument("--page", required=True, help="参考页码，可用数字、end 或 last")
    insert_parser.add_argument(
        "--where",
        choices=["before", "after"],
        default="after",
        help="插入到参考页之前或之后，默认 after",
    )
    insert_parser.add_argument("--target-password", default=None, help="目标 PDF 密码")
    insert_parser.add_argument("--source-password", default=None, help="插入 PDF 密码")

    delete_parser = subparsers.add_parser("delete", help="删除 PDF 的一个或多个页面")
    delete_parser.add_argument("input", help="输入 PDF 路径")
    delete_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    delete_parser.add_argument("--pages", required=True, help="要删除的页码表达式")
    delete_parser.add_argument("--password", default=None, help="加密 PDF 密码")

    replace_parser = subparsers.add_parser("replace", help="用一个 PDF 替换另一个 PDF 中连续的若干页")
    replace_parser.add_argument("target", help="目标 PDF 路径")
    replace_parser.add_argument("source", help="替换用 PDF 路径，可追加 :页码表达式")
    replace_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    replace_parser.add_argument("--start-page", required=True, help="替换起始页，可用数字、end 或 last")
    replace_parser.add_argument("--target-password", default=None, help="目标 PDF 密码")
    replace_parser.add_argument("--source-password", default=None, help="替换 PDF 密码")

    rotate_parser = subparsers.add_parser("rotate", help="旋转 PDF 页面")
    rotate_parser.add_argument("input", help="输入 PDF 路径")
    rotate_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    rotate_parser.add_argument("--angle", type=int, required=True, help="旋转角度，必须是 90 的倍数")
    rotate_parser.add_argument("--pages", default=None, help="页码表达式，默认全部")
    rotate_parser.add_argument("--password", default=None, help="加密 PDF 密码")

    split_parser = subparsers.add_parser("split", help="按页拆分 PDF")
    split_parser.add_argument("input", help="输入 PDF 路径")
    split_parser.add_argument("-o", "--output-dir", required=True, help="输出目录")
    split_parser.add_argument("--pages", default=None, help="页码表达式，默认全部")
    split_parser.add_argument("--prefix", default=None, help="输出文件名前缀")
    split_parser.add_argument("--password", default=None, help="加密 PDF 密码")

    info_parser = subparsers.add_parser("info", help="查看 PDF 基本信息")
    info_parser.add_argument("inputs", nargs="+", help="PDF 路径")
    info_parser.add_argument("--password", default=None, help="加密 PDF 密码")

    return parser


def run(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == "images":
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

    if args.command == "merge":
        result = merge_pdfs(
            [parse_source_argument(source) for source in args.sources],
            args.output,
            password=args.password,
        )
        print(f"输出文件: {result.output_path}")
        print(f"写入页数: {result.page_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")
        return 0

    if args.command == "insert":
        source_path, insert_pages = parse_source_argument(args.source)
        result = insert_pdf(
            args.target,
            source_path,
            args.output,
            page=args.page,
            where=args.where,
            target_password=args.target_password,
            insert_password=args.source_password,
            insert_pages=insert_pages,
        )
        print(f"输出文件: {result.output_path}")
        print(f"写入页数: {result.page_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")
        return 0

    if args.command == "delete":
        result = delete_pages_from_pdf(
            args.input,
            args.output,
            pages=args.pages,
            password=args.password,
        )
        print(f"输出文件: {result.output_path}")
        print(f"写入页数: {result.page_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")
        return 0

    if args.command == "replace":
        source_path, replacement_pages = parse_source_argument(args.source)
        result = replace_pdf(
            args.target,
            source_path,
            args.output,
            start_page=args.start_page,
            target_password=args.target_password,
            replacement_password=args.source_password,
            replacement_pages=replacement_pages,
        )
        print(f"输出文件: {result.output_path}")
        print(f"写入页数: {result.page_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")
        return 0

    if args.command == "rotate":
        result = rotate_pdf(
            args.input,
            args.output,
            angle=args.angle,
            pages=args.pages,
            password=args.password,
        )
        print(f"输出文件: {result.output_path}")
        print(f"写入页数: {result.page_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")
        return 0

    if args.command == "split":
        results = split_pdf(
            args.input,
            args.output_dir,
            pages=args.pages,
            prefix=args.prefix,
            password=args.password,
        )
        print(f"输出目录: {Path(args.output_dir).expanduser()}")
        print(f"生成文件: {len(results)}")
        for result in results:
            print(f"  - {result.output_path}")
        return 0

    if args.command == "info":
        for item in get_pdf_info(args.inputs, password=args.password):
            encrypted = "是" if item.encrypted else "否"
            print(f"{item.path}: {item.page_count} 页，加密: {encrypted}")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(run())
