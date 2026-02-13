# 1-29
# 31-39
# 142
# 42,3,5,7,9
# 50-64
# 67,9
# 71-74,6
# 80-6
# 100-2
# 125,9
# 131,5
# 140,2,3,9
# 150,1,2,3


# https://map.naver.com/p/directions/14132870.6573702,4504132.3124507,%EC%84%9C%EC%9A%B8%EB%8C%80%ED%9B%84%EB%AC%B8.%EC%97%B0%EA%B5%AC%EA%B3%B5%EC%9B%90,124552,BUS_STATION/14132042.7520533,4504400.5993013,%EC%84%9C%EC%9A%B8%EB%8C%80%ED%95%99%EA%B5%90%EA%B4%80%EC%95%85%EC%BA%A0%ED%8D%BC%EC%8A%A4%EC%9E%85%ED%95%99%EA%B4%80%EB%A6%AC%EB%B3%B8%EB%B6%80,18726520,PLACE_POI/-/walk?c=14.00,0,0,0,dh

# https://map.naver.com/p/directions/14132870.6573702,4504132.3124507,%EC%84%9C%EC%9A%B8%EB%8C%80%ED%9B%84%EB%AC%B8.%EC%97%B0%EA%B5%AC%EA%B3%B5%EC%9B%90,124552,BUS_STATION/14132271.3577596,4503463.203061,%EC%84%9C%EC%9A%B8%EB%8C%80%ED%95%99%EA%B5%90%20%EA%B4%80%EC%95%85%EC%BA%A0%ED%8D%BC%EC%8A%A41%EB%8F%99(%EC%9D%B8%EB%AC%B8%EA%B4%801),21279276,PLACE_POI/-/walk?c=16.00,0,0,0,dh

import urllib.parse
print(urllib.parse.unquote("%EC%84%9C%EC%9A%B8%EB%8C%80%ED%9B%84%EB%AC%B8.%EC%97%B0%EA%B5%AC%EA%B3%B5%EC%9B%90"))
print(urllib.parse.unquote("%EC%84%9C%EC%9A%B8%EB%8C%80%ED%95%99%EA%B5%90%EA%B4%80%EC%95%85%EC%BA%A0%ED%8D%BC%EC%8A%A4%EC%9E%85%ED%95%99%EA%B4%80%EB%A6%AC%EB%B3%B8%EB%B6%80"))

print(urllib.parse.quote("서울대후문.연구공원"))
print(urllib.parse.quote("서울대학교 관악캠퍼스 1동"))

boundary = {
    "l": (37.459298, 126.947716), # 500동 주변
    "r": (37.459174, 126.956276), # 버들골
    "t": (37.469003, 126.952520), # 치과 병원
    "d": (37.447450, 126.950308), # 건환경
}

import numpy as np
def haversine(lat1, lon1, lat2, lon2):
    # Returns distance in meters between two lat/lon points
    R = 6371000  # Earth radius in meters
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi/2)**2 + np.cos(phi1)*np.cos(phi2)*np.sin(dlambda/2)**2
    return 2 * R * np.arcsin(np.sqrt(a))

def make_grid(boundary, step_m=100):
    # Get min/max lat/lon
    l_lat, l_lon = boundary["l"]
    r_lat, r_lon = boundary["r"]
    t_lat, t_lon = boundary["t"]
    d_lat, d_lon = boundary["d"]

    min_lat = min(l_lat, r_lat, t_lat, d_lat)
    max_lat = max(l_lat, r_lat, t_lat, d_lat)
    min_lon = min(l_lon, r_lon, t_lon, d_lon)
    max_lon = max(l_lon, r_lon, t_lon, d_lon)

    # Calculate lat/lon step
    lat_dist = haversine(min_lat, min_lon, max_lat, min_lon)
    lon_dist = haversine(min_lat, min_lon, min_lat, max_lon)
    n_lat = int(lat_dist // step_m) + 1
    n_lon = int(lon_dist // step_m) + 1

    lat_steps = np.linspace(min_lat, max_lat, n_lat)
    lon_steps = np.linspace(min_lon, max_lon, n_lon)

    grid = []
    for lat in lat_steps:
        for lon in lon_steps:
            grid.append((lat, lon))
    return grid

grid_points = make_grid(boundary, step_m=100)
print(f"Grid points count: {len(grid_points)}")
# print(grid_points)  # Uncomment to see all grid coordinates

import requests
import requests
import numpy as np
import pandas as pd
import os
from dotenv import load_dotenv

load_dotenv()
APP_KEY = os.environ.get("TMAP_APP_KEY")

# https://skopenapi.readme.io/reference/%EB%B3%B4%ED%96%89%EC%9E%90-%EA%B2%BD%EB%A1%9C%EC%95%88%EB%82%B4
def whatsmyeta(lat1, long1, lat2, long2):
    url = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&callback=function"

    payload = {
        "startX": long1,
        "startY": lat1,
        "angle": 20,
        "speed": 30,
        "endX": long2,
        "endY": lat2,
        "startName": "출발지",
        "endName": "도착지",
        "reqCoordType": "WGS84GEO",
        "searchOption": "0",
        "resCoordType": "WGS84GEO",
        "sort": "index"
    }

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "appKey": APP_KEY
    }
    response = requests.post(url, json=payload, headers=headers).json()
    if "features" not in response:
        print("Error in response:", response)
        return float("inf")
    return response["features"][0]["properties"]["totalTime"]


df = pd.read_csv("snu_buildings.csv")
df = df[~df["동번호"].str.contains("Y")]

def get_coordinates_from_name(building_name: str, page=1, app_key=APP_KEY):
    url = "https://apis.openapi.sk.com/tmap/pois"
    params = {
        "version": 1,
        "searchKeyword": building_name,
        "searchType": "name",
        "areaLLCode": "11",
        "areaLMCode": "620",
        "resCoordType": "WGS84GEO",
        "multiPoint": "Y",
        "page": page,
        "count": 200,
        "appKey": app_key
    }

    response = requests.get(url, params=params)
    data = response.json()
    if "searchPoiInfo" in data and data["searchPoiInfo"]["pois"]["poi"]:
        buildings = []
        for poi in data["searchPoiInfo"]["pois"]["poi"]:
            if building_name in poi["name"]:
                name = poi["name"]
                lat = poi["newAddressList"]["newAddress"][0]["centerLat"]
                lon = poi["newAddressList"]["newAddress"][0]["centerLon"]
                building =  {"name": name, "lat": lat, "lon": lon}
                buildings.append(building)
        return buildings
    else:
        return None

if not os.path.exists("snu_buildings_with_coords.csv"):
    main_keyword = "서울대학교"
    result = []
    for page in range(1, 4):
        res = get_coordinates_from_name(main_keyword, page)
        if res:
            result += res
    if result:
        for building in result:
            building_number = building["name"].split("(")[-1][:-1]
            if not building_number.isdigit():
                continue
            print(f"{building_number},{building['name']} -> {building['lat']},{building['lon']}")
            df.loc[df["동번호"] == building_number, "위도"] = building["lat"]
            df.loc[df["동번호"] == building_number, "경도"] = building["lon"]
    csv_path = "snu_buildings_with_coords.csv"
    df.to_csv(csv_path, index=False)
    print(f"Updated coordinates saved to {csv_path}")

df = pd.read_csv("snu_buildings_with_coords.csv")

def get_distance(lat1, lon1, lat2, lon2):
    return sum([(lat1 - lat2)**2, (lon1 - lon2)**2])**0.5
import tqdm
def get_knn(grid_points, buildings_df, k=3):
    mmap = []
    buildings_df["neighbors"] = [[] for _ in range(len(buildings_df))]
    for pt in tqdm.tqdm(grid_points):
        lat1, long1 = pt[0], pt[1]
        neighbors = []
        for _, buildings_row in buildings_df.iterrows():
            lat2, long2 = buildings_row["위도"], buildings_row["경도"]
            d = get_distance(lat1, long1, lat2, long2)
            neighbors.append((d, buildings_row["동번호"], lat2, long2))
        neighbors = sorted(neighbors, key=lambda x: x[0])[:k]
        tmp = []
        for n in neighbors:
            eta = whatsmyeta(lat1, long1, n[2], n[3])
            tmp.append((n, eta))
            print(f"{pt}->{n[1]}: {eta} sec")
        tmp = sorted(tmp, key=lambda x: x[1], reverse=True)
        tmp = [{"building_number": x[0][1], "building_name": df[df["동번호"] == x[0][1]]["동(건물)명"].values[0], "eta": x[1]} for x in tmp]
        mmap.append({"neighbors": tmp, "coords": pt})
    return mmap

neighbors = get_knn(grid_points, df, k=5)
print(neighbors[0])
import json
json.dump(neighbors, open("knn.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)