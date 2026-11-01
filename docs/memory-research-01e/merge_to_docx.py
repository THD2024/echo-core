#!/usr/bin/env python3
"""Merge all memory-research-01e markdown files into a single Word document."""
import re
import sys
from pathlib import Path

from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC_DIR = Path(r"D:\EchoCore\echo-core\docs\memory-research-01e")
OUT_PATH = Path(r"C:\Users\微醺\Desktop\ECC-ARCH-AUDIT-R1-补充核查报告.docx")

# 补充核查交付物
FILES = [
    "arch-audit-supplement-final.md",
    "arch-audit-supplement-01-packages.md",
]


def set_cell_shading(cell, color):
    """Set cell background color."""
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), color)
    shading.set(qn("w:val"), "clear")
    cell._tc.get_or_add_tcPr().append(shading)


def add_table_from_md(doc, lines, start_idx):
    """Parse markdown table starting at lines[start_idx]. Return next index."""
    rows = []
    i = start_idx
    while i < len(lines) and lines[i].strip().startswith("|"):
        cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
        rows.append(cells)
        i += 1

    if len(rows) < 2:
        return i

    # Remove separator row (second row with ---)
    if len(rows) > 1 and all(re.match(r"^[-:]+$", c) for c in rows[1] if c):
        rows.pop(1)

    if not rows:
        return i

    ncols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=ncols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    for ri, row_data in enumerate(rows):
        for ci, cell_text in enumerate(row_data):
            if ci >= ncols:
                break
            cell = table.cell(ri, ci)
            cell.text = cell_text
            for p in cell.paragraphs:
                p.style = doc.styles["Normal"]
                for run in p.runs:
                    run.font.size = Pt(9)
                    run.font.name = "Calibri"
            if ri == 0:
                set_cell_shading(cell, "1F3A5F")
                for p in cell.paragraphs:
                    for run in p.runs:
                        run.font.bold = True
                        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    return i


def add_code_block(doc, code_lines):
    """Add a monospace code block."""
    for line in code_lines:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.left_indent = Cm(0.5)
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(8.5)
        run.font.color.rgb = RGBColor(0x2D, 0x2D, 0x2D)
        # Set East Asian font
        rPr = run._element.get_or_add_rPr()
        rFonts = rPr.find(qn("w:rFonts"))
        if rFonts is None:
            rFonts = OxmlElement("w:rFonts")
            rPr.append(rFonts)
        rFonts.set(qn("w:ascii"), "Consolas")
        rFonts.set(qn("w:hAnsi"), "Consolas")


def add_inline_formatting(paragraph, text):
    """Handle bold and inline code in text."""
    # Split by bold and code patterns
    parts = re.split(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("`") and part.endswith("`"):
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0xC7, 0x25, 0x4E)
            rPr = run._element.get_or_add_rPr()
            rFonts = rPr.find(qn("w:rFonts"))
            if rFonts is None:
                rFonts = OxmlElement("w:rFonts")
                rPr.append(rFonts)
            rFonts.set(qn("w:ascii"), "Consolas")
            rFonts.set(qn("w:hAnsi"), "Consolas")
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            run = paragraph.add_run(part[1:-1])
            run.italic = True
        else:
            paragraph.add_run(part)


def process_markdown(doc, md_text, doc_title):
    """Convert markdown text to Word document elements."""
    lines = md_text.split("\n")
    i = 0
    in_code = False
    code_buffer = []

    while i < len(lines):
        line = lines[i]

        # Code block toggle
        if line.strip().startswith("```"):
            if in_code:
                add_code_block(doc, code_buffer)
                code_buffer = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_buffer.append(line)
            i += 1
            continue

        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            i += 1
            continue

        # Headings
        if stripped.startswith("#"):
            match = re.match(r"^(#{1,6})\s+(.+)", stripped)
            if match:
                level = len(match.group(1))
                text = match.group(2).strip()
                # Clean markdown formatting from headings
                text = re.sub(r"\*\*", "", text)
                text = re.sub(r"`", "", text)

                if level == 1:
                    # Document title - page break + Heading 1
                    if doc_title:
                        doc.add_page_break()
                    heading = doc.add_heading(text, level=1)
                elif level == 2:
                    heading = doc.add_heading(text, level=2)
                elif level == 3:
                    heading = doc.add_heading(text, level=3)
                else:
                    heading = doc.add_heading(text, level=min(level, 4))

                for run in heading.runs:
                    run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
            i += 1
            continue

        # Horizontal rule
        if stripped in ("---", "***", "___"):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run("─" * 60)
            run.font.color.rgb = RGBColor(0xCC, 0xCC, 0xCC)
            run.font.size = Pt(8)
            i += 1
            continue

        # Blockquote
        if stripped.startswith(">"):
            text = stripped.lstrip("> ").strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(1)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(4)
            add_inline_formatting(p, text)
            for run in p.runs:
                run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                run.italic = True
            i += 1
            continue

        # Table
        if stripped.startswith("|"):
            i = add_table_from_md(doc, lines, i)
            doc.add_paragraph()  # spacing after table
            continue

        # List items
        if re.match(r"^(\s*)[-*+]\s+", stripped) or re.match(r"^(\s*)\d+\.\s+", stripped):
            # Determine indent level
            indent_match = re.match(r"^(\s*)", line)
            indent = len(indent_match.group(1)) if indent_match else 0
            list_level = indent // 2

            content = re.sub(r"^(\s*)[-*+]\s+", "", line)
            content = re.sub(r"^(\s*)\d+\.\s+", "", content)

            if re.match(r"^(\s*)\d+\.\s+", line):
                style = "List Number"
            else:
                style = "List Bullet"

            p = doc.add_paragraph(style=style)
            if list_level > 0:
                p.paragraph_format.left_indent = Cm(0.63 * (list_level + 1))
            add_inline_formatting(p, content.strip())
            i += 1
            continue

        # Regular paragraph
        p = doc.add_paragraph()
        add_inline_formatting(p, stripped)
        i += 1

    # Flush any remaining code
    if code_buffer:
        add_code_block(doc, code_buffer)


def main():
    doc = Document()

    # Page setup - A4
    for section in doc.sections:
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(2.5)
        section.right_margin = Cm(2.5)

    # Configure default styles
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = 1.15

    for level in range(1, 5):
        hstyle = doc.styles[f"Heading {level}"]
        hstyle.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
        hstyle.font.name = "Calibri Light"

    # Title page
    title = doc.add_heading("Echo Core Memory", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in title.runs:
        run.font.size = Pt(28)
        run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run("终极架构独立研究报告（EC-MEMORY-RESEARCH-01E）")
    run.font.size = Pt(16)
    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = meta.add_run("\n生成日期：2026-10-31\n状态：研究完成，等待独立审查\n约束：不修改生产代码、不触碰 Immune V1 冻结文件\n")
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)

    # TOC placeholder
    doc.add_page_break()
    toc_heading = doc.add_heading("目录", level=1)
    for run in toc_heading.runs:
        run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

    toc_items = [
        "第一部分  浓缩方案报告",
        "第二部分  研究总索引",
        "第三部分  当前 Memory 现状审计",
        "第四部分  人类认知架构与计算认知架构",
        "第五部分  AI Agent Memory 研究（2023-2026）",
        "第六部分  机制迁移分析矩阵",
        "第七部分  架构方案对比",
        "第八部分  推荐终极架构 HLM-v1",
        "第九部分  数据模型与生命周期设计",
        "第十部分  风险、未决问题与验证计划",
        "第十一部分  分阶段实施路线图",
    ]
    for item in toc_items:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(1)
        run = p.add_run(item)
        run.font.size = Pt(11)

    # Process each file
    for idx, fname in enumerate(FILES):
        fpath = SRC_DIR / fname
        if not fpath.exists():
            print(f"WARNING: {fname} not found, skipping")
            continue

        print(f"Processing {fname}...")
        text = fpath.read_text(encoding="utf-8")

        # For the concise report (first file), use it as-is with page break
        is_first = idx == 0
        process_markdown(doc, text, doc_title=not is_first or idx > 0)

    # Save
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT_PATH))
    print(f"\nSaved to: {OUT_PATH}")
    print(f"Size: {OUT_PATH.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
