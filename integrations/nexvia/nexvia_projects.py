#!/usr/bin/env python3
"""Refresh the NAS project directory from authenticated Nexvia project links.

The demonstrated source is /staff/projects. Only existing native pagination
links are followed. An unproven/partial listing is merged into the last cache;
it never removes previously known projects. This process does not create POs.
"""

import argparse
from datetime import datetime, timezone
import fcntl
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit


ORIGIN = "https://lennox.nexvia.com.au"
INDEX_PATH = "/staff/projects"
PROJECTS = Path("/config/nexvia-projects.json")
MAX_PROJECTS = 5000
MAX_PAGES = 100
MAX_BYTES = 8 * 1024 * 1024
REFRESH_SECONDS = 300
PAGE_KEYS = {"page", "p", "offset", "skip", "take", "limit", "per_page", "page_size", "pagesize"}
CONTEXT_KEYS = {"sort", "order", "direction", "status", "view"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class ProjectRefreshError(Exception):
    """Messages contain no remote bodies, credentials or customer names."""


def require(condition, message):
    if not condition:
        raise ProjectRefreshError(message)


def listing_url(value, base=ORIGIN + INDEX_PATH):
    """Accept only an actual same-origin native listing/pagination URL."""
    if not isinstance(value, str) or len(value) > 2000:
        return None
    try:
        url = urlsplit(urljoin(base, value))
        if url.scheme != "https" or url.netloc != "lennox.nexvia.com.au" or url.path.rstrip("/") != INDEX_PATH or url.fragment:
            return None
        query = parse_qsl(url.query, keep_blank_values=True)
        seen = set()
        for key, item in query:
            lowered = key.lower()
            if lowered in seen or lowered not in PAGE_KEYS | CONTEXT_KEYS:
                return None
            seen.add(lowered)
            if lowered in PAGE_KEYS:
                if not re.fullmatch(r"[0-9]{1,7}", item):
                    return None
            elif not re.fullmatch(r"[A-Za-z0-9_.-]{0,80}", item):
                return None
        return ORIGIN + INDEX_PATH + ("?" + urlencode(sorted(query)) if query else "")
    except ValueError:
        return None


def normalized_project(value):
    require(isinstance(value, dict), "Invalid saved project directory")
    identifier = value.get("projectPageId")
    name = value.get("name")
    require(type(identifier) is int and 0 < identifier <= 9007199254740991,
            "Invalid saved project identity")
    require(isinstance(name, str), "Invalid saved project label")
    cleaned = " ".join(name.split())
    require(0 < len(cleaned.encode("utf-16-le")) // 2 <= 160
            and not re.search(r"[\x00-\x1f\x7f]", cleaned), "Invalid saved project label")
    return {"projectPageId":identifier, "name":cleaned}


def project_rows(value):
    require(isinstance(value, list) and len(value) <= MAX_PROJECTS,
            "Invalid saved project directory")
    rows = {}
    for item in value:
        project = normalized_project(item)
        identifier = project["projectPageId"]
        require(identifier not in rows, "Duplicate saved project identity")
        rows[identifier] = project
    return rows


class ProjectPage(HTMLParser):
    """Extract the exact project links demonstrated by the existing exporter."""

    def __init__(self, source_url):
        super().__init__(convert_charrefs=True)
        self.source_url = source_url
        self.stack = []
        self.anchor = None
        self.projects = {}
        self.pagination = set()
        self.infinite_marker = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").lower().split())
        if any("infinite" in value for value in classes) or "data-infinite-scroll" in attributes or "infinite-scroll" in attributes:
            self.infinite_marker = True
        parent_pager = any(pager for _, pager in self.stack)
        pager = parent_pager or any("pagination" in value or value.endswith("pager") for value in classes)
        if tag not in VOID_TAGS:
            self.stack.append((tag, pager))
        if tag == "a":
            rel = set((attributes.get("rel") or "").lower().split())
            aria = attributes.get("aria-label") or ""
            self.anchor = {"href":attributes.get("href", ""), "text":[],
                           "pager":pager or bool(rel & {"next", "prev", "previous", "first", "last"}) or bool(re.fullmatch(r"(?:page\s+[0-9]+|next(?: page)?|previous(?: page)?|first(?: page)?|last(?: page)?)", aria, re.I)),
                           "disabled":attributes.get("aria-disabled") == "true"}

    def handle_data(self, value):
        if self.anchor is not None:
            self.anchor["text"].append(value)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            self._anchor(self.anchor)
            self.anchor = None
        for index in range(len(self.stack)-1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def _anchor(self, anchor):
        try:
            url = urlsplit(urljoin(self.source_url, anchor["href"]))
        except ValueError:
            return
        if url.scheme != "https" or url.netloc != "lennox.nexvia.com.au":
            return
        match = re.fullmatch(r"/staff/project/([0-9]+)/modify/?", url.path)
        if match:
            name = " ".join("".join(anchor["text"]).split())
            if not name or name.casefold() == "open project":
                return
            project = normalized_project({"projectPageId":int(match[1]), "name":name})
            prior = self.projects.get(project["projectPageId"])
            if prior is None or len(name) > len(prior["name"]):
                self.projects[project["projectPageId"]] = project
        if anchor["pager"] and not anchor["disabled"]:
            destination = listing_url(anchor["href"], self.source_url)
            if destination:
                self.pagination.add(destination)


def parse_project_page(html, source_url):
    require(isinstance(html, str) and len(html.encode()) <= MAX_BYTES,
            "Project listing exceeds its size limit")
    require(listing_url(source_url) is not None, "Unexpected project listing destination")
    parser = ProjectPage(source_url)
    parser.feed(html)
    return {"projects":list(parser.projects.values()),
            "pagination":sorted(parser.pagination), "infiniteMarker":parser.infinite_marker}


def collect_projects(read_page, budget_seconds=60, monotonic=time.monotonic):
    """Crawl native links only. A page failure invalidates the entire capture."""
    deadline = monotonic() + budget_seconds
    pending, visited, projects = [ORIGIN + INDEX_PATH], set(), {}
    bounded = False
    while pending:
        if len(visited) >= MAX_PAGES or monotonic() >= deadline:
            bounded = True
            break
        url = pending.pop(0)
        if url in visited:
            continue
        visited.add(url)
        snapshot = parse_project_page(read_page(url), url)
        for project in snapshot["projects"]:
            identifier = project["projectPageId"]
            previous = projects.get(identifier)
            if previous is None or len(project["name"]) > len(previous["name"]):
                projects[identifier] = project
        require(len(projects) <= MAX_PROJECTS, "Project directory exceeds its size limit")
        for target in snapshot["pagination"]:
            if target not in visited and target not in pending:
                pending.append(target)
    require(projects, "No authenticated project links were observed")
    return {"projects":list(projects.values()), "complete":False,
            "pageCount":len(visited), "bounded":bounded,
            "warning":"Project listing completeness is not verified; earlier cached projects were retained."}


def readonly_route(route):
    if route.request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        route.continue_()
    else:
        route.abort()


def fetch_projects():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        contexts = [context for context in browser.contexts if any(
            page.url.startswith(ORIGIN + "/staff/") and "/login" not in urlsplit(page.url).path
            for page in context.pages)]
        require(contexts, "Nexvia sign-in is required for project refresh")
        page = contexts[0].new_page()
        page.route("**/*", readonly_route)
        try:
            def read_page(url):
                response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
                require(response and response.status == 200 and listing_url(page.url) == listing_url(url),
                        "Project listing redirected or is unavailable")
                try:
                    page.locator('a[href*="/staff/project/"][href*="/modify"]').first.wait_for(state="attached", timeout=5000)
                except Exception:
                    pass
                return page.content()
            return collect_projects(read_page)
        finally:
            page.close()


def read_object(path, missing=None):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Expected a regular cache file")
            raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "Saved project cache exceeds its size limit")
        value = json.loads(raw)
        require(isinstance(value, dict), "Saved project cache is invalid")
        return value
    except FileNotFoundError:
        return missing
    except (OSError, ValueError) as error:
        raise ProjectRefreshError("Saved project cache is unavailable or invalid") from error


def atomic_json(path, value):
    raw = json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False).encode()
    require(len(raw) <= MAX_BYTES, "Saved project cache exceeds its size limit")
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-projects-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def refresh_if_due(projects_path=PROJECTS, state_path=None, now=None,
                   interval_seconds=REFRESH_SECONDS, fetcher=None, force=False):
    projects_path = Path(projects_path)
    state_path = Path(state_path) if state_path is not None else projects_path.with_name("nexvia-project-refresh.json")
    now = time.time() if now is None else now
    require(type(now) in {int, float} and math.isfinite(now) and now >= 0, "Invalid project refresh time")
    require(type(interval_seconds) is int and 30 <= interval_seconds <= 86400, "Invalid project refresh interval")
    existing = read_object(projects_path, {"projects":[]})
    cached = project_rows(existing.get("projects"))
    descriptor = os.open(state_path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status":"busy", "projectCount":len(cached), "warning":None}
        # Another completed refresh may have replaced the cache before this lock.
        existing = read_object(projects_path, {"projects":[]})
        cached = project_rows(existing.get("projects"))
        state = read_object(state_path, {})
        next_attempt = state.get("nextAttemptAt", 0)
        if not force and type(next_attempt) in {int, float} and next_attempt > now:
            succeeded = state.get("lastAttemptSucceeded")
            if type(succeeded) is not bool:
                # Older state files did not record attempt outcome explicitly.
                attempt, success = state.get("lastAttemptAt"), state.get("lastSuccessAt")
                succeeded = (type(attempt) in {int, float} and type(success) in {int, float}
                             and math.isfinite(attempt) and math.isfinite(success) and success >= attempt)
            return {"status":"fresh" if succeeded else "retained_cache",
                    "projectCount":len(cached), "warning":state.get("warning")}
        # Persist the attempt before remote I/O, so failed refreshes are bounded too.
        state.update(version=1, lastAttemptAt=now, nextAttemptAt=now+interval_seconds,
                     lastAttemptSucceeded=False)
        atomic_json(state_path, state)
        try:
            capture = (fetcher or fetch_projects)()
            require(isinstance(capture, dict) and type(capture.get("complete")) is bool,
                    "Project discovery did not confirm its capture scope")
            observed = project_rows(capture.get("projects"))
            require(observed, "Project discovery returned no accessible projects")
            merged = observed if capture["complete"] else {**cached, **observed}
            require(len(merged) <= MAX_PROJECTS, "Project directory exceeds its size limit")
            updated = dict(existing)
            updated.update(projects=sorted(merged.values(), key=lambda row:(row["name"].casefold(),row["projectPageId"])),
                           refreshedAt=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                           refreshSource=INDEX_PATH,
                           snapshotCompleteness="complete" if capture["complete"] else "unverified")
            atomic_json(projects_path, updated)
            warning = None if capture["complete"] else "Project listing completeness is not verified; earlier cached projects were retained."
        except Exception:
            warning = "Project refresh is unavailable; the previous project cache was retained."
            state["warning"] = warning
            atomic_json(state_path, state)
            return {"status":"retained_cache", "projectCount":len(cached), "warning":warning}
        state.update(lastSuccessAt=now, lastAttemptSucceeded=True, warning=warning)
        # The cache is already committed. A state write failure must not falsely
        # report that the preceding cache was retained.
        try:
            atomic_json(state_path, state)
        except OSError:
            warning = "Project choices were refreshed; refresh status could not be saved."
        return {"status":"updated", "projectCount":len(merged), "warning":warning}
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Refresh if the five-minute interval has elapsed")
    parser.add_argument("--force", action="store_true", help="Read the native listing immediately")
    parser.add_argument("--output", type=Path, default=PROJECTS)
    parser.add_argument("--state", type=Path)
    args = parser.parse_args()
    if not args.refresh and not args.force:
        print("Use --refresh to update project choices from the existing NAS Nexvia sign-in.")
        return 0
    outcome = refresh_if_due(args.output, args.state, force=args.force)
    print("Project refresh:", outcome["status"], "—", outcome["projectCount"], "cached project(s).")
    if outcome["warning"]:
        print(outcome["warning"])
    return int(outcome["status"] in {"retained_cache", "busy"})


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProjectRefreshError:
        raise SystemExit("Project refresh could not finish; the previous project cache was retained.")
