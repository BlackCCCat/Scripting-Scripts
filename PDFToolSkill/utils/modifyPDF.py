import argparse
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from pypdf import PdfReader, PdfWriter


PageSelection = Sequence[int] | str | None


@dataclass(frozen=True)
class PdfOperationResult:
    """
    PDF操作结果数据类
    """
    output_path: Path
    page_count: int
    duration_seconds: float


@dataclass(frozen=True)
class PdfInfo:
    """
    PDF信息数据类
    """
    path: Path
    page_count: int
    encrypted: bool


def ensure_pdf_suffix(path: str | Path) -> Path:
    """
    params:
        path: str或Path对象 PDF文件路径
    return: Path对象

    确保输出pdf文件路径后缀为.pdf
    """
    output = Path(path).expanduser()
    if output.suffix.lower() != ".pdf":
        output = output.with_suffix(".pdf")
    return output


def parse_page_selection(selection: PageSelection, total_pages: int) -> list[int]:
    """
    params:
        selection: PageSelection对象，选择的PDF页面
        total_pages: int
    return: list[int]

    解析选择的PDF页面
    """
    if total_pages < 1:
        return []

    # 未选择按全选处理，选择all也按全选处理
    if selection is None or selection == "" or str(selection).strip().lower() == "all":
        return list(range(1, total_pages + 1))

    # 如果selection不是str类型，将其转为int类型，并校验是否合法
    if not isinstance(selection, str):
        pages = [int(page) for page in selection]
        _validate_pages(pages, total_pages)
        return pages

    pages: list[int] = []
    # 按分隔符拆分页面选择
    for token in selection.replace("，", ",").split(","):
        item = token.strip().lower()
        if not item:
            continue

        if "-" in item:
            # 对区间写法进行解析
            start_text, end_text = [part.strip() for part in item.split("-", 1)]
            start = _parse_page_endpoint(start_text, total_pages, default=1)
            end = _parse_page_endpoint(end_text, total_pages, default=total_pages)
            step = 1 if start <= end else -1
            pages.extend(range(start, end + step, step))
        else:
            # 非区间写法进行解析
            pages.append(_parse_page_endpoint(item, total_pages))

    _validate_pages(pages, total_pages)
    return pages


def _parse_page_endpoint(value: str, total_pages: int, default: int | None = None) -> int:
    """
    params:
        value: str 页数值
        total_pages: int 总页数
        default: int | None 默认为None
    return: int

    解析页码，end/last解析为总页码数，其他转为数字
    """
    if not value:
        if default is None:
            raise ValueError("页码不能为空。")
        return default
    if value in {"end", "last"}:
        return total_pages
    if not value.isdigit():
        raise ValueError(f"无效页码: {value}")
    return int(value)


def _validate_pages(pages: Sequence[int], total_pages: int) -> None:
    """
    params:
        pages: Sequence[int] 页码
        total_pages: int 总页数
    return: None

    检查输入的页码是否合法
    """
    if not pages:
        raise ValueError("页码选择为空。")
    invalid = [page for page in pages if page < 1 or page > total_pages]
    if invalid:
        raise ValueError(f"页码超出范围: {invalid}，PDF 共 {total_pages} 页。")


def parse_single_page_reference(value: str | int, total_pages: int) -> int:
    """
    params:
        value: str或int 页码
        total_pages: int 总页数
    return: int

    待补充
    """
    if isinstance(value, int):
        page_number = value
    else:
        page_number = _parse_page_endpoint(str(value).strip().lower(), total_pages)
    _validate_pages([page_number], total_pages)
    return page_number


def _open_reader(path: str | Path, password: str | None = None) -> PdfReader:
    """
    params:
        path: PDF路径
        password: PDF文件的密码，默认None
    return: PdfReader对象
    """
    pdf_path = Path(path).expanduser()
    if not pdf_path.is_file():
        raise FileNotFoundError(f"找不到 PDF 文件: {pdf_path}")

    reader = PdfReader(str(pdf_path))
    if reader.is_encrypted:
        if not password:
            raise ValueError(f"PDF 已加密，需要提供密码: {pdf_path}")
        result = reader.decrypt(password)
        if result == 0:
            raise ValueError(f"PDF 密码错误或无法解密: {pdf_path}")
    return reader


class PDFSkill:
    """
    PDFSkill 类，用于读写PDF文件，同时将rotate也包含在该类中
    """
    def __init__(self) -> None:
        # 初始化writer对象
        self.writer = PdfWriter()

    # 属性装饰器
    @property
    def page_count(self) -> int:
        return len(self.writer.pages)

    def add_source(
        self,
        file_path: str | Path,
        pages: PageSelection = None,
        *,
        password: str | None = None,
    ) -> "PDFSkill":
        """
        params:
            file_path: 文件路径
            pages: 页码
            password: 文件密码
        return: 实例本身
        """
        reader = _open_reader(file_path, password)
        page_numbers = parse_page_selection(pages, len(reader.pages))
        for page_number in page_numbers:
            self.writer.add_page(reader.pages[page_number - 1])
        return self

    def rotate(self, angle: int, pages: PageSelection = None) -> "PDFSkill":
        """
        params:
            angle: 翻转角度
            pages: 页码
        return: 实例本身

        将PDF进行翻转
        """
        if angle % 90 != 0:
            raise ValueError("旋转角度必须是 90 的倍数。")
        if self.page_count == 0:
            raise ValueError("当前没有可旋转的页面。")

        page_numbers = parse_page_selection(pages, self.page_count)
        for page_number in page_numbers:
            # 翻转指定的页面
            self.writer.pages[page_number - 1].rotate(angle)
        return self

    def save(self, output_path: str | Path) -> PdfOperationResult:
        """
        params:
            output_path: 输出路径
        return: PdfOperationResult类，操作结果元数据信息

        保存结果
        """
        start_time = time.time()
        if self.page_count == 0:
            raise ValueError("没有页面可保存。")

        output = ensure_pdf_suffix(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        page_count = self.page_count

        with output.open("wb") as file:
            self.writer.write(file)

        self.writer = PdfWriter()
        return PdfOperationResult(output, page_count, time.time() - start_time)


def merge_pdfs(
    sources: Sequence[tuple[str | Path, PageSelection]],
    output_path: str | Path,
    *,
    password: str | None = None,
) -> PdfOperationResult:
    """
    params:
        sources: 输入的要合并的PDF信息，格式为(路径 页面) (路径 页面) (路径 页面)... 提问：这里的理解是否正确？如果每个文件都有密码怎么办？
        output_path: 输出路径
        password: 文件密码
    return: PdfOperationResult类，操作结果元数据信息

    用于合并PDF
    """
    start_time = time.time()
    skill = PDFSkill()
    for source_path, pages in sources:
        skill.add_source(source_path, pages, password=password)
    result = skill.save(output_path)
    return PdfOperationResult(result.output_path, result.page_count, time.time() - start_time)


def insert_pdf(
    target_path: str | Path,
    insert_source: str | Path,
    output_path: str | Path,
    *,
    page: str | int,
    where: str = "after",
    target_password: str | None = None,
    insert_password: str | None = None,
    insert_pages: PageSelection = None,
) -> PdfOperationResult:
    start_time = time.time()
    target_reader = _open_reader(target_path, target_password)
    insert_reader = _open_reader(insert_source, insert_password)

    total_pages = len(target_reader.pages)
    anchor_page = parse_single_page_reference(page, total_pages)
    insert_page_numbers = parse_page_selection(insert_pages, len(insert_reader.pages))
    position = where.strip().lower()
    if position not in {"before", "after"}:
        raise ValueError("where 仅支持 before 或 after。")

    writer = PdfWriter()
    for index, target_page in enumerate(target_reader.pages, start=1):
        if index == anchor_page and position == "before":
            for insert_page_number in insert_page_numbers:
                writer.add_page(insert_reader.pages[insert_page_number - 1])
        writer.add_page(target_page)
        if index == anchor_page and position == "after":
            for insert_page_number in insert_page_numbers:
                writer.add_page(insert_reader.pages[insert_page_number - 1])

    output = ensure_pdf_suffix(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as file:
        writer.write(file)

    return PdfOperationResult(output, len(writer.pages), time.time() - start_time)


def delete_pages_from_pdf(
    input_path: str | Path,
    output_path: str | Path,
    *,
    pages: PageSelection,
    password: str | None = None,
) -> PdfOperationResult:
    start_time = time.time()
    reader = _open_reader(input_path, password)
    page_numbers_to_delete = set(parse_page_selection(pages, len(reader.pages)))

    if len(page_numbers_to_delete) >= len(reader.pages):
        raise ValueError("删除后将不剩任何页面，请至少保留一页。")

    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        if index not in page_numbers_to_delete:
            writer.add_page(page)

    output = ensure_pdf_suffix(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as file:
        writer.write(file)

    return PdfOperationResult(output, len(writer.pages), time.time() - start_time)


def replace_pdf(
    target_path: str | Path,
    replacement_source: str | Path,
    output_path: str | Path,
    *,
    start_page: str | int,
    target_password: str | None = None,
    replacement_password: str | None = None,
    replacement_pages: PageSelection = None,
) -> PdfOperationResult:
    start_time = time.time()
    target_reader = _open_reader(target_path, target_password)
    replacement_reader = _open_reader(replacement_source, replacement_password)

    total_target_pages = len(target_reader.pages)
    replace_from = parse_single_page_reference(start_page, total_target_pages)
    replacement_page_numbers = parse_page_selection(replacement_pages, len(replacement_reader.pages))
    replacement_count = len(replacement_page_numbers)

    replace_to = replace_from + replacement_count - 1
    if replace_to > total_target_pages:
        raise ValueError(
            f"替换范围超出原 PDF 页数: 需要替换到第 {replace_to} 页，但目标只有 {total_target_pages} 页。"
        )

    writer = PdfWriter()
    current_page = 1
    while current_page <= total_target_pages:
        if current_page == replace_from:
            for replacement_page_number in replacement_page_numbers:
                writer.add_page(replacement_reader.pages[replacement_page_number - 1])
            current_page += replacement_count
            continue
        writer.add_page(target_reader.pages[current_page - 1])
        current_page += 1

    output = ensure_pdf_suffix(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as file:
        writer.write(file)

    return PdfOperationResult(output, len(writer.pages), time.time() - start_time)


def rotate_pdf(
    input_path: str | Path,
    output_path: str | Path,
    *,
    angle: int,
    pages: PageSelection = None,
    password: str | None = None,
) -> PdfOperationResult:
    start_time = time.time()
    skill = PDFSkill()
    skill.add_source(input_path, password=password).rotate(angle, pages)
    result = skill.save(output_path)
    return PdfOperationResult(result.output_path, result.page_count, time.time() - start_time)


def split_pdf(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    pages: PageSelection = None,
    prefix: str | None = None,
    password: str | None = None,
) -> list[PdfOperationResult]:
    source = Path(input_path).expanduser()
    reader = _open_reader(source, password)
    page_numbers = parse_page_selection(pages, len(reader.pages))
    target_dir = Path(output_dir).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    name_prefix = prefix or source.stem

    results: list[PdfOperationResult] = []
    for page_number in page_numbers:
        start_time = time.time()
        writer = PdfWriter()
        writer.add_page(reader.pages[page_number - 1])
        output = target_dir / f"{name_prefix}_page_{page_number:03d}.pdf"
        with output.open("wb") as file:
            writer.write(file)
        results.append(PdfOperationResult(output, 1, time.time() - start_time))
    return results


def get_pdf_info(paths: Sequence[str | Path], *, password: str | None = None) -> list[PdfInfo]:
    info: list[PdfInfo] = []
    for path in paths:
        reader = _open_reader(path, password)
        info.append(PdfInfo(Path(path).expanduser(), len(reader.pages), reader.is_encrypted))
    return info


def parse_source_argument(value: str) -> tuple[str, PageSelection]:
    path, separator, pages = value.rpartition(":")
    if separator and path and _looks_like_page_selection(pages):
        return path, pages
    return value, None


def _looks_like_page_selection(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in {"", "all", "end", "last"}:
        return True
    return all(char.isdigit() or char in {",", "-", " ", "，"} for char in lowered)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="PDF 合并、插入、删除、替换、选页、拆分和旋转工具。")
    subparsers = parser.add_subparsers(dest="command", required=True)

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


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.command == "merge":
        sources = [parse_source_argument(source) for source in args.sources]
        result = merge_pdfs(sources, args.output, password=args.password)
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
    raise SystemExit(main())
