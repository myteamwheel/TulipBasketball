"""A printable report from the same recalculated result tables as Excel/web."""
import gzip
import json
from pathlib import Path
import sys
from xml.sax.saxutils import escape
import unicodedata
def printable(value):
    text = str(value).replace("™", "(TM)").replace("—", "-").replace("–", "-")
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle, PageBreak

directory = Path(sys.argv[1])
data = json.loads(gzip.decompress((directory / 'tables.json.gz').read_bytes()))
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Cell', fontSize=7, leading=9, wordWrap='CJK'))
story = [Paragraph('Orlando Oswalds / Dynasty Bois', styles['Title']), Paragraph('Full research audit', styles['Heading1']), Paragraph(escape(data['generatedAt']), styles['Normal']), Spacer(1, 14)]
story.append(Paragraph('This report contains every recalculated analytical result table. The companion Excel workbook and website contain the full player, ownership, transaction and other detailed datasets. Historical comparisons describe past outcomes; they do not establish causation.', styles['Normal']))
story.append(Paragraph('Sources: Sleeper, FantasyCalc, DynastyProcess and nflverse. College profile baseline: ' + data['collegeBaseline'] + '.', styles['Normal']))
story.append(Paragraph('Changes since the previous pass', styles['Heading2']))
story.append(Paragraph('Baseline snapshot; no prior comparison.' if not data['comparedWith'] else f"Compared with {escape(data['comparedWith'])}; {len(data['changes'])} tables changed. Changed rows include updated valuations as well as new activity.", styles['Normal']))
for table in data['tables']:
    if table['kind'] != 'result' and table['name'] not in ('recommendations', 'traders_dynasty_bois', 'future_picks'):
        continue
    story.extend([PageBreak(), Paragraph(escape(table['name'].replace('_', ' ').title()), styles['Heading1']), Paragraph(f"{escape(table['report'])}. {len(table['rows'])} rows.", styles['Normal']), Spacer(1, 10)])
    rows = table['rows']
    keys = list(dict.fromkeys(key for row in rows for key in row))
    # Repeat a stable row number so wide column groups remain traceable.
    groups = [keys[start:start+6] for start in range(0, len(keys), 6)]
    for group_number, group in enumerate(groups, 1):
        if len(groups) > 1:
            story.append(Paragraph(f"Columns {group_number} of {len(groups)}. Row numbers identify the same record across groups.", styles["Normal"]))
            story.append(Spacer(1, 6))
        def cell(value):
            if value is None: value = '—'
            if isinstance(value, float): value = f'{value:,.3f}'.rstrip('0').rstrip('.')
            return Paragraph(escape(printable(value)), styles['Cell'])
        body = [[cell("Row"), *[cell(key) for key in group]]] + [[cell(index + 1), *[cell(row.get(key)) for key in group]] for index, row in enumerate(rows)]
        table_view = LongTable(body, repeatRows=1, colWidths=[30, *([660 / max(1, len(group))] * len(group))], hAlign='LEFT')
        table_view.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#d8e9e4')), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f5f5')]), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
        story.extend([table_view, Spacer(1, 14)])
def footer(canvas, doc):
    canvas.setFont('Helvetica', 8)
    canvas.drawString(42, 24, 'Dynasty Bois - ' + data['generatedAt'][:10])
    canvas.drawRightString(750, 24, str(doc.page))
SimpleDocTemplate(str(directory / 'Dynasty-Bois-Report.pdf'), pagesize=landscape(letter), rightMargin=48, leftMargin=48, topMargin=42, bottomMargin=42).build(story, onFirstPage=footer, onLaterPages=footer)
