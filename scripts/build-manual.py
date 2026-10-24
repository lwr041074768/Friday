"""Build the desktop guide from reviewed Markdown and synthetic UI screenshots."""
from pathlib import Path
from xml.sax.saxutils import escape
import argparse, json, re
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, KeepTogether, HRFlowable

parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
parser.add_argument('--screenshots',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc')
parser.add_argument('--bold-font',default='C:/Windows/Fonts/msyhbd.ttc')
parser.add_argument('--version',help='Desktop version; defaults to desktop/package.json.')
args=parser.parse_args()
manifest_path=Path(__file__).resolve().parents[1]/'desktop'/'package.json'
version=args.version or json.loads(manifest_path.read_text(encoding='utf-8'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?',version):
    raise ValueError('The desktop version must be a valid version string.')
pdfmetrics.registerFont(TTFont('GuideCN',args.font,subfontIndex=0))
pdfmetrics.registerFont(TTFont('GuideCNBold',args.bold_font,subfontIndex=0))
ink=colors.HexColor('#18334d');blue=colors.HexColor('#236fd0');muted=colors.HexColor('#637c93')
body=ParagraphStyle('Body',fontName='GuideCN',fontSize=10.4,leading=17.5,textColor=ink,wordWrap='CJK',spaceAfter=10)
heading=ParagraphStyle('Heading',fontName='GuideCNBold',fontSize=19,leading=27,textColor=ink,spaceAfter=17)
caption=ParagraphStyle('Caption',fontName='GuideCN',fontSize=8,leading=12,textColor=muted,wordWrap='CJK',spaceBefore=7,spaceAfter=7)
cover_title=ParagraphStyle('CoverTitle',parent=heading,fontSize=29,leading=42,spaceAfter=26)
cover_body=ParagraphStyle('CoverBody',parent=body,fontSize=12,leading=22,spaceAfter=17)
source=Path(args.source).read_text(encoding='utf-8')
source=re.sub(r'^Windows 桌面版 [^\r\n]+',f'Windows 桌面版 {version}',source,count=1,flags=re.M)
source=re.sub(r'本文以 [0-9][0-9A-Za-z.+-]* 桌面版为准',f'本文以 {version} 桌面版为准',source,count=1)
sections=re.split(r'^# ',source,flags=re.M)[1:]
story=[]
for number,section in enumerate(sections):
    title,_,content=section.partition('\n')
    if number:
        story.append(PageBreak());story.append(Paragraph(escape(title),heading))
    else:
        story.extend([Spacer(1,83),Paragraph('FRIDAY',ParagraphStyle('English',fontName='Helvetica-Bold',fontSize=10,leading=16,textColor=blue)),Spacer(1,20),Paragraph(escape(title),cover_title),HRFlowable(width='100%',thickness=2,color=blue),Spacer(1,28)])
    for text in re.split(r'\n\s*\n',content.strip()):
        text=text.strip()
        if not text:continue
        if text.startswith('@image '):
            image_path=Path(args.screenshots)/text[7:].strip()
            if not image_path.is_file():raise FileNotFoundError(image_path)
            img=Image(str(image_path));width=499;height=width*img.imageHeight/img.imageWidth
            if height>310:width*=310/height;height=310
            img.drawWidth=width;img.drawHeight=height;img.hAlign='CENTER'
            story.append(KeepTogether([Spacer(1,5),img,Paragraph('界面示例采用模拟数据。PDF 可放大查看；操作参数请结合正文核对。',caption)]))
        else:
            safe=escape(text).replace('\n',' ')
            safe=re.sub(r'(https://gitee\.com/[^\s<]+)',r'<link href="\1" color="#236fd0">\1</link>',safe)
            style=cover_body if number==0 else body
            if text.startswith(('重要：','说明：')):
                style=ParagraphStyle('Callout',parent=body,backColor=colors.HexColor('#f0f5fc'),borderPadding=9,spaceBefore=7,spaceAfter=15)
            story.append(Paragraph(safe,style))

output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
doc=SimpleDocTemplate(str(output),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=53,bottomMargin=48,title=f'Friday 使用说明书 - 桌面版 {version}',author='Friday',subject='Windows desktop user guide',pageCompression=1)
def page_decoration(canvas,doc):
    canvas.saveState();w,h=A4
    canvas.setStrokeColor(colors.HexColor('#dfe8f0'));canvas.line(48,40,w-48,40)
    canvas.setFont('GuideCN',8);canvas.setFillColor(muted);canvas.drawString(48,25,f'Friday  |  Windows 桌面版 {version}')
    canvas.drawRightString(w-48,25,str(doc.page))
    if doc.page>1:
        canvas.setFillColor(blue);canvas.rect(48,h-31,18,2,fill=1,stroke=0)
        canvas.setFont('Helvetica',7.5);canvas.drawString(73,h-32,'FRIDAY / USER GUIDE')
    canvas.restoreState()
doc.build(story,onFirstPage=page_decoration,onLaterPages=page_decoration)
print(output)
