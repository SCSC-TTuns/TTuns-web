#!/usr/bin/env python3
"""
Download SNU course data via "엑셀저장" and export LectureSlim JSON files.

Flow:
1) Select target semester via request payload
2) Trigger Excel export endpoint
3) Parse downloaded .xls and convert to local LectureSlim schema

Output schema (compatible with existing API):
[
  {
    "course_title": str,
    "instructor": str,
    "class_time_json": [{"day": int, "startMinute": int, "endMinute": int, "place": str}],
    "course_number": str,
    "lecture_number": str,
    "department": str,
    "year": int,
    "semester": int
  }
]
"""

from __future__ import annotations

import argparse
import json
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except Exception as exc:  # pragma: no cover
    raise SystemExit("requests is required. Install with: pip install requests xlrd") from exc

try:
    import xlrd
except Exception as exc:  # pragma: no cover
    raise SystemExit("xlrd is required. Install with: pip install requests xlrd") from exc


BASE_URL = "https://sugang.snu.ac.kr"
SEMESTER_META_ENDPOINT = "/sugang/cc/cc100ajax.action"
SEARCH_ENDPOINT = "/sugang/cc/cc100InterfaceSrch.action"
EXCEL_ENDPOINT = "/sugang/cc/cc100InterfaceExcel.action"

DAY_KO_TO_INDEX = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}
DAY_EN_TO_INDEX = {
    "MON": 0,
    "TUE": 1,
    "WED": 2,
    "THU": 3,
    "FRI": 4,
    "SAT": 5,
    "SUN": 6,
}

DAY_TIME_KO_RE = re.compile(r"([월화수목금토일])\s*\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)")
DAY_TIME_EN_RE = re.compile(
    r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\s*\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)",
    re.IGNORECASE,
)

DEFAULT_TERMS: Tuple[Tuple[int, int], ...] = (
    (2024, 1),
    (2024, 2),
    (2024, 3),
    (2024, 4),
    (2025, 1),
    (2025, 2),
    (2025, 3),
    (2025, 4),
    (2026, 1),
)

DEFAULT_SHTM_CODES = {
    1: "U000200001U000300001",  # 1st semester
    2: "U000200001U000300002",  # summer
    3: "U000200002U000300001",  # 2nd semester
    4: "U000200002U000300002",  # winter
}

# Hidden fields from form HD102; Excel endpoint expects full field set.
HD102_FIELD_NAMES: Tuple[str, ...] = (
    "workType",
    "pageNo",
    "srchOpenSchyy",
    "srchOpenShtm",
    "srchSbjtNm",
    "srchSbjtCd",
    "seeMore",
    "srchCptnCorsFg",
    "srchOpenShyr",
    "srchOpenUpSbjtFldCd",
    "srchOpenSbjtFldCd",
    "srchOpenUpDeptCd",
    "srchOpenDeptCd",
    "srchOpenMjCd",
    "srchOpenSubmattCorsFg",
    "srchOpenSubmattFgCd1",
    "srchOpenSubmattFgCd2",
    "srchOpenSubmattFgCd3",
    "srchOpenSubmattFgCd4",
    "srchOpenSubmattFgCd5",
    "srchOpenSubmattFgCd6",
    "srchOpenSubmattFgCd7",
    "srchOpenSubmattFgCd8",
    "srchOpenSubmattFgCd9",
    "srchExcept",
    "srchOpenPntMin",
    "srchOpenPntMax",
    "srchCamp",
    "srchBdNo",
    "srchProfNm",
    "srchOpenSbjtTmNm",
    "srchOpenSbjtDayNm",
    "srchOpenSbjtTm",
    "srchOpenSbjtNm",
    "srchTlsnAplyCapaCntMin",
    "srchTlsnAplyCapaCntMax",
    "srchLsnProgType",
    "srchTlsnRcntMin",
    "srchTlsnRcntMax",
    "srchMrksGvMthd",
    "srchIsEngSbjt",
    "srchMrksApprMthdChgPosbYn",
    "srchIsPendingCourse",
    "srchGenrlRemoteLtYn",
    "srchLanguage",
    "srchCurrPage",
    "srchPageSize",
)


class CrawlError(RuntimeError):
    pass


@dataclass(frozen=True)
class Term:
    year: int
    semester: int  # canonical: 1,2,3,4

    @property
    def key(self) -> str:
        return f"{self.year}-{self.semester}"


@dataclass
class ParseStats:
    total_rows: int = 0
    emitted_rows: int = 0
    failed_rows: int = 0


class SugangClient:
    def __init__(
        self,
        session: requests.Session,
        max_attempts: int = 5,
        connect_timeout_sec: int = 10,
        read_timeout_sec: int = 30,
    ):
        self.session = session
        self.max_attempts = max_attempts
        self.connect_timeout_sec = connect_timeout_sec
        self.read_timeout_sec = read_timeout_sec

    def post_form(self, endpoint: str, data: Dict[str, str]) -> requests.Response:
        url = f"{BASE_URL}{endpoint}"
        last_exc: Optional[Exception] = None

        for attempt in range(1, self.max_attempts + 1):
            try:
                resp = self.session.post(
                    url,
                    data=data,
                    timeout=(self.connect_timeout_sec, self.read_timeout_sec),
                )
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise CrawlError(f"transient status={resp.status_code} endpoint={endpoint}")
                if resp.status_code >= 400:
                    raise CrawlError(f"http status={resp.status_code} endpoint={endpoint}")
                return resp
            except Exception as exc:
                last_exc = exc
                if attempt >= self.max_attempts:
                    break
                backoff = min(8.0, (2 ** (attempt - 1)) * 0.5) + random.uniform(0.0, 0.35)
                time.sleep(backoff)

        raise CrawlError(f"request failed endpoint={endpoint}: {last_exc}")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            ),
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "*/*",
            "Origin": BASE_URL,
            "Referer": f"{BASE_URL}/sugang/co/co010.action",
            "Connection": "close",
        }
    )
    return session


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def canonical_sem_from_kor_name(kor_name: str) -> Optional[int]:
    text = (kor_name or "").strip()
    if "여름" in text:
        return 2
    if "겨울" in text:
        return 4
    if "2학기" in text:
        return 3
    if "1학기" in text:
        return 1
    return None


def fetch_semester_code_map(client: SugangClient) -> Dict[int, str]:
    payload = {"openUpDeptCd": "", "openDeptCd": ""}
    resp = client.post_form(SEMESTER_META_ENDPOINT, payload)
    try:
        data = json.loads(resp.text)
    except json.JSONDecodeError as exc:
        raise CrawlError("failed to parse semester metadata JSON") from exc

    out = dict(DEFAULT_SHTM_CODES)
    for row in data.get("SHTM", []):
        cmmn_cd = str(row.get("cmmnCd", "")).strip()
        kor_nm = str(row.get("korNm", "")).strip()
        canonical = canonical_sem_from_kor_name(kor_nm)
        if canonical and cmmn_cd:
            out[canonical] = cmmn_cd

    return out


def parse_term_arg(raw: str) -> Term:
    text = raw.strip()
    m = re.match(r"^(\d{4})[-_/](\w+)$", text)
    if not m:
        raise argparse.ArgumentTypeError("--term must look like YYYY-N (e.g., 2026-1)")

    year = int(m.group(1))
    sem_token = m.group(2).upper()

    if sem_token in {"1", "2", "3", "4"}:
        sem = int(sem_token)
    elif sem_token in {"S", "SUMMER"}:
        sem = 2
    elif sem_token in {"W", "WINTER"}:
        sem = 4
    elif sem_token in {"F", "FALL", "SECOND", "AUTUMN"}:
        sem = 3
    else:
        raise argparse.ArgumentTypeError(f"invalid semester token: {sem_token}")

    return Term(year=year, semester=sem)


def build_terms_from_args(term_args: Optional[List[Term]]) -> List[Term]:
    if not term_args:
        return [Term(year=y, semester=s) for y, s in DEFAULT_TERMS]

    uniq: Dict[str, Term] = {}
    for term in term_args:
        uniq[term.key] = term
    return [uniq[k] for k in sorted(uniq.keys())]


def search_payload(term: Term, sem_code: str) -> Dict[str, str]:
    return {
        "workType": "S",
        "pageNo": "1",
        "srchOpenSchyy": str(term.year),
        "srchOpenShtm": sem_code,
        "srchLanguage": "ko",
        "srchCurrPage": "1",
        "srchPageSize": "9999",
    }


def excel_payload(term: Term, sem_code: str) -> Dict[str, str]:
    payload = {name: "" for name in HD102_FIELD_NAMES}
    payload.update(
        {
            "workType": "EX",
            "pageNo": "1",
            "srchOpenSchyy": str(term.year),
            "srchOpenShtm": sem_code,
            "srchLanguage": "ko",
            "srchCurrPage": "1",
            "srchPageSize": "9999",
        }
    )
    return payload


def download_excel_for_term(client: SugangClient, term: Term, sem_code: str) -> bytes:
    # Keep the same flow as UI: search first, then excel export.
    client.post_form(SEARCH_ENDPOINT, search_payload(term, sem_code))
    resp = client.post_form(EXCEL_ENDPOINT, excel_payload(term, sem_code))

    content = resp.content or b""
    if not content:
        raise CrawlError(f"[{term.key}] excel response is empty")

    # Expected legacy XLS magic bytes (OLE2): D0 CF 11 E0 ...
    if not content.startswith(b"\xd0\xcf\x11\xe0"):
        snippet = normalize_space(resp.text)[:160]
        raise CrawlError(f"[{term.key}] unexpected excel response body: {snippet!r}")

    return content


def parse_hhmm(value: str) -> Optional[int]:
    m = re.match(r"^(\d{1,2}):(\d{2})$", value.strip())
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2))
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return hh * 60 + mm


def parse_day_time_tokens(raw: str) -> List[Tuple[int, int, int]]:
    text = normalize_space(raw)
    out: List[Tuple[int, int, int]] = []

    for day_ko, start_s, end_s in DAY_TIME_KO_RE.findall(text):
        day = DAY_KO_TO_INDEX.get(day_ko)
        start = parse_hhmm(start_s)
        end = parse_hhmm(end_s)
        if day is None or start is None or end is None or end <= start:
            continue
        out.append((day, start, end))

    for day_en, start_s, end_s in DAY_TIME_EN_RE.findall(text):
        day = DAY_EN_TO_INDEX.get(day_en.upper())
        start = parse_hhmm(start_s)
        end = parse_hhmm(end_s)
        if day is None or start is None or end is None or end <= start:
            continue
        out.append((day, start, end))

    return out


def normalize_place(raw: str) -> str:
    place = normalize_space(raw)
    if place in {"", "-", "/"}:
        return ""
    while place:
        updated = re.sub(r"\s*\([^)]*\)\s*$", "", place).strip()
        if updated == place:
            break
        place = updated
    if place in {"", "-", "/"}:
        return ""
    return place


def split_places(raw: str) -> List[str]:
    text = normalize_space(raw)
    if not text:
        return []
    parts = re.split(r"\s*/\s*|\s*\n+\s*", text)
    out = [p for p in (normalize_space(x) for x in parts) if p and p not in {"-", "/"}]
    return out


def clean_instructor(raw: str) -> str:
    text = normalize_space(raw)
    if not text:
        return ""
    text = re.sub(r"\s*\([^)]*\)", "", text)
    text = re.sub(r"\s*,\s*", ", ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,")


def build_course_title(base_title: str, subtitle: str, fallback_title: str) -> str:
    base = normalize_space(base_title)
    sub = normalize_space(subtitle)
    fallback = normalize_space(fallback_title)

    if base and sub and sub not in ("-",):
        if sub not in base:
            return f"{base} ({sub})"
        return base
    if base:
        return base
    if fallback:
        return fallback
    return ""


def cell_text(sheet: xlrd.sheet.Sheet, row: int, col: int) -> str:
    if row >= sheet.nrows or col >= sheet.ncols:
        return ""
    value = sheet.cell_value(row, col)
    return normalize_space(str(value))


def find_col(headers: List[str], candidates: Tuple[str, ...]) -> Optional[int]:
    for cand in candidates:
        for idx, header in enumerate(headers):
            if header == cand:
                return idx
    for cand in candidates:
        for idx, header in enumerate(headers):
            if cand and cand in header:
                return idx
    return None


def resolve_excel_columns(sheet: xlrd.sheet.Sheet) -> Dict[str, int]:
    if sheet.nrows < 3:
        raise CrawlError("excel sheet is missing header rows")

    headers = [cell_text(sheet, 2, c) for c in range(sheet.ncols)]
    specs: Dict[str, Tuple[str, ...]] = {
        "course_number": ("교과목번호",),
        "lecture_number": ("강좌번호",),
        "course_title": ("교과목명",),
        "subtitle": ("부제명",),
        "department": ("개설학과",),
        "time": ("수업교시",),
        "place": ("강의실(동-호)(#연건, *평창)", "강의실(동-호)"),
        "instructor": ("주담당교수", "담당교수"),
    }

    cols: Dict[str, int] = {}
    missing: List[str] = []
    for key, candidates in specs.items():
        idx = find_col(headers, candidates)
        if idx is None:
            missing.append(key)
        else:
            cols[key] = idx

    if missing:
        raise CrawlError(f"excel header mismatch; missing columns: {', '.join(sorted(missing))}")

    return cols


def parse_class_time_json(raw_time: str, raw_place: str) -> List[Dict[str, Any]]:
    tokens = parse_day_time_tokens(raw_time)
    if not tokens:
        return []

    places = split_places(raw_place)
    out: List[Dict[str, Any]] = []
    for idx, (day, start_minute, end_minute) in enumerate(tokens):
        place = ""
        if places:
            if len(places) == 1:
                place = places[0]
            elif idx < len(places):
                place = places[idx]
            else:
                place = places[-1]

        out.append(
            {
                "day": day,
                "startMinute": start_minute,
                "endMinute": end_minute,
                "place": normalize_place(place),
            }
        )
    return out


def parse_excel_to_lectures(
    excel_bytes: bytes,
    term: Term,
    max_details: Optional[int],
) -> Tuple[List[Dict[str, Any]], ParseStats]:
    book = xlrd.open_workbook(file_contents=excel_bytes)
    if book.nsheets <= 0:
        raise CrawlError("excel workbook has no sheets")
    sheet = book.sheet_by_index(0)

    cols = resolve_excel_columns(sheet)
    stats = ParseStats()
    lectures: List[Dict[str, Any]] = []

    for row in range(3, sheet.nrows):
        if max_details is not None and len(lectures) >= max_details:
            break

        # Skip fully empty rows.
        if not any(cell_text(sheet, row, c) for c in range(sheet.ncols)):
            continue

        stats.total_rows += 1
        try:
            title = build_course_title(
                cell_text(sheet, row, cols["course_title"]),
                cell_text(sheet, row, cols["subtitle"]),
                "",
            )
            lecture = {
                "course_title": title,
                "instructor": clean_instructor(cell_text(sheet, row, cols["instructor"])),
                "class_time_json": parse_class_time_json(
                    cell_text(sheet, row, cols["time"]),
                    cell_text(sheet, row, cols["place"]),
                ),
                "course_number": cell_text(sheet, row, cols["course_number"]),
                "lecture_number": cell_text(sheet, row, cols["lecture_number"]),
                "department": cell_text(sheet, row, cols["department"]),
                "year": term.year,
                "semester": term.semester,
            }
            lectures.append(lecture)
            stats.emitted_rows += 1
        except Exception:
            stats.failed_rows += 1

    return lectures, stats


def crawl_term(
    client: SugangClient,
    term: Term,
    sem_code: str,
    out_dir: Path,
    max_details: Optional[int],
    force: bool,
    keep_xls: bool,
) -> Dict[str, Any]:
    term_key = term.key
    out_file = out_dir / f"{term_key}.json"

    if out_file.exists() and not force:
        existing = json.loads(out_file.read_text(encoding="utf-8"))
        count = len(existing) if isinstance(existing, list) else 0
        print(f"[{term_key}] skip (exists): {out_file}")
        return {
            "term": term_key,
            "year": term.year,
            "semester": term.semester,
            "count": count,
            "source": "https://sugang.snu.ac.kr",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "failedRows": 0,
            "totalRows": count,
        }

    excel_bytes = download_excel_for_term(client, term, sem_code)
    if keep_xls:
        xls_path = out_dir / ".tmp" / f"{term_key}.xls"
        xls_path.parent.mkdir(parents=True, exist_ok=True)
        xls_path.write_bytes(excel_bytes)
        print(f"[{term_key}] xls saved: {xls_path}")

    lectures, parse_stats = parse_excel_to_lectures(excel_bytes, term, max_details=max_details)

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(lectures, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[{term_key}] excelRows={parse_stats.total_rows} "
        f"emitted={parse_stats.emitted_rows} failed={parse_stats.failed_rows}"
    )

    return {
        "term": term_key,
        "year": term.year,
        "semester": term.semester,
        "count": len(lectures),
        "source": "https://sugang.snu.ac.kr",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "failedRows": parse_stats.failed_rows,
        "totalRows": parse_stats.total_rows,
    }


def write_index(out_dir: Path, summaries: List[Dict[str, Any]]) -> None:
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "https://sugang.snu.ac.kr",
        "terms": summaries,
        "totalCount": sum(int(x.get("count", 0)) for x in summaries),
    }
    with (out_dir / "index.json").open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download SNU sugang Excel and export LectureSlim JSON files.",
    )
    parser.add_argument("--workers", type=int, default=8, help="compat option (ignored in excel mode)")
    parser.add_argument("--force", action="store_true", help="overwrite existing outputs")
    parser.add_argument(
        "--term",
        action="append",
        type=parse_term_arg,
        help="target term, can repeat. format: YYYY-N (N in 1|2|3|4|S|W)",
    )
    parser.add_argument("--max-pages", type=int, default=None, help="compat option (ignored in excel mode)")
    parser.add_argument(
        "--max-details",
        type=int,
        default=None,
        help="limit number of parsed lecture rows per term",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("data") / "sugang",
        help="output directory (default: data/sugang)",
    )
    parser.add_argument(
        "--keep-xls",
        action="store_true",
        help="save downloaded .xls to out-dir/.tmp for debugging",
    )

    args = parser.parse_args()

    if args.workers <= 0:
        raise SystemExit("--workers must be > 0")
    if args.max_pages is not None:
        print("note: --max-pages is ignored in excel mode")

    out_dir: Path = args.out_dir
    (out_dir / ".tmp").mkdir(parents=True, exist_ok=True)

    terms = build_terms_from_args(args.term)

    session = build_session()
    client = SugangClient(
        session=session,
        max_attempts=5,
        connect_timeout_sec=10,
        read_timeout_sec=60,
    )

    # Initialize session cookies and fetch semester code metadata.
    client.post_form(SEMESTER_META_ENDPOINT, {"openUpDeptCd": "", "openDeptCd": ""})
    sem_codes = fetch_semester_code_map(client)

    summaries: List[Dict[str, Any]] = []
    for term in terms:
        sem_code = sem_codes.get(term.semester)
        if not sem_code:
            raise CrawlError(f"missing semester code for canonical semester={term.semester}")
        summary = crawl_term(
            client=client,
            term=term,
            sem_code=sem_code,
            out_dir=out_dir,
            max_details=args.max_details,
            force=args.force,
            keep_xls=args.keep_xls,
        )
        summaries.append(summary)

    write_index(out_dir, summaries)

    print("\nDone.")
    for row in summaries:
        print(f" - {row['term']}: {row['count']} lectures (failed rows: {row['failedRows']})")
    print(f"Index: {out_dir / 'index.json'}")


if __name__ == "__main__":
    main()
