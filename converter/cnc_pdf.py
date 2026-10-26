import io
import re
import subprocess
import shutil

import pdfplumber

DEFAULT_CUT_EDGE_ALLOWANCE_MM = 10
DEFAULT_MINIMUM_OFFCUT_SIZE_MM = 1


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


def _sheet_rects(page):
    # Portrait offcuts can be narrower than a quarter of the PDF page.
    return [r for r in page.rects if r.get("stroke") and r["width"] > page.width * .15 and r["height"] > page.height * .15]


def _order_value(words):
    anchors = [w for w in words if w["text"].upper() == "ORDER"]
    if not anchors:
        return ""
    anchor = anchors[0]
    # Wrapped values belong between the neighbouring title-block rows.
    above = [w["bottom"] for w in words if w["text"].upper() == "QTY:"]
    below = [w["top"] for w in words if w["text"].upper() == "SYSTEM:"]
    values = [w for w in words if w["x0"] > anchor["x1"] + 20
              and w["text"] not in ("#", ":")
              and w["top"] > max(above, default=anchor["top"] - 20)
              and w["bottom"] < min(below, default=anchor["bottom"] + 20)]
    rows = []
    for word in sorted(values, key=lambda w: (w["top"], w["x0"])):
        if not rows or abs(rows[-1][0]["top"] - word["top"]) > 10:
            rows.append([])
        rows[-1].append(word)
    return "".join(" ".join(w["text"] for w in sorted(row, key=lambda w: w["x0"])) for row in rows)


def _ocr_panel_ids(page, rect):
    if not shutil.which("tesseract"):
        return [], "Panel ID OCR is unavailable (Tesseract is not installed)"
    try:
        crop = page.crop((rect["x0"], rect["top"], rect["x1"], rect["bottom"]))
        buffer = io.BytesIO()
        crop.to_image(resolution=150).original.save(buffer, format="PNG")
        result = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "11"],
                                input=buffer.getvalue(), capture_output=True, timeout=30, check=True)
        ids = re.findall(r"(?<![A-Za-z0-9])[A-Za-z]+\d+(?:[-.]\d+)+(?![A-Za-z0-9])", result.stdout.decode())
        return list(dict.fromkeys(ids)), "Panel IDs read using OCR; verify against the drawing"
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return [], "Panel ID OCR failed: " + type(error).__name__


def _offcut(page, sheet_width, sheet_height, cut_edge_allowance=DEFAULT_CUT_EDGE_ALLOWANCE_MM, minimum_offcut_size=DEFAULT_MINIMUM_OFFCUT_SIZE_MM):
    candidates = _sheet_rects(page)
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
    layout = {
        "anchor": "bottom-left",
        "usedLength": round((x1 - sheet["x0"]) * scale_x),
        "usedWidth": round((y1 - sheet["y0"]) * scale_y),
    }
    spaces = [
        (round((x0 - sheet["x0"]) * scale_x), sheet_height, "left"),
        (round((sheet["x1"] - x1) * scale_x), sheet_height, "right"),
        (sheet_width, round((y0 - sheet["y0"]) * scale_y), "bottom"),
        (sheet_width, round((sheet["y1"] - y1) * scale_y), "top"),
    ]
    length, width, edge = max(spaces, key=lambda item: item[0] * item[1])
    # Each proposed strip keeps three factory edges and has one newly cut edge.
    # Remove the configured amount perpendicular to that edge so the suggested dimensions are usable sizes.
    if edge in ("left", "right"):
        length = max(0, length - cut_edge_allowance)
    else:
        width = max(0, width - cut_edge_allowance)
    if length < minimum_offcut_size or width < minimum_offcut_size:
        return None
    return {"length": max(length, width), "width": min(length, width), "edge": edge, "cutEdgeAllowance": cut_edge_allowance, "minimumOffcutSize": minimum_offcut_size, "layout": layout, "confidence": "high"}


# Numeric sheet labels remain supported, alongside fabrication IDs such as
# C3F-49, BS-2, A73-219 and Z3-30a. Edge codes and units are not panel IDs.
_PANEL_ID = re.compile(r"(?:[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*|\d+(?:[.-]\d+)?)")


def _panel_id(word):
    text = word["text"].strip()
    chars = word.get("chars") or []
    if chars:
        matrix = chars[0].get("matrix")
        # pdfplumber's default spatial ordering reads bottom-to-top CAD text
        # backwards. A positive vertical baseline identifies that orientation;
        # clockwise labels already read top-to-bottom and must stay unchanged.
        if matrix and ((not word.get("upright", True) and matrix[1] > 0)
                       or (word.get("upright", True) and matrix[0] < 0)):
            text = text[::-1]
    if not _PANEL_ID.fullmatch(text) or not any(char.isdigit() for char in text):
        return ""
    return text


def analyse_cnc_pdf(payload, cut_edge_allowance=DEFAULT_CUT_EDGE_ALLOWANCE_MM, minimum_offcut_size=DEFAULT_MINIMUM_OFFCUT_SIZE_MM):
    pages = []
    with pdfplumber.open(io.BytesIO(payload)) as document:
        for index, page in enumerate(document.pages):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            compact = re.sub(r"\s+", " ", text)
            words = page.extract_words(return_chars=True)
            project = _row_value(words, "PROJECT:", page.width * .65)
            material = _row_value(words, "MATERIAL:", page.width * .65)
            finish = _row_value(words, "FINISH:", page.width * .65)
            size = re.search(r"(\d+(?:\.\d+)?)\s*[Xx×]\s*(\d+(?:\.\d+)?)", _row_value(words, "SIZE:", page.width * .65))
            sheet_width, sheet_height = (float(size.group(1)), float(size.group(2))) if size else (0, 0)
            order_text = _order_value(words)
            qty_text = _row_value(words, "QTY:")
            sheet_labels = [word for word in words if word["text"].upper() == "SHEET" and word["x0"] > page.width * .55]
            sheet_number = ""
            if sheet_labels:
                anchor = sheet_labels[0]
                centre = (anchor["top"] + anchor["bottom"]) / 2
                values = [word for word in words if word["x0"] > anchor["x1"] and abs((word["top"] + word["bottom"]) / 2 - centre) < 10 and re.fullmatch(r"\d+", word["text"])]
                sheet_number = values[-1]["text"] if values else ""
            sheet_rects = _sheet_rects(page)
            panel_ids = []
            if sheet_rects:
                rect = max(sheet_rects, key=lambda r: r["width"] * r["height"])
                seen = set()
                for word in words:
                    if rect["x0"] <= word["x0"] <= rect["x1"] and rect["top"] <= word["top"] <= rect["bottom"]:
                        panel_id = _panel_id(word)
                        if panel_id and panel_id.casefold() not in seen:
                            panel_ids.append(panel_id)
                            seen.add(panel_id.casefold())
            ocr_warning = ""
            if not panel_ids and sheet_rects:
                panel_ids, ocr_warning = _ocr_panel_ids(page, rect)
            sheet_area = sheet_width * sheet_height / 1_000_000
            printed_sheet_area = _number(compact, r"SHEET\s*m2\s*(\d+(?:\.\d+)?)", None)
            printed_panel_area = _number(compact, r"PANEL\s*m2\s*(\d+(?:\.\d+)?)", None)
            valid_panel_area = printed_panel_area is not None and 0 < printed_panel_area <= sheet_area
            item = {
                "page": index + 1,
                "project": project,
                "material": material,
                "finish": finish,
                "orderNumber": order_text,
                "sheetNumber": sheet_number or str(index + 1),
                "quantity": max(1, int(re.sub(r"\D", "", qty_text) or 1)),
                "sheetWidth": max(sheet_width, sheet_height),
                "sheetHeight": min(sheet_width, sheet_height),
                "sheetArea": sheet_area,
                "printedSheetArea": printed_sheet_area,
                "printedPanelArea": printed_panel_area,
                "printedWastePercent": _number(compact, r"WASTE\s*(\d+(?:\.\d+)?)\s*%", None),
                "stockType": "offcut" if size and "OFFCUT" in compact.upper() else "sheet",
                "panelArea": printed_panel_area if valid_panel_area else None,
                "panelIds": panel_ids,
                "proposedOffcut": _offcut(page, sheet_width, sheet_height, cut_edge_allowance, minimum_offcut_size) if size else None,
                "warnings": [],
            }
            if ocr_warning: item["warnings"].append(ocr_warning)
            if printed_sheet_area is None or abs(printed_sheet_area - sheet_area) > .01:
                item["warnings"].append("Printed sheet area is missing or inconsistent with sheet dimensions")
            if not valid_panel_area:
                item["warnings"].append("Printed panel area is missing, zero or exceeds the sheet area; review required")
            if item["printedWastePercent"] is None or not valid_panel_area or abs(item["printedWastePercent"] - (1 - printed_panel_area / sheet_area) * 100) > 1:
                item["warnings"].append("Printed waste percentage is missing or inconsistent; review required")
            if not size: item["warnings"].append("Sheet size was not detected")
            if not item["orderNumber"]: item["warnings"].append("Order number was not detected")
            if not panel_ids: item["warnings"].append("Panel IDs were not detected")
            if not item["proposedOffcut"]: item["warnings"].append("Off-cut geometry could not be estimated")
            pages.append(item)
    return {"pages": pages}
