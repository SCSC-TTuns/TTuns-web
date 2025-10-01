"""
Use Selenium to collect precise coordinates for SNU campus buildings via Google Maps.

Steps per building:
1. Open Google Maps.
2. Search for "서울대 관악캠퍼스 <동번호>동".
3. Wait for the new map position and extract latitude/longitude from the URL.
4. Store the results alongside building metadata from `snu_buildings.csv`.

This script avoids repeated manual "Share this location" clicks by re-using the
map center that Google Maps updates after each search. The coordinates align
with the values shown in the share dialog.

NOTE: This automation is for educational/personal use. Follow Google Maps' Terms
of Service and ensure you have the right to automate these queries. Excessive or
parallel executions may trigger bot protection.
"""

from __future__ import annotations

import csv
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


GOOGLE_MAPS_URL = "https://www.google.com/maps"
SEARCHBOX_ID = "searchboxinput"


@dataclass
class Building:
    number: str
    name: str


def load_buildings(csv_path: Path) -> list[Building]:
    df = pd.read_csv(csv_path, dtype=str).fillna("")
    buildings: list[Building] = []
    for _, row in df.iterrows():
        buildings.append(Building(number=row["동번호"], name=row["동(건물)명"]))
    return buildings


def configure_driver(headless: bool = False) -> webdriver.Chrome:
    options = Options()
    options.add_argument("--disable-gpu")
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--lang=ko-KR")
    if headless:
        options.add_argument("--headless=new")
    driver = webdriver.Chrome(options=options)
    driver.set_window_size(1280, 960)
    return driver


def accept_initial_dialogs(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    """Dismiss cookie or region popups if they appear."""

    possible_selectors = [
        (By.CSS_SELECTOR, "button[jsname='tWT92d']"),  # Accept all (EN/EU cookie)
        (By.CSS_SELECTOR, "button[jsname='RZzeR']"),   # Accept (KR)
        (By.CSS_SELECTOR, "button[aria-label='동의']"),
        (By.CSS_SELECTOR, "button[aria-label='모두 동의']"),
    ]

    for locator in possible_selectors:
        try:
            element = wait.until(EC.element_to_be_clickable(locator))
            element.click()
            time.sleep(1)
            break
        except TimeoutException:
            continue


def wait_for_search_box(driver: webdriver.Chrome, wait: WebDriverWait):
    return wait.until(EC.presence_of_element_located((By.ID, SEARCHBOX_ID)))


def submit_query(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    query: str,
    ensure_focus: bool = True,
) -> None:
    search_box = wait_for_search_box(driver, wait)
    # Ensure focus to avoid stale input
    if ensure_focus:
        ActionChains(driver).move_to_element(search_box).click().perform()
    search_box.clear()
    search_box.send_keys(query)
    search_box.send_keys(Keys.ENTER)


def get_coordinates_from_url(url: str) -> Optional[tuple[float, float]]:
    if "@" not in url:
        return None
    fragment = url.split("@", 1)[1]
    parts = fragment.split(",")
    if len(parts) < 2:
        return None
    try:
        lat = float(parts[0])
        lng = float(parts[1])
        return lat, lng
    except ValueError:
        return None


def wait_for_url_update(driver: webdriver.Chrome, previous_url: str, timeout: int = 15) -> str:
    end_time = time.time() + timeout
    while time.time() < end_time:
        current_url = driver.current_url
        if current_url != previous_url and "@" in current_url:
            return current_url
        time.sleep(0.5)
    raise TimeoutException("URL did not update with coordinates in time.")


def extract_coordinates(driver: webdriver.Chrome, wait: WebDriverWait) -> Optional[tuple[float, float]]:
    """Try URL parsing first, then fall back to right-click -> "What's here?"."""

    current_url = driver.current_url
    coords = get_coordinates_from_url(current_url)
    if coords:
        return coords

    # Fallback: invoke context menu "What's here?" to reveal coordinate chip
    try:
        map_canvas = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas.widget-scene-canvas")))
        ActionChains(driver).move_to_element_with_offset(map_canvas, 10, 10).context_click().perform()
        whats_here = wait.until(
            EC.element_to_be_clickable(
                (By.XPATH, "//div[@role='menu']//span[contains(text(),'여기')]"),
            )
        )
        whats_here.click()
        coord_chip = wait.until(
            EC.presence_of_element_located(
                (By.XPATH, "//button[contains(@aria-label,'좌표') or contains(@aria-label,'위도')]"),
            )
        )
        text = coord_chip.text
        if text:
            lat_str, lng_str = text.replace("°", "").split(",")
            return float(lat_str.strip()), float(lng_str.strip())
    except Exception:
        return None
    return None


def main():
    csv_path = Path("snu_buildings.csv")
    output_path = Path("snu_buildings_with_coords.csv")

    buildings = load_buildings(csv_path)
    driver = configure_driver(headless=False)
    wait = WebDriverWait(driver, 20)

    driver.get(GOOGLE_MAPS_URL)
    accept_initial_dialogs(driver, wait)

    results = []

    try:
        for building in buildings:
            query = f"서울대 관악캠퍼스 {building.number}동"
            previous_url = driver.current_url
            submit_query(driver, wait, query)

            try:
                updated_url = wait_for_url_update(driver, previous_url)
            except TimeoutException:
                updated_url = driver.current_url

            coords = extract_coordinates(driver, wait)

            if not coords and "@" in updated_url:
                coords = get_coordinates_from_url(updated_url)

            lat, lng = coords if coords else (None, None)
            print(f"{building.number} {building.name}: {lat}, {lng}")
            results.append(
                {
                    "동번호": building.number,
                    "동(건물)명": building.name,
                    "위도": lat,
                    "경도": lng,
                    "검색어": query,
                    "지도URL": driver.current_url,
                }
            )

            time.sleep(1.5)

    finally:
        driver.quit()

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["동번호", "동(건물)명", "위도", "경도", "검색어", "지도URL"])
        writer.writeheader()
        writer.writerows(results)

    print(f"Saved {len(results)} entries to {output_path}")


if __name__ == "__main__":
    main()
