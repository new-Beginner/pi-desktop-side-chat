"""Regenerate task-owned Office/image fixtures; Python is build-time only.
Usage: python -B scripts/make-content-fixtures.py tests/fixtures/content
"""
from pathlib import Path
import sys
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from PIL import Image

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

doc = Document()
doc.add_heading('DOCX-SIDE-420', level=1)
doc.add_paragraph('正文验证：泥石流与含沙量。')
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = '项目'
table.cell(0, 1).text = '数值'
table.cell(1, 0).text = '流速'
table.cell(1, 1).text = '12.5'
doc.add_paragraph('DOCX-LAST-620')
doc.save(out / 'sample.docx')

book = Workbook()
sheet = book.active
sheet.title = '监测数据'
sheet['A1'], sheet['B1'] = 'XLSX-SIDE-421', '数值'
sheet['A2'], sheet['B2'] = '流速', 12.5
sheet['A3'], sheet['B3'] = '含沙量', 0.25
sheet['C2'] = '=SUM(B2:B3)'
sheet['C3'] = '=HYPERLINK("https://example.invalid/private", "不应访问")'
last = book.create_sheet('汇总')
last['A1'], last['B2'] = 'XLSX-LAST-621', '最后一张表'
book.save(out / 'sample.xlsx')

slides = Presentation()
for title, body in [('PPTX-SIDE-422', '第一页：泥石流实验'), ('PPTX-LAST-622', '第二页：粒径 0.25 mm')]:
    slide = slides.slides.add_slide(slides.slide_layouts[1])
    slide.shapes.title.text = title
    slide.placeholders[1].text = body
    slide.notes_slide.notes_text_frame.text = '备注：PPTX-NOTE-722'
slides.save(out / 'sample.pptx')

red = Image.new('RGB', (12, 8), (240, 20, 10))
blue = Image.new('RGB', (12, 8), (10, 20, 240))
red.save(out / 'sample.png')
red.save(out / 'sample.jpg', quality=95)
red.save(out / 'sample.webp', lossless=True)
red.save(out / 'single.tif', compression='tiff_lzw')
red.save(out / 'multipage.tiff', save_all=True, append_images=[blue], compression='tiff_lzw')
Image.new('I;16', (3, 2), 65535).save(out / 'gray16.tif')
red.save(out / 'deflate.tif', compression='tiff_deflate')
Image.new('L', (3, 2), 85).save(out / 'gray.tif', compression='packbits')
Image.new('1', (3, 2), 1).save(out / 'mono.tif')
Image.new('RGBA', (3, 2), (240, 20, 10, 128)).save(out / 'rgba.tif')
palette = Image.new('P', (3, 2), 1)
palette.putpalette([0, 0, 0, 240, 20, 10] + [0] * 762)
palette.save(out / 'palette.tif')
print('Generated Office/image fixtures in', out)
(out / 'sample-gbk.c').write_bytes('// 中文编码\nint velocity = 13;\n'.encode('gb18030'))
