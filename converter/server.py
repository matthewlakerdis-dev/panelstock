import hmac
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue
from cnc_pdf import analyse_cnc_pdf


MAX_INPUT = 10 * 1024 * 1024
MAX_OUTPUT = 12 * 1024 * 1024
TOKEN = os.environ.get("CONVERTER_TOKEN", "")
CONVERT_LOCK = threading.Lock()


def property_value(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def convert_xlsx(source: Path, output: Path):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    context = resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
    desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
    document = desktop.loadComponentFromURL(source.as_uri(), "_blank", 0, (property_value("Hidden", True),))
    if document is None:
        raise RuntimeError("Workbook could not be opened")
    try:
        sheet = document.Sheets.getByIndex(0)
        sheet.setPrintAreas((sheet.getCellRangeByName("A1:N50").RangeAddress,))
        page_style = document.StyleFamilies.getByName("PageStyles").getByName(sheet.PageStyle)
        page_style.IsLandscape = False
        page_style.Width = 21000
        page_style.Height = 29700
        page_style.LeftMargin = 500
        page_style.RightMargin = 500
        page_style.TopMargin = 0
        page_style.BottomMargin = 0
        page_style.HeaderIsOn = False
        page_style.FooterIsOn = False
        page_style.CenterHorizontally = True
        page_style.CenterVertically = True
        page_style.ScaleToPagesX = 1
        page_style.ScaleToPagesY = 1
        document.storeToURL(output.as_uri(), (
            property_value("FilterName", "calc_pdf_Export"),
            property_value("Overwrite", True),
        ))
    finally:
        document.close(True)


class Handler(BaseHTTPRequestHandler):
    server_version = "PanelStockConverter/1"

    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        if self.path not in ("/convert", "/analyse-cnc"):
            self.send_error(404)
            return
        expected = f"Bearer {TOKEN}"
        supplied = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(supplied, expected):
            self.send_error(401)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > MAX_INPUT:
            self.send_error(413)
            return
        payload = self.rfile.read(length)
        expected_magic = b"%PDF-" if self.path == "/analyse-cnc" else b"PK"
        if len(payload) != length or not payload.startswith(expected_magic):
            self.send_error(400)
            return
        if self.path == "/analyse-cnc":
            try:
                output = json.dumps(analyse_cnc_pdf(payload)).encode("utf-8")
            except Exception:
                self.send_error(422)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(output)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(output)
            return
        try:
            with CONVERT_LOCK, tempfile.TemporaryDirectory(prefix="panelstock-order-") as folder:
                source = Path(folder, "order.xlsx")
                output = Path(folder, "order.pdf")
                source.write_bytes(payload)
                convert_xlsx(source, output)
                pdf = output.read_bytes()
            if not pdf.startswith(b"%PDF-") or len(pdf) > MAX_OUTPUT:
                raise RuntimeError("Invalid PDF output")
        except Exception:
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(pdf)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(pdf)

    def log_message(self, format, *args):
        print(f"converter_http status={args[1] if len(args) > 1 else 'unknown'}")


if len(TOKEN) < 32:
    raise SystemExit("CONVERTER_TOKEN must contain at least 32 characters")

port = int(os.environ.get("PORT", "8080"))
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
