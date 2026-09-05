import io
import re

import pdfplumber


def _label(text, start, end):
    match = re.search(start + r"\s*:?\s*(.*?)\s*(?=" + end + r")", text, re.I | re.S)
    return re.sub(r"\s+", " ", match.group(1)).strip() if match else ""


def _number(text, pattern, default=0):
    match = re.search(pattern, text, re.I)
    return float(match.group(1)) if match else default


def _row_value(words, label, max_x=None):
    anchors = [word for word in words if word["text"].upper() == label.upper()]
    if not anchors:
        return ""
    anchor = anchors[0]
    centre = (anchor["top"] + anchor["bottom"]) / 2
    values = [word for word in words if word["x0"] > anchor["x1"] + 8 and abs((word["top"] + word["bottom"]) / 2 - centre) < 10 and (max_x is None or word["x1"] < max_x)]
    return " ".join(word["text"] for word in sorted(values, key=lambda word: word["x0"])).strip()


def _offcut(page, sheet_width, sheet_height):
    candidates = [r for r in page.rects if r.get("stroke") and r["width"] > page.width * .25 and r["height"] > page.height * .15]
    if not candidates:
        return None
    sheet = max(candidates, key=lambda r: r["width"] * r["height"])
    coloured = []
    for shape in page.curves + page.lines + page.rects:
        colour = shape.get("stroking_color")
        if colour not in ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)):
            continue
        if shape["x0"] >= sheet["x0"] - 1 and shape["x1"] <= sheet["x1"] + 1 and shape["y0"] >= sheet["y0"] - 1 and shape["y1"] <= sheet["y1"] + 1:
            coloured.append(shape)
    if not coloured:
        return None
    x0, x1 = min(s["x0"] for s in coloured), max(s["x1"] for s in coloured)
    y0, y1 = min(s["y0"] for s in coloured), max(s["y1"] for s in coloured)
    scale_x, scale_y = sheet_width / sheet["width"], sheet_height / sheet["height"]
    spaces = [
        (round((x0 - sheet["x0"]) * scale_x), sheet_height, "left"),
        (round((sheet["x1"] - x1) * scale_x), sheet_height, "right"),
        (sheet_width, round((y0 - sheet["y0"]) * scale_y), "bottom"),
        (sheet_width, round((sheet["y1"] - y1) * scale_y), "top"),
    ]
    length, width, edge = max(spaces, key=lambda item: item[0] * item[1])
    if length <= 0 or width <= 0:
        return None
    return {"length": max(length, width), "width": min(length, width), "edge": edge, "confidence": "high"}


def analyse_cnc_pdf(payload):
    pages = []
    with pdfplumber.open(io.BytesIO(payload)) as document:
        for index, page in enumerate(document.pages):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            compact = re.sub(r"\s+", " ", text)
            words = page.extract_words()
            project = _row_value(words, "PROJECT:", page.width * .65)
            material = _row_value(words, "MATERIAL:", page.width * .65)
            finish = _row_value(words, "FINISH:", page.width * .65)
            size = re.search(r"(\d+(?:\.\d+)?)\s*[Xx×]\s*(\d+(?:\.\d+)?)", _row_value(words, "SIZE:", page.width * .65))
            sheet_width, sheet_height = (float(size.group(1)), float(size.group(2))) if size else (0, 0)
            order_text = _row_value(words, "ORDER")
            qty_text = _row_value(words, "QTY:")
            sheet_labels = [word for word in words if word["text"].upper() == "SHEET" and word["x0"] > page.width * .55]
            sheet_number = ""
            if sheet_labels:
                anchor = sheet_labels[0]
                centre = (anchor["top"] + anchor["bottom"]) / 2
                values = [word for word in words if word["x0"] > anchor["x1"] and abs((word["top"] + word["bottom"]) / 2 - centre) < 10 and re.fullmatch(r"\d+", word["text"])]
                sheet_number = values[-1]["text"] if values else ""
            sheet_rects = [r for r in page.rects if r.get("stroke") and r["width"] > page.width * .25 and r["height"] > page.height * .15]
            panel_ids = []
            if sheet_rects:
                rect = max(sheet_rects, key=lambda r: r["width"] * r["height"])
                for word in words:
                    if rect["x0"] <= word["x0"] <= rect["x1"] and rect["top"] <= word["top"] <= rect["bottom"] and re.fullmatch(r"[A-Za-z]?\d+(?:[.-]\d+)?", word["text"]):
                        panel_ids.append(word["text"])
            item = {
                "page": index + 1,
                "project": project,
                "material": material,
                "finish": finish,
                "orderNumber": re.sub(r"\D", "", order_text),
                "sheetNumber": sheet_number or str(index + 1),
                "quantity": max(1, int(re.sub(r"\D", "", qty_text) or 1)),
                "sheetWidth": max(sheet_width, sheet_height),
                "sheetHeight": min(sheet_width, sheet_height),
                "panelArea": _number(compact, r"PANEL\s*m2\s*(\d+(?:\.\d+)?)"),
                "panelIds": panel_ids,
                "proposedOffcut": _offcut(page, max(sheet_width, sheet_height), min(sheet_width, sheet_height)) if size else None,
                "warnings": [],
            }
            if not size: item["warnings"].append("Sheet size was not detected")
            if not item["orderNumber"]: item["warnings"].append("Order number was not detected")
            if not panel_ids: item["warnings"].append("Panel IDs were not detected")
            if not item["proposedOffcut"]: item["warnings"].append("Off-cut geometry could not be estimated")
            pages.append(item)
    return {"pages": pages}
