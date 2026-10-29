import io
import math
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


def _occupied_rectangles(shapes, sheet, sheet_width, sheet_height):
    # A machining curve can be a whole closed panel, while a line may be one
    # side of that outline. Join touching shape boxes, then occupy the entire
    # component box: panel interiors and drilled holes are never leftovers.
    from shapely.geometry import box
    from shapely.strtree import STRtree

    scale_x, scale_y = sheet_width / sheet["width"], sheet_height / sheet["height"]
    rectangles = [(min(sheet_width, max(0, (s["x0"] - sheet["x0"]) * scale_x)),
                   min(sheet_height, max(0, (s["y0"] - sheet["y0"]) * scale_y)),
                   max(0, min(sheet_width, (s["x1"] - sheet["x0"]) * scale_x)),
                   max(0, min(sheet_height, (s["y1"] - sheet["y0"]) * scale_y))) for s in shapes]
    # PDF coordinate rounding may leave tiny gaps where outline segments meet.
    # Joining boxes within 1 mm is conservative: nearby occupied groups may
    # merge, but a panel interior cannot become a spurious leftover at a gap.
    geometry = [box(*r).buffer(.5, join_style=2) for r in rectangles]
    tree, parent = STRtree(geometry), list(range(len(rectangles)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for index, shape in enumerate(geometry):
        for other in tree.query(shape, predicate="intersects"):
            parent[find(int(other))] = find(index)
    groups = {}
    for index, rect in enumerate(rectangles):
        key = find(index)
        previous = groups.get(key, rect)
        groups[key] = (min(previous[0], rect[0]), min(previous[1], rect[1]),
                       max(previous[2], rect[2]), max(previous[3], rect[3]))
    return [rect for rect in groups.values() if rect[2] > rect[0] and rect[3] > rect[1]]


def _largest_free_rectangle(free, xs, ys, cut_edge_allowance, minimum_offcut_size):
    # A weighted histogram finds the largest physical rectangle, even when the
    # compressed coordinate cells have very different widths and heights.
    heights, best, best_area = [0.] * (len(xs) - 1), None, 0
    for row, cells in enumerate(free):
        depth = ys[row + 1] - ys[row]
        heights = [height + depth if available else 0 for height, available in zip(heights, cells)]
        stack = []
        for column in range(len(heights) + 1):
            height, start = heights[column] if column < len(heights) else 0, column
            while stack and stack[-1][1] > height:
                start, previous = stack.pop()
                bottom = ys[row + 1] - previous
                usable_width = xs[column] - xs[start] - cut_edge_allowance * ((xs[start] > .000001) + (xs[column] < xs[-1] - .000001))
                usable_height = previous - cut_edge_allowance * ((bottom > .000001) + (ys[row + 1] < ys[-1] - .000001))
                area = usable_width * usable_height if min(usable_width, usable_height) > 0 and min(usable_width, usable_height) >= minimum_offcut_size - .000001 else 0
                if area > best_area + .000001:
                    best_area = area
                    best = (start, column, row + 1, previous)
            if height and (not stack or stack[-1][1] < height):
                stack.append((start, height))
    if best is None:
        return None
    left, right, top, height = best
    return xs[left], ys[top] - height, xs[right], ys[top]


def _offcuts(page, sheet_width, sheet_height, cut_edge_allowance=DEFAULT_CUT_EDGE_ALLOWANCE_MM, minimum_offcut_size=DEFAULT_MINIMUM_OFFCUT_SIZE_MM):
    candidates = _sheet_rects(page)
    if not candidates or not (sheet_width > 0 and sheet_height > 0):
        return []
    sheet = max(candidates, key=lambda r: r["width"] * r["height"])
    coloured = [shape for shape in page.curves + page.lines + page.rects
                if shape.get("stroking_color") in ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
                and shape["x0"] >= sheet["x0"] - 1 and shape["x1"] <= sheet["x1"] + 1
                and shape["y0"] >= sheet["y0"] - 1 and shape["y1"] <= sheet["y1"] + 1]
    if not coloured:
        return []
    occupied = _occupied_rectangles(coloured, sheet, sheet_width, sheet_height)
    if not occupied:
        return []
    used_x, used_y = max(rect[2] for rect in occupied), max(rect[3] for rect in occupied)
    portrait = sheet_width < sheet_height
    layout = {"anchor": "bottom-left", "usedLength": math.ceil((used_y if portrait else used_x) - .0000001),
              "usedWidth": math.ceil((used_x if portrait else used_y) - .0000001)}
    xs = sorted({0, sheet_width, *(coordinate for rect in occupied for coordinate in (rect[0], rect[2]))})
    ys = sorted({0, sheet_height, *(coordinate for rect in occupied for coordinate in (rect[1], rect[3]))})
    if len(xs) * len(ys) > 65536:
        # Dense/fragmented PDFs still get safe exterior leftovers without
        # allocating an unbounded grid or treating small panel details as gaps.
        occupied = [(min(r[0] for r in occupied), min(r[1] for r in occupied), used_x, used_y)]
        xs = sorted({0, sheet_width, occupied[0][0], occupied[0][2]})
        ys = sorted({0, sheet_height, occupied[0][1], occupied[0][3]})
    x_index, y_index = {value: index for index, value in enumerate(xs)}, {value: index for index, value in enumerate(ys)}
    free = [[True] * (len(xs) - 1) for _ in range(len(ys) - 1)]

    def remove(rect):
        left, bottom, right, top = rect
        first, last = x_index[left], x_index[right]
        for row in range(y_index[bottom], y_index[top]):
            free[row][first:last] = [False] * (last - first)

    for rect in occupied:
        remove(rect)
    proposals = []
    for _ in range(80):
        rect = _largest_free_rectangle(free, xs, ys, cut_edge_allowance, minimum_offcut_size)
        if rect is None or len(proposals) == 20:
            break
        # Snap histogram arithmetic back to compressed grid coordinates.
        rect = tuple(min(values, key=lambda value: abs(value - coordinate))
                     for coordinate, values in zip(rect, (xs, ys, xs, ys)))
        remove(rect)
        left, bottom, right, top = rect
        cut_edges = [edge for edge, cut in (("left", left > .000001), ("right", right < sheet_width - .000001),
                                            ("bottom", bottom > .000001), ("top", top < sheet_height - .000001)) if cut]
        left += cut_edge_allowance if "left" in cut_edges else 0
        right -= cut_edge_allowance if "right" in cut_edges else 0
        bottom += cut_edge_allowance if "bottom" in cut_edges else 0
        top -= cut_edge_allowance if "top" in cut_edges else 0
        # Round inward, so numeric formatting cannot expand a proposed piece.
        left, bottom = math.ceil((left - .0000001) * 1000) / 1000, math.ceil((bottom - .0000001) * 1000) / 1000
        right, top = math.floor((right + .0000001) * 1000) / 1000, math.floor((top + .0000001) * 1000) / 1000
        width, height = round(right - left, 3), round(top - bottom, 3)
        if min(width, height) <= 0 or min(width, height) < minimum_offcut_size:
            continue
        if portrait:
            left, bottom, width, height = bottom, left, height, width
            sides = {"left": "bottom", "right": "top", "bottom": "left", "top": "right"}
            cut_edges = [sides[edge] for edge in cut_edges]
        edge = {"right": "left", "left": "right", "top": "bottom", "bottom": "top"}.get(cut_edges[0], "internal") if len(cut_edges) == 1 else "internal"
        proposals.append({"length": max(width, height), "width": min(width, height), "edge": edge,
                          "rectangle": {"x": left, "y": bottom, "width": width, "height": height},
                          "cutEdges": cut_edges, "cutEdgeAllowance": cut_edge_allowance,
                          "minimumOffcutSize": minimum_offcut_size, "layout": layout, "confidence": "high"})
    return sorted(proposals, key=lambda proposal: proposal["length"] * proposal["width"], reverse=True)


def _offcut(page, sheet_width, sheet_height, cut_edge_allowance=DEFAULT_CUT_EDGE_ALLOWANCE_MM, minimum_offcut_size=DEFAULT_MINIMUM_OFFCUT_SIZE_MM):
    # Legacy callers retain their single-proposal shape. The PDF response also
    # exposes the complete proposedOffcuts list for current clients.
    proposals = _offcuts(page, sheet_width, sheet_height, cut_edge_allowance, minimum_offcut_size)
    return {key: value for key, value in proposals[0].items() if key not in ("rectangle", "cutEdges")} if proposals else None


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
            proposed_offcuts = _offcuts(page, sheet_width, sheet_height, cut_edge_allowance, minimum_offcut_size) if size else []
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
                "proposedOffcuts": proposed_offcuts,
                "proposedOffcut": proposed_offcuts[0] if proposed_offcuts else None,
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

