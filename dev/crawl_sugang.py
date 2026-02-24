#!/usr/bin/env python3
"""
Crawl SNU course data from sugang.snu.ac.kr and export LectureSlim JSON files.

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
import math
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import requests
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "requests is required. Install with: pip install requests beautifulsoup4"
    ) from exc

try:
    from bs4 import BeautifulSoup
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "beautifulsoup4 is required. Install with: pip install requests beautifulsoup4"
    ) from exc


BASE_URL = "https://sugang.snu.ac.kr"
LIST_ENDPOINT = "/sugang/cc/cc100InterfaceSrch.action"
DETAIL_ENDPOINT = "/sugang/cc/cc101ajax.action"
SEMESTER_META_ENDPOINT = "/sugang/cc/cc100ajax.action"

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

DAY_TIME_KO_RE = re.compile(r"([월화수목금토일])\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)")
DAY_TIME_EN_RE = re.compile(
    r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)",
    re.IGNORECASE,
)
TOTAL_COUNT_RE = re.compile(r"([0-9][0-9,]*)\s*건")

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


class CrawlError(RuntimeError):
    pass


@dataclass(frozen=True)
class Term:
    year: int
    semester: int  # canonical: 1,2,3,4

    @property
    def key(self) -> str:
        return f"{self.year}-{self.semester}"


@dataclass(frozen=True)
class CourseStub:
    key: str
    open_schyy: str
    open_shtm_fg: str
    open_deta_shtm_fg: str
    sbjt_cd: str
    lt_no: str
    sbjt_subh_cd: str
    fallback_title: str


@dataclass
class CrawlStats:
    total_count: int = 0
    page_count: int = 0
    listed_rows: int = 0
    unique_rows: int = 0
    resumed_rows: int = 0
    fetched_rows: int = 0
    failed_rows: int = 0


class SugangClient:
    def __init__(
        self,
        session: requests.Session,
        max_attempts: int = 5,
        connect_timeout_sec: int = 10,
        read_timeout_sec: int = 20,
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
    raw = resp.text
    try:
        data = json.loads(raw)
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


def parse_total_count(soup: BeautifulSoup) -> int:
    small = soup.select_one(".search-result-con small")
    if not small:
        return 0
    text = small.get_text(" ", strip=True)
    m = TOTAL_COUNT_RE.search(text)
    if not m:
        return 0
    return int(m.group(1).replace(",", ""))


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def build_stub_from_item(item: Any) -> Optional[CourseStub]:
    hidden: Dict[str, str] = {}
    for inp in item.select("input[type='hidden']"):
        name = (inp.get("name") or "").strip()
        if not name:
            continue
        hidden[name] = normalize_space(str(inp.get("value") or ""))

    required = ["openSchyy", "openShtmFg", "openDetaShtmFg", "sbjtCd", "ltNo", "sbjtSubhCd"]
    if not all(hidden.get(k) for k in required):
        return None

    title_node = item.select_one(".course-name strong")
    fallback_title = normalize_space(title_node.get_text(" ", strip=True) if title_node else "")

    key = "|".join(
        [
            hidden["openSchyy"],
            hidden["openShtmFg"],
            hidden["openDetaShtmFg"],
            hidden["sbjtCd"],
            hidden["ltNo"],
            hidden["sbjtSubhCd"],
        ]
    )

    return CourseStub(
        key=key,
        open_schyy=hidden["openSchyy"],
        open_shtm_fg=hidden["openShtmFg"],
        open_deta_shtm_fg=hidden["openDetaShtmFg"],
        sbjt_cd=hidden["sbjtCd"],
        lt_no=hidden["ltNo"],
        sbjt_subh_cd=hidden["sbjtSubhCd"],
        fallback_title=fallback_title,
    )


def list_page_payload(year: int, sem_code: str, page_no: int) -> Dict[str, str]:
    return {
        "workType": "S",
        "pageNo": str(page_no),
        "srchOpenSchyy": str(year),
        "srchOpenShtm": sem_code,
        "srchLanguage": "ko",
        "srchCurrPage": str(page_no),
        "srchPageSize": "9999",
    }


def collect_course_stubs(
    client: SugangClient,
    term: Term,
    sem_code: str,
    max_pages: Optional[int],
) -> Tuple[List[CourseStub], CrawlStats]:
    stats = CrawlStats()

    first = client.post_form(LIST_ENDPOINT, list_page_payload(term.year, sem_code, 1))
    soup = BeautifulSoup(first.text, "html.parser")

    total = parse_total_count(soup)
    stats.total_count = total

    estimated_pages = max(1, math.ceil(total / 10)) if total > 0 else 1
    if max_pages is not None:
        estimated_pages = min(estimated_pages, max_pages)
    stats.page_count = estimated_pages

    stubs: List[CourseStub] = []

    def parse_soup(page_soup: BeautifulSoup) -> None:
        nonlocal stubs, stats
        items = page_soup.select(".course-info-item")
        for item in items:
            stub = build_stub_from_item(item)
            if stub is None:
                continue
            stubs.append(stub)
            stats.listed_rows += 1

    parse_soup(soup)

    for page_no in range(2, estimated_pages + 1):
        if page_no % 100 == 0 or page_no == estimated_pages:
            print(f"[{term.key}] list progress {page_no}/{estimated_pages}")
        resp = client.post_form(LIST_ENDPOINT, list_page_payload(term.year, sem_code, page_no))
        parse_soup(BeautifulSoup(resp.text, "html.parser"))

    return stubs, stats


def parse_hhmm(value: str) -> Optional[int]:
    m = re.match(r"^(\d{1,2}):(\d{2})$", value.strip())
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2))
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return hh * 60 + mm


def normalize_place(raw: str) -> str:
    place = normalize_space(raw)
    # Remove trailing parenthetical metadata e.g., "(무선랜제공)"
    while place:
        updated = re.sub(r"\s*\([^)]*\)\s*$", "", place).strip()
        if updated == place:
            break
        place = updated
    return place


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

    if base and sub and sub not in ("-", "-"):
        if sub not in base:
            return f"{base} ({sub})"
        return base
    if base:
        return base
    if fallback:
        return fallback
    return ""


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


def detail_payload(stub: CourseStub) -> Dict[str, str]:
    return {
        "workType": "",
        "openSchyy": stub.open_schyy,
        "openShtmFg": stub.open_shtm_fg,
        "openDetaShtmFg": stub.open_deta_shtm_fg,
        "sbjtCd": stub.sbjt_cd,
        "ltNo": stub.lt_no,
        "sbjtSubhCd": stub.sbjt_subh_cd,
        "t_profPersNo": "",
    }


def parse_detail_json(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CrawlError("detail JSON parse failed") from exc


def transform_detail_to_slim(term: Term, stub: CourseStub, detail: Dict[str, Any]) -> Dict[str, Any]:
    tab = detail.get("LISTTAB01") or {}

    title = build_course_title(
        str(tab.get("sbjtNm") or ""),
        str(tab.get("sbjtSubhNm") or ""),
        stub.fallback_title,
    )

    instructor = clean_instructor(str(tab.get("profNm") or ""))
    department = normalize_space(str(tab.get("departmentKorNm") or tab.get("deptKorNm") or ""))
    course_number = normalize_space(str(tab.get("sbjtCd") or stub.sbjt_cd))
    lecture_number = normalize_space(str(tab.get("ltNo") or stub.lt_no))

    lt_times = detail.get("ltTime") if isinstance(detail.get("ltTime"), list) else []
    lt_rooms = detail.get("ltRoom") if isinstance(detail.get("ltRoom"), list) else []

    # Fallback: when ltTime[] is empty, use LISTTAB01.ltTime string.
    if not any(normalize_space(str(v)) for v in lt_times):
        fallback_time = normalize_space(str(tab.get("ltTime") or ""))
        if fallback_time:
            lt_times = [fallback_time]

    if not any(normalize_space(str(v)) for v in lt_rooms):
        fallback_room = normalize_space(str(tab.get("ltRoom") or ""))
        if fallback_room:
            lt_rooms = [fallback_room]

    class_time_json: List[Dict[str, Any]] = []

    for idx, raw_time in enumerate(lt_times):
        time_text = normalize_space(str(raw_time))
        if not time_text:
            continue

        tokens = parse_day_time_tokens(time_text)
        if not tokens:
            continue

        room_text = normalize_space(str(lt_rooms[idx] if idx < len(lt_rooms) else (lt_rooms[0] if lt_rooms else "")))
        place = normalize_place(room_text)

        for day, start_minute, end_minute in tokens:
            class_time_json.append(
                {
                    "day": day,
                    "startMinute": start_minute,
                    "endMinute": end_minute,
                    "place": place,
                }
            )

    return {
        "course_title": title,
        "instructor": instructor,
        "class_time_json": class_time_json,
        "course_number": course_number,
        "lecture_number": lecture_number,
        "department": department,
        "year": term.year,
        "semester": term.semester,
    }


def load_checkpoint_map(path: Path) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        return out

    with path.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                key = str(row.get("key") or "")
                lecture = row.get("lecture")
                if key and isinstance(lecture, dict):
                    out[key] = lecture
            except Exception:
                continue

    return out


def append_checkpoint(path: Path, key: str, lecture: Dict[str, Any], lock: threading.Lock) -> None:
    row = {"key": key, "lecture": lecture}
    data = json.dumps(row, ensure_ascii=False)
    with lock:
        with path.open("a", encoding="utf-8") as fp:
            fp.write(data)
            fp.write("\n")


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

    if sem not in {1, 2, 3, 4}:
        raise argparse.ArgumentTypeError("semester must be one of 1|2|3|4|S|W")

    return Term(year=year, semester=sem)


def build_terms_from_args(term_args: Optional[List[Term]]) -> List[Term]:
    if not term_args:
        return [Term(year=y, semester=s) for y, s in DEFAULT_TERMS]

    uniq: Dict[str, Term] = {}
    for term in term_args:
        uniq[term.key] = term
    return [uniq[k] for k in sorted(uniq.keys())]


def crawl_term(
    client: SugangClient,
    term: Term,
    sem_code: str,
    out_dir: Path,
    workers: int,
    max_pages: Optional[int],
    max_details: Optional[int],
    force: bool,
) -> Dict[str, Any]:
    term_key = term.key
    out_file = out_dir / f"{term_key}.json"
    tmp_file = out_dir / ".tmp" / f"{term_key}.jsonl"

    if force:
        if out_file.exists():
            out_file.unlink()
        if tmp_file.exists():
            tmp_file.unlink()

    stubs, stats = collect_course_stubs(client, term, sem_code, max_pages=max_pages)

    unique_stubs: Dict[str, CourseStub] = {}
    ordered_keys: List[str] = []
    for stub in stubs:
        if stub.key in unique_stubs:
            continue
        unique_stubs[stub.key] = stub
        ordered_keys.append(stub.key)
    stats.unique_rows = len(unique_stubs)

    checkpoint_map = load_checkpoint_map(tmp_file)
    stats.resumed_rows = len(checkpoint_map)

    if max_details is not None:
        ordered_keys = ordered_keys[: max(0, max_details)]

    pending_keys = [k for k in ordered_keys if k not in checkpoint_map]

    print(
        f"[{term_key}] total={stats.total_count} pages={stats.page_count} "
        f"listed={stats.listed_rows} unique={stats.unique_rows} resumed={stats.resumed_rows} pending={len(pending_keys)}"
    )

    lock = threading.Lock()

    def worker(stub: CourseStub) -> Tuple[str, Dict[str, Any]]:
        response = client.post_form(DETAIL_ENDPOINT, detail_payload(stub))
        detail = parse_detail_json(response.text)
        lecture = transform_detail_to_slim(term, stub, detail)
        return stub.key, lecture

    if pending_keys:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(worker, unique_stubs[k]): k for k in pending_keys}

            for idx, future in enumerate(as_completed(futures), start=1):
                key = futures[future]
                try:
                    result_key, lecture = future.result()
                    checkpoint_map[result_key] = lecture
                    append_checkpoint(tmp_file, result_key, lecture, lock)
                    stats.fetched_rows += 1
                except Exception as exc:
                    stats.failed_rows += 1
                    print(f"[{term_key}] detail failed key={key}: {exc}")

                if idx % 200 == 0 or idx == len(futures):
                    print(
                        f"[{term_key}] detail progress {idx}/{len(futures)} "
                        f"fetched={stats.fetched_rows} failed={stats.failed_rows}"
                    )

    final_keys = ordered_keys
    final_data = [checkpoint_map[k] for k in final_keys if k in checkpoint_map]

    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as fp:
        json.dump(final_data, fp, ensure_ascii=False, indent=2)

    generated_at = datetime.now(timezone.utc).isoformat()
    return {
        "term": term_key,
        "year": term.year,
        "semester": term.semester,
        "count": len(final_data),
        "source": "https://sugang.snu.ac.kr",
        "generatedAt": generated_at,
        "failedRows": stats.failed_rows,
        "totalRows": stats.total_count,
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
        description="Crawl SNU sugang and export LectureSlim JSON files.",
    )
    parser.add_argument("--workers", type=int, default=8, help="detail request workers (default: 8)")
    parser.add_argument("--force", action="store_true", help="overwrite existing outputs and checkpoint")
    parser.add_argument(
        "--term",
        action="append",
        type=parse_term_arg,
        help="target term, can repeat. format: YYYY-N (N in 1|2|3|4|S|W)",
    )
    parser.add_argument("--max-pages", type=int, default=None, help="limit list pages per term")
    parser.add_argument(
        "--max-details",
        type=int,
        default=None,
        help="limit number of unique lecture details per term",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("data") / "sugang",
        help="output directory (default: data/sugang)",
    )

    args = parser.parse_args()

    if args.workers <= 0:
        raise SystemExit("--workers must be > 0")

    out_dir: Path = args.out_dir
    (out_dir / ".tmp").mkdir(parents=True, exist_ok=True)

    terms = build_terms_from_args(args.term)

    session = build_session()
    client = SugangClient(
        session=session,
        max_attempts=5,
        connect_timeout_sec=10,
        read_timeout_sec=20,
    )

    # Initialize session cookies via homepage
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
            workers=args.workers,
            max_pages=args.max_pages,
            max_details=args.max_details,
            force=args.force,
        )
        summaries.append(summary)

    write_index(out_dir, summaries)

    print("\nDone.")
    for row in summaries:
        print(f" - {row['term']}: {row['count']} lectures (failed detail rows: {row['failedRows']})")
    print(f"Index: {out_dir / 'index.json'}")


if __name__ == "__main__":
    main()
